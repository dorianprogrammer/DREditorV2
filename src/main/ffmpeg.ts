import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, promises as fs, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, extname, join } from 'node:path'
import {
  DUCK_LEVEL,
  DUCK_RAMP,
  FORMATS,
  FPS,
  MUSIC_FADE_IN,
  MUSIC_FADE_OUT,
  layoutClips,
  projectDuration,
  type MediaInfo,
  type MusicItem,
  type Project,
  type SoundRange,
  type TransitionKind,
  type VideoFormat
} from '../shared/project'

export function ffmpegPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  }
  const require = createRequire(__filename)
  return require('ffmpeg-static') as string
}

export const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']
export const VIDEO_EXTS = ['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.3gp']

/** Runs ffmpeg and resolves with stderr. Rejects on a non-zero exit unless allowFail is set. */
function run(args: string[], allowFail = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath(), args, { windowsHide: true })
    let stderr = ''
    proc.stderr.on('data', (d) => (stderr += d.toString()))
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0 || allowFail) resolve(stderr)
      else reject(new Error(stderr.split('\n').slice(-15).join('\n')))
    })
  })
}

interface Probe {
  duration: number
  videoCodec?: string
  hasAudio: boolean
}

async function probe(file: string): Promise<Probe> {
  // ffmpeg with no output exits with an error but prints the stream info we need.
  const out = await run(['-hide_banner', '-i', file], true)
  const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(out)
  const duration = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0
  const video = /Stream #\d+:\d+[^\n]*?: Video: (\w+)(?![^\n]*attached pic)/.exec(out)
  return { duration, videoCodec: video?.[1], hasAudio: /Stream #\d+:\d+[^\n]*?: Audio:/.test(out) }
}

function cacheDir(sub: string): string {
  const dir = join(app.getPath('userData'), 'cache', sub)
  mkdirSync(dir, { recursive: true })
  return dir
}

function cacheKey(file: string): string {
  const st = statSync(file)
  return createHash('sha1').update(`${file}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 16)
}

/** Can Chromium play this file directly? If not, we make an H.264 copy for the preview. */
function needsPreviewCopy(file: string, codec?: string): boolean {
  const ext = extname(file).toLowerCase()
  if (!['.mp4', '.mov', '.m4v', '.webm'].includes(ext)) return true
  const playable = ['h264', 'vp8', 'vp9', 'av1']
  // Mac decodes HEVC (iPhone videos) natively. Many Windows PCs can't without a paid extension.
  if (process.platform === 'darwin') playable.push('hevc')
  return !codec || !playable.includes(codec)
}

export async function prepareMedia(file: string): Promise<MediaInfo> {
  const ext = extname(file).toLowerCase()
  const name = basename(file, extname(file))
  if (IMAGE_EXTS.includes(ext)) {
    return { path: file, kind: 'image', name, duration: 0, hasAudio: false }
  }
  if (!VIDEO_EXTS.includes(ext)) throw new Error(`Formato no soportado: ${ext}`)

  const info = await probe(file)
  if (!info.videoCodec) throw new Error('El archivo no tiene video')
  const key = cacheKey(file)

  const thumbPath = join(cacheDir('thumbs'), `${key}.jpg`)
  if (!existsSync(thumbPath)) {
    const at = Math.min(1, info.duration / 2)
    await run(['-hide_banner', '-y', '-ss', at.toFixed(2), '-i', file, '-frames:v', '1', '-vf', 'scale=-2:160', '-q:v', '4', thumbPath], true)
  }

  let previewPath: string | undefined
  if (needsPreviewCopy(file, info.videoCodec)) {
    previewPath = join(cacheDir('previews'), `${key}.mp4`)
    if (!existsSync(previewPath)) {
      const tmp = `${previewPath}.part.mp4`
      await run([
        '-hide_banner', '-y', '-i', file,
        '-vf', "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))'",
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', tmp
      ])
      await fs.rename(tmp, previewPath)
    }
  }

  return {
    path: file,
    kind: 'video',
    name,
    duration: info.duration,
    hasAudio: info.hasAudio,
    previewPath,
    thumbPath: existsSync(thumbPath) ? thumbPath : undefined
  }
}

/** Checks a song file and reads its length. */
export async function prepareMusic(file: string): Promise<Pick<MusicItem, 'path' | 'name' | 'duration'>> {
  const info = await probe(file)
  if (!info.hasAudio || info.duration <= 0) throw new Error('El archivo no tiene sonido')
  return { path: file, name: basename(file, extname(file)), duration: info.duration }
}

/** Converts a MediaRecorder recording (WebM without duration info) to a normal M4A file. */
export async function saveVoice(data: Uint8Array, dir: string): Promise<{ path: string; duration: number }> {
  mkdirSync(dir, { recursive: true })
  const id = `voz-${Date.now()}`
  const raw = join(dir, `${id}.webm`)
  const out = join(dir, `${id}.m4a`)
  await fs.writeFile(raw, data)
  await run(['-hide_banner', '-y', '-i', raw, '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', out])
  await fs.rm(raw, { force: true })
  const info = await probe(out)
  return { path: out, duration: info.duration }
}

/** Pauses shorter than this stay (normal gaps between words). */
const MIN_SILENCE = 0.6
/** Sound kept before and after each loud part so words don't start or end abruptly. */
const SOUND_PAD = 0.15

/**
 * Finds the parts of a video that have sound, between start and end (seconds of the source).
 * Returns ranges in source seconds, sorted; an empty list means the whole range is silent.
 */
export async function findSound(file: string, start: number, end: number): Promise<SoundRange[]> {
  const len = end - start
  const input = ['-hide_banner', '-nostats', '-ss', sec(start), '-t', sec(len), '-i', file, '-vn', '-sn', '-dn']

  // Phone videos vary a lot in loudness, so the silence threshold follows the clip's average volume.
  const vol = await run([...input, '-af', 'volumedetect', '-f', 'null', '-'])
  const mean = /mean_volume: (-?\d+(?:\.\d+)?) dB/.exec(vol)
  const threshold = mean ? Math.max(-55, Math.min(-28, Number(mean[1]) - 14)) : -40

  const out = await run([...input, '-af', `silencedetect=noise=${threshold.toFixed(1)}dB:d=${MIN_SILENCE}`, '-f', 'null', '-'])
  const silences: SoundRange[] = []
  let open: number | null = null
  for (const m of out.matchAll(/silence_(start|end): (-?\d+(?:\.\d+)?)/g)) {
    const t = Math.max(0, Math.min(len, Number(m[2])))
    if (m[1] === 'start') open = t
    else if (open !== null) {
      silences.push({ start: open, end: t })
      open = null
    }
  }
  if (open !== null) silences.push({ start: open, end: len })

  // Sound is everything between the silences, padded a little and merged where the padding overlaps.
  const sound: SoundRange[] = []
  let cursor = 0
  for (const s of [...silences, { start: len, end: len }]) {
    if (s.start > cursor + 0.01) {
      const a = Math.max(0, cursor - SOUND_PAD)
      const b = Math.min(len, s.start + SOUND_PAD)
      const last = sound[sound.length - 1]
      if (last && a <= last.end) last.end = b
      else sound.push({ start: a, end: b })
    }
    cursor = Math.max(cursor, s.end)
  }
  return sound.map((r) => ({ start: start + r.start, end: start + r.end }))
}

const XFADE: Record<Exclude<TransitionKind, 'none'>, string> = {
  fade: 'fade',
  slide: 'slideleft',
  circle: 'circleopen',
  zoom: 'zoomin'
}

const sec = (n: number): string => Math.max(0, n).toFixed(3)

// Mono sources (recorded voices, many songs) go to both speakers at full level, like Chromium plays them in the
// preview. FFmpeg's default mono-to-stereo conversion makes them 3 dB quieter.
const TO_STEREO = 'aresample=48000,aformat=channel_layouts=mono|stereo,pan=stereo|FL<FL+FC|FR<FR+FC'

/** Builds the ffmpeg arguments and filter graph that render the project to a TikTok-ready MP4. */
export function buildExportGraph(
  project: Project,
  format: VideoFormat,
  textFiles: Map<string, string>
): { inputs: string[]; graph: string; duration: number } {
  const { w: OUT_W, h: OUT_H } = FORMATS[format]
  // The blurred background is made at quarter size (cheaper blur), then scaled up.
  const bgW = OUT_W / 4
  const bgH = OUT_H / 4
  const placed = layoutClips(project.clips)
  const total = projectDuration(project)
  const inputs: string[] = []
  const filters: string[] = []
  const audio: string[] = []
  let n = 0

  inputs.push('-f', 'lavfi', '-t', sec(total), '-i', 'anullsrc=r=48000:cl=stereo')
  audio.push(`[${n++}:a]`)

  placed.forEach((pc, i) => {
    const c = pc.clip
    if (c.kind === 'image') {
      inputs.push('-loop', '1', '-framerate', String(FPS), '-t', sec(pc.length), '-i', c.path)
    } else {
      inputs.push('-ss', sec(c.start), '-t', sec(pc.length), '-i', c.path)
    }
    const idx = n++

    // Fit the clip into the frame over a blurred, darker copy of itself (no black bars).
    filters.push(`[${idx}:v]fps=${FPS},split=2[bg${i}][fg${i}]`)
    filters.push(
      `[bg${i}]scale=${bgW}:${bgH}:force_original_aspect_ratio=increase,crop=${bgW}:${bgH},boxblur=12:2,` +
        `scale=${OUT_W}:${OUT_H},eq=brightness=-0.12[bgb${i}]`
    )
    filters.push(`[fg${i}]scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=decrease[fgs${i}]`)
    filters.push(
      `[bgb${i}][fgs${i}]overlay=(W-w)/2:(H-h)/2:shortest=1,setsar=1,format=yuv420p,` +
        `tpad=stop_mode=clone:stop_duration=1,trim=duration=${sec(pc.length)},setpts=PTS-STARTPTS,settb=AVTB[v${i}]`
    )

    if (c.kind === 'video' && c.hasAudio && c.volume > 0) {
      const fadeIn = pc.transitionIn
      const fadeOut = placed[i + 1]?.transitionIn ?? 0
      let chain =
        `[${idx}:a]${TO_STEREO},atrim=duration=${sec(pc.length)},` +
        `asetpts=PTS-STARTPTS,volume=${c.volume.toFixed(2)}`
      if (fadeIn > 0) chain += `,afade=t=in:d=${sec(fadeIn)}`
      if (fadeOut > 0) chain += `,afade=t=out:st=${sec(pc.length - fadeOut)}:d=${sec(fadeOut)}`
      chain += `,adelay=${Math.round(pc.at * 1000)}:all=1[a${i}]`
      filters.push(chain)
      audio.push(`[a${i}]`)
    }
  })

  let acc = 'v0'
  placed.slice(1).forEach((pc, k) => {
    const i = k + 1
    const out = `x${i}`
    if (pc.transitionIn > 0 && pc.clip.transition !== 'none') {
      filters.push(
        `[${acc}][v${i}]xfade=transition=${XFADE[pc.clip.transition]}:duration=${sec(pc.transitionIn)}:` +
          `offset=${sec(pc.at)},settb=AVTB[${out}]`
      )
    } else {
      filters.push(`[${acc}][v${i}]concat=n=2:v=1:a=0,settb=AVTB[${out}]`)
    }
    acc = out
  })

  project.texts.forEach((t, k) => {
    const file = textFiles.get(t.id)
    if (!file) return
    inputs.push('-loop', '1', '-framerate', String(FPS), '-t', sec(total), '-i', file)
    const idx = n++
    const out = `t${k}`
    filters.push(`[${acc}][${idx}:v]overlay=0:0:enable='between(t,${sec(t.start)},${sec(t.start + t.duration)})'[${out}]`)
    acc = out
  })
  filters.push(`[${acc}]format=yuv420p[vout]`)

  project.voices.forEach((v, k) => {
    inputs.push('-i', v.path)
    const idx = n++
    filters.push(
      `[${idx}:a]${TO_STEREO},volume=${v.volume.toFixed(2)},` +
        `adelay=${Math.round(v.start * 1000)}:all=1[vo${k}]`
    )
    audio.push(`[vo${k}]`)
  })

  const m = project.music
  if (m && total > 0) {
    // The song loops from its beginning; skipping `offset` seconds of the first pass matches the preview.
    inputs.push('-stream_loop', '-1', '-t', sec(m.offset + total + 1), '-i', m.path)
    const idx = n++
    const fadeOut = Math.min(MUSIC_FADE_OUT, total / 2)
    let chain =
      `[${idx}:a]${TO_STEREO},atrim=start=${sec(m.offset)},asetpts=PTS-STARTPTS,` +
      `atrim=duration=${sec(total)},volume=${m.volume.toFixed(2)}`
    if (m.duck && project.voices.length) {
      // Same curve as duckAmount() in the preview: ramps of DUCK_RAMP seconds around each voice.
      const w = project.voices.map(
        (v) => `clip((min(t-(${(v.start - DUCK_RAMP).toFixed(3)}),${(v.start + v.duration + DUCK_RAMP).toFixed(3)}-t))/${DUCK_RAMP},0,1)`
      )
      const maxW = w.reduce((acc, x) => `max(${acc},${x})`)
      chain += `,volume='1-${(1 - DUCK_LEVEL).toFixed(2)}*${maxW}':eval=frame`
    }
    chain += `,afade=t=in:d=${sec(Math.min(MUSIC_FADE_IN, total / 2))},afade=t=out:st=${sec(total - fadeOut)}:d=${sec(fadeOut)}[mus]`
    filters.push(chain)
    audio.push('[mus]')
  }

  if (audio.length === 1) filters.push(`${audio[0]}anull[aout]`)
  else filters.push(`${audio.join('')}amix=inputs=${audio.length}:duration=first:normalize=0,alimiter=limit=0.95[aout]`)

  return { inputs, graph: filters.join(';\n'), duration: total }
}

let current: ChildProcess | null = null
let cancelled = false

export function cancelExport(): void {
  cancelled = true
  current?.kill()
}

export async function renderVideo(
  project: Project,
  format: VideoFormat,
  textFiles: Map<string, string>,
  workDir: string,
  outPath: string,
  onProgress: (fraction: number) => void
): Promise<'done' | 'cancelled'> {
  const { inputs, graph, duration } = buildExportGraph(project, format, textFiles)
  const graphFile = join(workDir, 'graph.txt')
  await fs.writeFile(graphFile, graph)
  const args = [
    '-hide_banner', '-y', '-nostats', '-progress', 'pipe:1',
    ...inputs,
    '-filter_complex_script', graphFile,
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-movflags', '+faststart', '-t', sec(duration),
    outPath
  ]

  cancelled = false
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath(), args, { windowsHide: true })
    current = proc
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => {
      const m = /out_time_us=(\d+)/g
      let hit: RegExpExecArray | null
      let last = -1
      while ((hit = m.exec(d.toString()))) last = Number(hit[1])
      if (last >= 0 && duration > 0) onProgress(Math.min(1, last / 1e6 / duration))
    })
    proc.stderr.on('data', (d) => {
      stderr += d.toString()
      if (stderr.length > 20000) stderr = stderr.slice(-10000)
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      current = null
      if (cancelled) resolve('cancelled')
      else if (code === 0) resolve('done')
      else reject(new Error(stderr.split('\n').slice(-20).join('\n')))
    })
  })
}
