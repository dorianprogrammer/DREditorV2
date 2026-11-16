// Project model and timeline math shared by the preview (renderer) and the export (main).

export const OUT_W = 1080
export const OUT_H = 1920
export const FPS = 30
export const TRANSITION_SECONDS = 0.6
export const MIN_CLIP_SECONDS = 0.3

export type TransitionKind = 'none' | 'fade' | 'slide' | 'circle' | 'zoom'
export type TextStyle = 'outline' | 'box' | 'shadow'
export type FontKey = 'bold' | 'fun' | 'impact' | 'classic'

export interface Clip {
  id: string
  kind: 'video' | 'image'
  path: string
  /** Browser-playable copy when the original codec can't play in Chromium (e.g. HEVC on Windows). */
  previewPath?: string
  thumbPath?: string
  name: string
  /** Full length of the source file. 0 for images. */
  sourceDuration: number
  hasAudio: boolean
  /** Trim in/out, in seconds of the source. For images, start is 0 and end is the display time. */
  start: number
  end: number
  volume: number
  /** Transition that leads INTO this clip from the previous one. Ignored on the first clip. */
  transition: TransitionKind
}

export interface TextItem {
  id: string
  text: string
  start: number
  duration: number
  /** Center position, 0..1 of the frame. */
  x: number
  y: number
  /** Font size in output pixels (frame is 1080 wide). */
  size: number
  color: string
  style: TextStyle
  font: FontKey
}

export interface VoiceItem {
  id: string
  path: string
  start: number
  duration: number
  volume: number
}

export interface Project {
  version: 1
  clips: Clip[]
  texts: TextItem[]
  voices: VoiceItem[]
}

/** A stretch of a media file, in seconds of the source. */
export interface SoundRange {
  start: number
  end: number
}

export const emptyProject = (): Project => ({ version: 1, clips: [], texts: [], voices: [] })

export const clipLength = (c: Clip): number => c.end - c.start

export interface PlacedClip {
  clip: Clip
  index: number
  /** Where the clip begins on the timeline. */
  at: number
  length: number
  /** Overlap with the previous clip (transition length). */
  transitionIn: number
}

/** Transition length between two clips: never longer than half of either clip. */
export function transitionLength(prev: Clip | undefined, next: Clip): number {
  if (!prev || next.transition === 'none') return 0
  return Math.min(TRANSITION_SECONDS, clipLength(prev) / 2, clipLength(next) / 2)
}

export function layoutClips(clips: Clip[]): PlacedClip[] {
  const placed: PlacedClip[] = []
  let cursor = 0
  clips.forEach((clip, index) => {
    const t = transitionLength(clips[index - 1], clip)
    const at = Math.max(0, cursor - t)
    const length = clipLength(clip)
    placed.push({ clip, index, at, length, transitionIn: t })
    cursor = at + length
  })
  return placed
}

export function projectDuration(p: Project): number {
  const placed = layoutClips(p.clips)
  const last = placed[placed.length - 1]
  return last ? last.at + last.length : 0
}

export const FONT_FAMILIES: Record<FontKey, string> = {
  bold: '"Arial Black", "Arial Bold", Arial, sans-serif',
  fun: '"Comic Sans MS", "Comic Sans", "Chalkboard SE", cursive',
  impact: 'Impact, "Haettenschweiler", "Arial Narrow Bold", sans-serif',
  classic: 'Georgia, "Times New Roman", serif'
}

/** What the renderer sends to the main process to export. */
export interface ExportRequest {
  project: Project
  /** One transparent 1080x1920 PNG per text item, rendered by the same code as the preview. */
  textImages: { id: string; png: Uint8Array }[]
}

export interface ExportResult {
  ok: boolean
  path?: string
  cancelled?: boolean
  error?: string
}

export interface MediaInfo {
  path: string
  kind: 'video' | 'image'
  name: string
  duration: number
  hasAudio: boolean
  previewPath?: string
  thumbPath?: string
}

export const MEDIA_SCHEME = 'media'

export const mediaUrl = (absPath: string): string =>
  `${MEDIA_SCHEME}://local/${encodeURIComponent(absPath)}`
