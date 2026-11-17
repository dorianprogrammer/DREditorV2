import {
  layoutClips,
  mediaUrl,
  musicGain,
  musicPosition,
  projectDuration,
  type Clip,
  type Project
} from '@shared/project'
import { drawFitted, drawSafeZone, drawSelectionBox, drawText, drawTransition, isDrawable, type Media } from './draw'
import { useEditor } from './store'

const DRIFT_PLAYING = 0.3
const DRIFT_PAUSED = 0.04
const PREROLL = 1.5

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

/** Owns one media element per clip/voice and keeps them in step with the timeline clock. */
export class PreviewEngine {
  private clipEls = new Map<string, { src: string; el: Media }>()
  private voiceEls = new Map<string, { src: string; el: HTMLAudioElement }>()
  private music: { src: string; el: HTMLAudioElement } | null = null
  private raf = 0
  private clockBase = { time: 0, now: 0 }
  private lastWritten = -1
  private wasPlaying = false

  constructor(private canvas: HTMLCanvasElement) {}

  start(): void {
    const loop = (now: number): void => {
      this.frame(now)
      this.raf = requestAnimationFrame(loop)
    }
    this.raf = requestAnimationFrame(loop)
  }

  destroy(): void {
    cancelAnimationFrame(this.raf)
    for (const { el } of this.clipEls.values()) if (el instanceof HTMLVideoElement) this.release(el)
    for (const { el } of this.voiceEls.values()) this.release(el)
    if (this.music) this.release(this.music.el)
    this.music = null
    this.clipEls.clear()
    this.voiceEls.clear()
  }

  private release(el: HTMLMediaElement): void {
    el.pause()
    el.removeAttribute('src')
    el.load()
  }

  private syncElements(p: Project): void {
    const keep = new Set<string>()
    for (const c of p.clips) {
      keep.add(c.id)
      const src = mediaUrl(c.previewPath ?? c.path)
      const existing = this.clipEls.get(c.id)
      if (existing?.src === src) continue
      if (existing?.el instanceof HTMLVideoElement) this.release(existing.el)
      this.clipEls.set(c.id, { src, el: this.createClipEl(c, src) })
    }
    for (const [id, { el }] of this.clipEls) {
      if (keep.has(id)) continue
      if (el instanceof HTMLVideoElement) this.release(el)
      this.clipEls.delete(id)
    }

    const keepV = new Set<string>()
    for (const v of p.voices) {
      keepV.add(v.id)
      const src = mediaUrl(v.path)
      if (this.voiceEls.get(v.id)?.src === src) continue
      const el = new Audio()
      el.preload = 'auto'
      el.src = src
      this.voiceEls.set(v.id, { src, el })
    }
    for (const [id, { el }] of this.voiceEls) {
      if (keepV.has(id)) continue
      this.release(el)
      this.voiceEls.delete(id)
    }

    const musicSrc = p.music ? mediaUrl(p.music.path) : null
    if (this.music?.src !== musicSrc) {
      if (this.music) this.release(this.music.el)
      this.music = null
      if (musicSrc) {
        const el = new Audio()
        el.preload = 'auto'
        el.loop = true
        el.src = musicSrc
        this.music = { src: musicSrc, el }
      }
    }
  }

  private createClipEl(c: Clip, src: string): Media {
    if (c.kind === 'image') {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.src = src
      return img
    }
    const v = document.createElement('video')
    v.crossOrigin = 'anonymous'
    v.preload = 'auto'
    v.playsInline = true
    v.src = src
    v.currentTime = c.start
    return v
  }

  private frame(now: number): void {
    const st = useEditor.getState()
    const p = st.project
    this.syncElements(p)
    const total = projectDuration(p)

    // Clock: while playing, time advances from the last seek; any outside seek re-bases it.
    let t = st.time
    if (st.playing) {
      if (!this.wasPlaying || Math.abs(st.time - this.lastWritten) > 1e-6) {
        if (st.time >= total - 0.05) t = 0
        this.clockBase = { time: t, now }
      }
      t = this.clockBase.time + (now - this.clockBase.now) / 1000
      if (t >= total) {
        t = total
        st.setPlaying(false)
      }
      if (t !== st.time) st.seek(t)
      this.lastWritten = useEditor.getState().time
    }
    this.wasPlaying = st.playing

    const playing = useEditor.getState().playing
    const muted = st.recording
    const placed = layoutClips(p.clips)
    const active = placed.filter((pc) => t >= pc.at && t < pc.at + pc.length)
    if (!active.length && placed.length && t >= total) active.push(placed[placed.length - 1])

    placed.forEach((pc, i) => {
      const entry = this.clipEls.get(pc.clip.id)
      if (!entry || !(entry.el instanceof HTMLVideoElement)) return
      const el = entry.el
      const isActive = active.includes(pc)
      if (!isActive) {
        if (!el.paused) el.pause()
        const upcoming = pc.at > t && pc.at - t < PREROLL
        if (upcoming && !el.seeking && Math.abs(el.currentTime - pc.clip.start) > DRIFT_PAUSED) el.currentTime = pc.clip.start
        return
      }
      const local = Math.min(pc.clip.start + (t - pc.at), pc.clip.end - 0.02)
      let vol = pc.clip.volume
      if (pc.transitionIn > 0) vol *= clamp01((t - pc.at) / pc.transitionIn)
      const next = placed[i + 1]
      if (next && next.transitionIn > 0) vol *= clamp01((pc.at + pc.length - t) / next.transitionIn)
      el.volume = muted ? 0 : clamp01(vol)

      if (playing) {
        if (el.paused) {
          el.currentTime = local
          el.play().catch(() => {})
        } else if (Math.abs(el.currentTime - local) > DRIFT_PLAYING) {
          el.currentTime = local
        }
      } else {
        if (!el.paused) el.pause()
        if (!el.seeking && Math.abs(el.currentTime - local) > DRIFT_PAUSED) el.currentTime = local
      }
    })

    for (const v of p.voices) {
      const el = this.voiceEls.get(v.id)?.el
      if (!el) continue
      const on = playing && !muted && t >= v.start && t < v.start + v.duration
      if (!on) {
        if (!el.paused) el.pause()
        continue
      }
      el.volume = clamp01(v.volume)
      const local = t - v.start
      if (el.paused) {
        el.currentTime = local
        el.play().catch(() => {})
      } else if (Math.abs(el.currentTime - local) > DRIFT_PLAYING) el.currentTime = local
    }

    if (this.music && p.music) {
      const el = this.music.el
      if (!playing || muted || t >= total) {
        if (!el.paused) el.pause()
      } else {
        el.volume = clamp01(musicGain(p, t, total))
        const local = musicPosition(p.music, t)
        // The song loops, so compare positions around the loop point.
        const len = Math.max(p.music.duration, 0.01)
        const off = Math.abs(el.currentTime - local)
        const drift = Math.min(off, len - off)
        if (el.paused) {
          el.currentTime = local
          el.play().catch(() => {})
        } else if (drift > DRIFT_PLAYING) el.currentTime = local
      }
    }

    this.draw(p, t, active, placed, st.selection, st.safeZone, playing)
  }

  private draw(
    p: Project,
    t: number,
    active: ReturnType<typeof layoutClips>,
    placed: ReturnType<typeof layoutClips>,
    selection: ReturnType<typeof useEditor.getState>['selection'],
    safeZone: boolean,
    playing: boolean
  ): void {
    const ctx = this.canvas.getContext('2d')!
    const W = this.canvas.width
    const H = this.canvas.height
    const scale = W / 1080
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, W, H)

    const drawClip = (pc: (typeof placed)[number]) => (): void => {
      const el = this.clipEls.get(pc.clip.id)?.el
      if (isDrawable(el)) drawFitted(ctx, el, W, H)
      else {
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, W, H)
      }
    }

    if (active.length >= 2) {
      const [a, b] = active.slice(-2)
      const prog = b.transitionIn > 0 ? clamp01((t - b.at) / b.transitionIn) : 1
      drawTransition(ctx, b.clip.transition, prog, drawClip(a), drawClip(b), W, H)
    } else if (active.length === 1) {
      drawClip(active[0])()
    }

    for (const tx of p.texts) {
      if (t >= tx.start && t < tx.start + tx.duration) drawText(ctx, tx, scale)
    }
    if (!playing && selection?.kind === 'text') {
      const tx = p.texts.find((x) => x.id === selection.id)
      if (tx && t >= tx.start && t < tx.start + tx.duration) drawSelectionBox(ctx, tx, scale)
    }
    if (safeZone) drawSafeZone(ctx, W, H)
  }
}
