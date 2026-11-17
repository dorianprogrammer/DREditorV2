import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MIN_CLIP_SECONDS, layoutClips, mediaUrl, projectDuration, type PlacedClip } from '@shared/project'
import { formatTime, moveClip, pickMusic, updateClip, updateText, updateVoice, useEditor } from '../store'

const LABEL_W = 96
const TRANSITION_ICON: Record<string, string> = { fade: '✨', slide: '👉', circle: '⭕', zoom: '🔍', none: '＋' }

type DragKind = 'clip-move' | 'clip-left' | 'clip-right' | 'text-move' | 'text-right' | 'voice-move' | 'scrub'

interface DragState {
  kind: DragKind
  id: string
  startX: number
  moved: boolean
  /** Snapshot of the item when the drag began. */
  orig: { start: number; end: number; duration: number }
}

/** Puts overlapping items on separate lanes so none hide each other. */
function lanes<T extends { start: number; duration: number }>(items: T[]): { item: T; lane: number }[] {
  const ends: number[] = []
  return [...items]
    .sort((a, b) => a.start - b.start)
    .map((item) => {
      let lane = ends.findIndex((e) => e <= item.start + 0.01)
      if (lane < 0) lane = ends.length
      ends[lane] = item.start + item.duration
      return { item, lane }
    })
}

export function Timeline(): React.JSX.Element {
  const project = useEditor((s) => s.project)
  const selection = useEditor((s) => s.selection)
  const time = useEditor((s) => s.time)
  const playing = useEditor((s) => s.playing)
  const recording = useEditor((s) => s.recording)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [viewW, setViewW] = useState(800)
  const [zoom, setZoom] = useState(1)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [dragX, setDragX] = useState(0)

  const total = projectDuration(project)
  const placed = layoutClips(project.clips)
  const fitPps = (viewW - 60) / Math.max(total, 8)
  const pps = Math.max(8, Math.min(400, fitPps * zoom))
  const contentW = Math.max(viewW, total * pps + 60)

  useLayoutEffect(() => {
    const el = scrollRef.current!
    const ro = new ResizeObserver(() => setViewW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Keep the playhead visible while playing.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !playing) return
    const x = time * pps
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 60) el.scrollLeft = Math.max(0, x - 80)
  }, [time, pps, playing])

  const timeAt = (clientX: number): number => {
    const el = scrollRef.current!
    const r = el.getBoundingClientRect()
    return (clientX - r.left + el.scrollLeft) / pps
  }

  const begin = (e: React.PointerEvent, kind: DragKind, id: string, orig: DragState['orig']): void => {
    if (recording || e.button !== 0) return
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const st = useEditor.getState()
    st.setPlaying(false)
    if (kind === 'scrub') st.seek(timeAt(e.clientX))
    setDrag({ kind, id, startX: e.clientX, moved: false, orig })
    setDragX(0)
  }

  const onMove = (e: React.PointerEvent): void => {
    if (!drag) return
    const dx = e.clientX - drag.startX
    if (!drag.moved && Math.abs(dx) < 4 && drag.kind !== 'scrub') return
    if (!drag.moved) setDrag({ ...drag, moved: true })
    setDragX(dx)
    const dt = dx / pps
    const key = `${drag.kind}-${drag.id}`
    const st = useEditor.getState()
    const o = drag.orig
    switch (drag.kind) {
      case 'scrub':
        st.seek(timeAt(e.clientX))
        break
      case 'clip-left': {
        const clip = st.project.clips.find((c) => c.id === drag.id)
        if (!clip) break
        if (clip.kind === 'image') {
          updateClip(drag.id, { end: Math.max(1, Math.min(60, o.end - dt)) }, key)
        } else {
          updateClip(drag.id, { start: Math.max(0, Math.min(o.end - MIN_CLIP_SECONDS, o.start + dt)) }, key)
        }
        break
      }
      case 'clip-right': {
        const clip = st.project.clips.find((c) => c.id === drag.id)
        if (!clip) break
        const max = clip.kind === 'image' ? 60 : clip.sourceDuration
        const min = clip.kind === 'image' ? 1 : o.start + MIN_CLIP_SECONDS
        updateClip(drag.id, { end: Math.max(min, Math.min(max, o.end + dt)) }, key)
        break
      }
      case 'text-move':
        updateText(drag.id, { start: Math.max(0, o.start + dt) }, key)
        break
      case 'text-right':
        updateText(drag.id, { duration: Math.max(0.5, o.duration + dt) }, key)
        break
      case 'voice-move':
        updateVoice(drag.id, { start: Math.max(0, o.start + dt) }, key)
        break
    }
  }

  const onUp = (e: React.PointerEvent): void => {
    if (!drag) return
    const st = useEditor.getState()
    if (drag.kind === 'clip-move' && drag.moved) {
      // Drop position: index of the first clip whose middle is right of the dragged clip's middle.
      const me = placed.find((pc) => pc.clip.id === drag.id)
      if (me) {
        const t = me.at + me.length / 2 + (e.clientX - drag.startX) / pps
        const others = placed.filter((pc) => pc.clip.id !== drag.id)
        let to = others.findIndex((pc) => t < pc.at + pc.length / 2)
        if (to < 0) to = others.length
        moveClip(drag.id, to)
      }
    }
    if (!drag.moved && drag.kind !== 'scrub') {
      const kind = drag.kind.startsWith('clip') ? 'clip' : drag.kind.startsWith('text') ? 'text' : 'voice'
      st.select({ kind, id: drag.id })
      if (kind !== 'clip') {
        const item = kind === 'text' ? st.project.texts.find((x) => x.id === drag.id) : st.project.voices.find((x) => x.id === drag.id)
        if (item && (st.time < item.start || st.time >= item.start + item.duration)) st.seek(item.start + 0.01)
      } else {
        const pc = placed.find((p) => p.clip.id === drag.id)
        if (pc && (st.time < pc.at || st.time >= pc.at + pc.length)) st.seek(pc.at + pc.transitionIn)
      }
    }
    setDrag(null)
    setDragX(0)
  }

  const textLanes = lanes(project.texts)
  const voiceLanes = lanes(project.voices)
  const textRows = Math.max(1, ...textLanes.map((l) => l.lane + 1))
  const voiceRows = Math.max(1, ...voiceLanes.map((l) => l.lane + 1))
  const tickEvery = pps > 60 ? 1 : pps > 25 ? 2 : pps > 12 ? 5 : 10
  const ticks = Array.from({ length: Math.floor((contentW - 50) / pps / tickEvery) + 1 }, (_, i) => i * tickEvery)
  const isSel = (kind: string, id: string): boolean => selection?.kind === kind && selection.id === id

  // Where a dragged clip would land, for the drop marker.
  let dropMarker: number | null = null
  if (drag?.kind === 'clip-move' && drag.moved) {
    const pc = placed.find((p) => p.clip.id === drag.id)
    if (pc) {
      const t = pc.at + pc.length / 2 + dragX / pps
      const others = placed.filter((p) => p.clip.id !== drag.id)
      const to = others.findIndex((p) => t < p.at + p.length / 2)
      dropMarker = to < 0 ? (others.length ? others[others.length - 1].at + others[others.length - 1].length : 0) : others[to].at
    }
  }

  const clipBlock = (pc: PlacedClip): React.JSX.Element => {
    const c = pc.clip
    const thumb = c.kind === 'image' ? c.path : c.thumbPath
    const dragging = drag?.kind === 'clip-move' && drag.id === c.id && drag.moved
    const orig = { start: c.start, end: c.end, duration: pc.length }
    return (
      <div
        key={c.id}
        className={`block clip ${isSel('clip', c.id) ? 'selected' : ''} ${dragging ? 'dragging' : ''}`}
        style={{
          left: pc.at * pps,
          width: Math.max(pc.length * pps, 6),
          transform: dragging ? `translateX(${dragX}px)` : undefined,
          backgroundImage: thumb ? `url("${mediaUrl(thumb)}")` : undefined
        }}
        onPointerDown={(e) => begin(e, 'clip-move', c.id, orig)}
        title={c.name}
      >
        <div className="handle left" onPointerDown={(e) => begin(e, 'clip-left', c.id, orig)} />
        <span className="block-label">
          {c.kind === 'image' ? '🖼️' : '🎬'} {formatTime(pc.length)}
        </span>
        <div className="handle right" onPointerDown={(e) => begin(e, 'clip-right', c.id, orig)} />
      </div>
    )
  }

  return (
    <footer className={`timeline ${recording ? 'locked' : ''}`}>
      <div className="timeline-head">
        <span className="timeline-title">Línea de tiempo</span>
        <div className="zoom">
          <button className="btn round small" onClick={() => setZoom((z) => Math.max(0.5, z / 1.5))} aria-label="Alejar">
            −
          </button>
          <button className="btn ghost small" onClick={() => setZoom(1)}>
            Ver todo
          </button>
          <button className="btn round small" onClick={() => setZoom((z) => Math.min(20, z * 1.5))} aria-label="Acercar">
            +
          </button>
        </div>
      </div>

      <div className="timeline-body">
        <div className="track-labels" style={{ width: LABEL_W }}>
          <div className="ruler-spacer" />
          <div className="track-label tone-clip">🎬 Videos</div>
          <div className="track-label tone-text" style={{ height: 30 * textRows + 8 }}>
            🔤 Textos
          </div>
          <div className="track-label tone-voice" style={{ height: 30 * voiceRows + 8 }}>
            🎤 Voces
          </div>
          <div className="track-label tone-music" style={{ height: 38 }}>
            🎵 Música
          </div>
        </div>

        <div className="tracks-scroll" ref={scrollRef} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <div className="tracks" style={{ width: contentW }}>
            <div
              className="ruler"
              onPointerDown={(e) => begin(e, 'scrub', '', { start: 0, end: 0, duration: 0 })}
            >
              {ticks.map((s) => (
                <span key={s} className="tick" style={{ left: s * pps }}>
                  {formatTime(s)}
                </span>
              ))}
            </div>

            <div
              className="track track-clips"
              onPointerDown={(e) => {
                begin(e, 'scrub', '', { start: 0, end: 0, duration: 0 })
                useEditor.getState().select(null)
              }}
            >
              {placed.length === 0 && <span className="track-empty">Aquí aparecerán tus videos y fotos</span>}
              {placed.map(clipBlock)}
              {placed.slice(1).map((pc) => (
                <button
                  key={`tr-${pc.clip.id}`}
                  className={`transition-dot ${pc.clip.transition === 'none' ? 'none' : ''}`}
                  style={{ left: (pc.at + pc.transitionIn / 2) * pps }}
                  title="Cambiar transición"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    const st = useEditor.getState()
                    st.select({ kind: 'clip', id: pc.clip.id })
                    st.seek(pc.at + pc.transitionIn)
                  }}
                >
                  {TRANSITION_ICON[pc.clip.transition]}
                </button>
              ))}
              {dropMarker !== null && <div className="drop-marker" style={{ left: dropMarker * pps }} />}
            </div>

            <div
              className="track track-texts"
              style={{ height: 30 * textRows + 8 }}
              onPointerDown={(e) => {
                begin(e, 'scrub', '', { start: 0, end: 0, duration: 0 })
                useEditor.getState().select(null)
              }}
            >
              {textLanes.map(({ item: t, lane }) => (
                <div
                  key={t.id}
                  className={`block text ${isSel('text', t.id) ? 'selected' : ''}`}
                  style={{ left: t.start * pps, width: Math.max(t.duration * pps, 6), top: 4 + lane * 30 }}
                  onPointerDown={(e) => begin(e, 'text-move', t.id, { start: t.start, end: 0, duration: t.duration })}
                >
                  <span className="block-label">{t.text || '…'}</span>
                  <div
                    className="handle right"
                    onPointerDown={(e) => begin(e, 'text-right', t.id, { start: t.start, end: 0, duration: t.duration })}
                  />
                </div>
              ))}
            </div>

            <div
              className="track track-voices"
              style={{ height: 30 * voiceRows + 8 }}
              onPointerDown={(e) => {
                begin(e, 'scrub', '', { start: 0, end: 0, duration: 0 })
                useEditor.getState().select(null)
              }}
            >
              {voiceLanes.map(({ item: v, lane }) => (
                <div
                  key={v.id}
                  className={`block voice ${isSel('voice', v.id) ? 'selected' : ''}`}
                  style={{ left: v.start * pps, width: Math.max(v.duration * pps, 6), top: 4 + lane * 30 }}
                  onPointerDown={(e) => begin(e, 'voice-move', v.id, { start: v.start, end: 0, duration: v.duration })}
                >
                  <span className="block-label">🎤 {formatTime(v.duration)}</span>
                </div>
              ))}
            </div>

            <div
              className="track track-music"
              style={{ height: 38 }}
              onPointerDown={(e) => {
                begin(e, 'scrub', '', { start: 0, end: 0, duration: 0 })
                useEditor.getState().select(null)
              }}
            >
              {project.music ? (
                <div
                  className={`block music ${isSel('music', 'music') ? 'selected' : ''}`}
                  style={{ left: 0, width: Math.max(total * pps, 120), top: 6 }}
                  onPointerDown={(e) => {
                    if (recording || e.button !== 0) return
                    e.stopPropagation()
                    useEditor.getState().select({ kind: 'music', id: 'music' })
                  }}
                  title={project.music.name}
                >
                  <span className="block-label">🎵 {project.music.name}</span>
                </div>
              ) : (
                <button
                  className="track-add"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => pickMusic()}
                >
                  ＋ Poner música de fondo
                </button>
              )}
            </div>

            <div className="playhead" style={{ left: time * pps }}>
              <div className="playhead-knob" />
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}
