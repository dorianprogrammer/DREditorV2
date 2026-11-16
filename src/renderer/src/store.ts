import { create } from 'zustand'
import {
  MIN_CLIP_SECONDS,
  clipLength,
  emptyProject,
  layoutClips,
  projectDuration,
  type Clip,
  type MediaInfo,
  type Project,
  type SoundRange,
  type TextItem
} from '@shared/project'

export type Selection = { kind: 'clip' | 'text' | 'voice'; id: string } | null

const HISTORY_LIMIT = 100
const COALESCE_MS = 700
const IMAGE_SECONDS = 3

interface EditorState {
  project: Project
  past: Project[]
  future: Project[]
  coalesce: { key: string; at: number } | null
  selection: Selection
  time: number
  playing: boolean
  recording: boolean
  /** True only while the microphone is actually recording (not while the record panel just shows). */
  micLive: boolean
  safeZone: boolean
  /** Message for the blocking "working…" overlay, or null. */
  busy: string | null
  toast: { id: number; text: string } | null

  /** Applies a change and records it for undo. Changes with the same key in quick succession merge into one step. */
  update: (fn: (draft: Project) => void, coalesceKey?: string) => void
  undo: () => void
  redo: () => void
  loadProject: (p: Project) => void
  select: (s: Selection) => void
  seek: (t: number) => void
  setPlaying: (on: boolean) => void
  setRecording: (on: boolean) => void
  setMicLive: (on: boolean) => void
  toggleSafeZone: () => void
  setBusy: (busy: string | null) => void
  showToast: (text: string) => void
}

export const useEditor = create<EditorState>((set, get) => ({
  project: emptyProject(),
  past: [],
  future: [],
  coalesce: null,
  selection: null,
  time: 0,
  playing: false,
  recording: false,
  micLive: false,
  safeZone: false,
  busy: null,
  toast: null,

  update: (fn, coalesceKey) => {
    const { project, past, coalesce } = get()
    const draft = structuredClone(project)
    fn(draft)
    const now = Date.now()
    const merge = coalesceKey && coalesce && coalesce.key === coalesceKey && now - coalesce.at < COALESCE_MS
    set({
      project: draft,
      past: merge ? past : [...past, project].slice(-HISTORY_LIMIT),
      future: [],
      coalesce: coalesceKey ? { key: coalesceKey, at: now } : null,
      time: Math.min(get().time, projectDuration(draft))
    })
  },

  undo: () => {
    const { past, future, project } = get()
    const prev = past[past.length - 1]
    if (!prev) return
    set({ project: prev, past: past.slice(0, -1), future: [project, ...future], coalesce: null, playing: false })
  },

  redo: () => {
    const { past, future, project } = get()
    const next = future[0]
    if (!next) return
    set({ project: next, past: [...past, project], future: future.slice(1), coalesce: null, playing: false })
  },

  loadProject: (p) =>
    set({ project: p, past: [], future: [], coalesce: null, selection: null, time: 0, playing: false }),
  select: (selection) => set({ selection }),
  seek: (t) => set({ time: Math.max(0, Math.min(t, projectDuration(get().project))) }),
  setPlaying: (playing) => set({ playing }),
  setRecording: (recording) => set({ recording, micLive: false }),
  setMicLive: (micLive) => set({ micLive }),
  toggleSafeZone: () => set({ safeZone: !get().safeZone }),
  setBusy: (busy) => set({ busy }),
  showToast: (text) => set({ toast: { id: Date.now(), text } })
}))

const uid = (): string => crypto.randomUUID()

export function addMedia(items: MediaInfo[]): void {
  if (!items.length) return
  const clips: Clip[] = items.map((m) => ({
    id: uid(),
    kind: m.kind,
    path: m.path,
    previewPath: m.previewPath,
    thumbPath: m.thumbPath,
    name: m.name,
    sourceDuration: m.duration,
    hasAudio: m.hasAudio,
    start: 0,
    end: m.kind === 'image' ? IMAGE_SECONDS : m.duration,
    volume: 1,
    transition: 'fade'
  }))
  const st = useEditor.getState()
  const wasEmpty = st.project.clips.length === 0
  st.update((p) => {
    p.clips.push(...clips)
  })
  if (wasEmpty) st.seek(0)
  st.select({ kind: 'clip', id: clips[clips.length - 1].id })
}

export const TEXT_COLORS = ['#ffffff', '#ffd23f', '#ff4f8b', '#3ec9f5', '#46e0a0', '#ff9a3c', '#9b7bff', '#111111']

export function addText(): void {
  const st = useEditor.getState()
  const total = projectDuration(st.project)
  const start = total > 0 && st.time >= total - 0.5 ? Math.max(0, total - 3) : st.time
  const item: TextItem = {
    id: uid(),
    text: '¡Hola!',
    start,
    duration: total > 0 ? Math.min(3, Math.max(1, total - start)) : 3,
    x: 0.5,
    y: 0.42,
    size: 110,
    color: '#ffffff',
    style: 'outline',
    font: 'bold'
  }
  st.update((p) => {
    p.texts.push(item)
  })
  st.select({ kind: 'text', id: item.id })
}

export function addVoice(path: string, duration: number, start: number): void {
  const st = useEditor.getState()
  const id = uid()
  st.update((p) => {
    p.voices.push({ id, path, start, duration, volume: 1 })
  })
  st.select({ kind: 'voice', id })
}

/** The clip under the playhead (the incoming one during a transition). */
export function clipAtTime(p: Project, t: number): { clip: Clip; at: number } | null {
  const placed = layoutClips(p.clips)
  for (let i = placed.length - 1; i >= 0; i--) {
    const pc = placed[i]
    if (t >= pc.at && t < pc.at + pc.length) return { clip: pc.clip, at: pc.at }
  }
  return null
}

export function canSplit(p: Project, t: number): boolean {
  const hit = clipAtTime(p, t)
  if (!hit) return false
  const local = t - hit.at
  return local > MIN_CLIP_SECONDS && local < clipLength(hit.clip) - MIN_CLIP_SECONDS
}

export function splitAtPlayhead(): void {
  const st = useEditor.getState()
  const hit = clipAtTime(st.project, st.time)
  if (!hit || !canSplit(st.project, st.time)) {
    st.showToast('Pon la línea roja en medio de un video para cortarlo')
    return
  }
  const local = st.time - hit.at
  const cut = hit.clip.start + local
  // Photos always have start 0 and end = how long they show.
  const second: Clip =
    hit.clip.kind === 'image'
      ? { ...hit.clip, id: uid(), start: 0, end: clipLength(hit.clip) - local, transition: 'none' }
      : { ...hit.clip, id: uid(), start: cut, transition: 'none' }
  st.update((p) => {
    const i = p.clips.findIndex((c) => c.id === hit.clip.id)
    p.clips[i].end = cut
    p.clips.splice(i + 1, 0, second)
  })
  st.select({ kind: 'clip', id: second.id })
}

/**
 * Cuts the quiet parts out of a video clip: the clip is replaced by one piece per stretch of sound,
 * joined with plain cuts. Texts and voices keep their place relative to the video. One undo step.
 */
export async function removeSilences(clipId: string): Promise<void> {
  const st = useEditor.getState()
  const clip = st.project.clips.find((c) => c.id === clipId)
  if (!clip || clip.kind !== 'video' || !clip.hasAudio || st.busy) return
  st.setPlaying(false)
  st.setBusy('Buscando silencios…')
  let ranges: SoundRange[]
  try {
    ranges = await window.api.findSound(clip.path, clip.start, clip.end)
  } catch (err) {
    console.error('findSound failed', err)
    st.showToast('No se pudo revisar el sonido de este video')
    return
  } finally {
    st.setBusy(null)
  }

  const now = useEditor.getState()
  const current = now.project.clips.find((c) => c.id === clipId)
  if (!current || current.start !== clip.start || current.end !== clip.end) return
  if (!ranges.length) {
    now.showToast('Este video no tiene sonido, no hay nada que quitar')
    return
  }
  const removed = clipLength(clip) - ranges.reduce((sum, r) => sum + (r.end - r.start), 0)
  if (removed < 0.3) {
    now.showToast('Este video no tiene silencios largos 👍')
    return
  }

  const pieces: Clip[] = ranges.map((r, i) => ({
    ...clip,
    id: i === 0 ? clip.id : uid(),
    start: r.start,
    end: r.end,
    transition: i === 0 ? clip.transition : 'none'
  }))
  const before = layoutClips(now.project.clips)
  const index = before.findIndex((pc) => pc.clip.id === clipId)
  const old = before[index]
  const oldEnd = old.at + old.length

  now.update((p) => {
    p.clips.splice(index, 1, ...pieces)
    const after = layoutClips(p.clips)
    const last = after[index + pieces.length - 1]
    const next = { old: before[index + 1], now: after[index + pieces.length] }
    const shift = next.old ? next.old.at - next.now.at : oldEnd - (last.at + last.length)
    // Moves a timeline time to where the same moment of video is now. Times inside a removed silence
    // go to the start of the next piece.
    const map = (t: number): number => {
      if (t <= old.at) return t
      if (t >= oldEnd) return Math.max(0, t - shift)
      const s = clip.start + (t - old.at)
      for (let k = 0; k < pieces.length; k++) {
        if (s < pieces[k].end) return after[index + k].at + Math.max(0, s - pieces[k].start)
      }
      return last.at + last.length
    }
    for (const t of p.texts) {
      const end = map(t.start + t.duration)
      t.start = map(t.start)
      t.duration = Math.max(0.5, end - t.start)
    }
    for (const v of p.voices) v.start = map(v.start)
  })
  now.seek(old.at)
  now.select({ kind: 'clip', id: clip.id })
  now.showToast(`¡Listo! Se quitaron ${removed.toFixed(1)} s de silencio`)
}

export function deleteSelection(): void {
  const st = useEditor.getState()
  const sel = st.selection
  if (!sel) return
  st.update((p) => {
    if (sel.kind === 'clip') p.clips = p.clips.filter((c) => c.id !== sel.id)
    if (sel.kind === 'text') p.texts = p.texts.filter((t) => t.id !== sel.id)
    if (sel.kind === 'voice') p.voices = p.voices.filter((v) => v.id !== sel.id)
  })
  st.select(null)
}

export function moveClip(id: string, toIndex: number): void {
  useEditor.getState().update((p) => {
    const from = p.clips.findIndex((c) => c.id === id)
    if (from < 0) return
    const [c] = p.clips.splice(from, 1)
    p.clips.splice(Math.max(0, Math.min(toIndex, p.clips.length)), 0, c)
  })
}

export function updateClip(id: string, patch: Partial<Clip>, coalesceKey?: string): void {
  useEditor.getState().update((p) => {
    const c = p.clips.find((x) => x.id === id)
    if (c) Object.assign(c, patch)
  }, coalesceKey)
}

export function updateText(id: string, patch: Partial<TextItem>, coalesceKey?: string): void {
  useEditor.getState().update((p) => {
    const t = p.texts.find((x) => x.id === id)
    if (t) Object.assign(t, patch)
  }, coalesceKey)
}

export function updateVoice(id: string, patch: Partial<Project['voices'][number]>, coalesceKey?: string): void {
  useEditor.getState().update((p) => {
    const v = p.voices.find((x) => x.id === id)
    if (v) Object.assign(v, patch)
  }, coalesceKey)
}

export function formatTime(t: number): string {
  const s = Math.max(0, Math.floor(t))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Saves the project to disk shortly after every change. */
export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  return useEditor.subscribe((s, prev) => {
    if (s.project === prev.project) return
    clearTimeout(timer)
    timer = setTimeout(() => window.api.saveProject(JSON.stringify(s.project)), 800)
  })
}

/** Imports files by path (drag and drop), or opens the file picker when paths is null. */
export async function importPaths(paths: string[] | null): Promise<void> {
  const { items, failed } = paths ? await window.api.prepareMedia(paths) : await window.api.pickMedia()
  addMedia(items)
  if (failed.length) {
    useEditor
      .getState()
      .showToast(failed.length === 1 ? 'Un archivo no se pudo abrir' : `${failed.length} archivos no se pudieron abrir`)
  }
}
