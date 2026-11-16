import { useEffect, useRef } from 'react'
import { projectDuration } from '@shared/project'
import { layoutText } from '../draw'
import { PreviewEngine } from '../engine'
import { formatTime, importPaths, updateText, useEditor } from '../store'

const CANVAS_W = 540
const CANVAS_H = 960

export function Preview(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null)
  const playing = useEditor((s) => s.playing)
  const time = useEditor((s) => s.time)
  const total = useEditor((s) => projectDuration(s.project))
  const empty = useEditor((s) => s.project.clips.length === 0)
  const safeZone = useEditor((s) => s.safeZone)
  const recording = useEditor((s) => s.recording)
  const micLive = useEditor((s) => s.micLive)

  useEffect(() => {
    const engine = new PreviewEngine(canvasRef.current!)
    engine.start()
    return () => engine.destroy()
  }, [])

  const toCanvas = (e: React.PointerEvent): { x: number; y: number } => {
    const r = canvasRef.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * CANVAS_W, y: ((e.clientY - r.top) / r.height) * CANVAS_H }
  }

  // Drag texts directly on the video.
  const onPointerDown = (e: React.PointerEvent): void => {
    const st = useEditor.getState()
    if (st.recording) return
    const ctx = canvasRef.current!.getContext('2d')!
    const scale = CANVAS_W / 1080
    const pt = toCanvas(e)
    const visible = st.project.texts.filter((t) => st.time >= t.start && st.time < t.start + t.duration)
    for (let i = visible.length - 1; i >= 0; i--) {
      const t = visible[i]
      const { box } = layoutText(ctx, t, scale)
      if (pt.x >= box.x && pt.x <= box.x + box.w && pt.y >= box.y && pt.y <= box.y + box.h) {
        st.setPlaying(false)
        st.select({ kind: 'text', id: t.id })
        drag.current = { id: t.id, dx: pt.x - t.x * CANVAS_W, dy: pt.y - t.y * CANVAS_H }
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        return
      }
    }
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    const d = drag.current
    if (!d) return
    const pt = toCanvas(e)
    const x = Math.max(0.05, Math.min(0.95, (pt.x - d.dx) / CANVAS_W))
    const y = Math.max(0.04, Math.min(0.96, (pt.y - d.dy) / CANVAS_H))
    updateText(d.id, { x, y }, `move-text-${d.id}`)
  }

  const st = useEditor.getState()

  return (
    <section className="preview" aria-label="Vista previa">
      <div className="phone">
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className="preview-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
        />
        {empty && (
          <div className="preview-empty">
            <div className="preview-empty-emoji" aria-hidden>
              🎥
            </div>
            <h2>¡Hagamos un video!</h2>
            <p>Agrega tus videos y fotos para empezar. También puedes arrastrarlos aquí.</p>
            <button className="btn primary big" onClick={() => importPaths(null)}>
              <span aria-hidden>🎬</span> Agregar
            </button>
          </div>
        )}
        {micLive && <div className="rec-badge">● GRABANDO</div>}
      </div>

      <div className="transport">
        <button
          className="btn round"
          disabled={empty || recording}
          onClick={() => {
            st.setPlaying(false)
            st.seek(0)
          }}
          title="Ir al inicio"
          aria-label="Ir al inicio"
        >
          ⏮
        </button>
        <button
          className="btn round play"
          disabled={empty || recording}
          onClick={() => st.setPlaying(!playing)}
          aria-label={playing ? 'Pausa' : 'Reproducir'}
          title={playing ? 'Pausa (espacio)' : 'Reproducir (espacio)'}
        >
          {playing ? '⏸' : '▶'}
        </button>
        <div className="transport-time">
          <strong>{formatTime(time)}</strong> / {formatTime(total)}
        </div>
        <button
          className={`chip ${safeZone ? 'on' : ''}`}
          onClick={st.toggleSafeZone}
          title="Muestra dónde TikTok pone sus botones, para que tu texto no quede tapado"
        >
          Zona segura TikTok
        </button>
      </div>
    </section>
  )
}
