import { useEffect, useRef, useState } from 'react'
import type { ExportResult } from '@shared/project'
import { renderTextPng } from '../draw'
import { useEditor } from '../store'
import { Modal } from './Overlays'

export function ExportDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<ExportResult | null>(null)
  const [showDetails, setShowDetails] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const off = window.api.onExportProgress(setProgress)
    ;(async () => {
      const st = useEditor.getState()
      st.setPlaying(false)
      const project = st.project
      try {
        const textImages = await Promise.all(
          project.texts.filter((t) => t.text.trim()).map(async (t) => ({ id: t.id, png: await renderTextPng(t) }))
        )
        setResult(await window.api.exportVideo({ project, textImages }))
      } catch (err) {
        setResult({ ok: false, error: String(err) })
      } finally {
        off()
      }
    })()
  }, [])

  useEffect(() => {
    if (result?.cancelled) onClose()
  }, [result, onClose])
  if (result?.cancelled) return <></>

  if (!result) {
    const pct = Math.round(progress * 100)
    return (
      <Modal>
        <div className="export">
          <div className="export-emoji" aria-hidden>
            🎞️
          </div>
          <h2>Creando tu video…</h2>
          <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <p className="progress-pct">{pct}%</p>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => window.api.cancelExport()}>
              Cancelar
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  if (result.ok && result.path) {
    const path = result.path
    return (
      <Modal onClose={onClose}>
        <div className="export">
          <div className="export-emoji" aria-hidden>
            🎉
          </div>
          <h2>¡Tu video está listo!</h2>
          <p>
            Lo guardamos en la carpeta <strong>Videos › DR Editor</strong>. Ya puedes subirlo a TikTok.
          </p>
          <div className="modal-actions">
            <button className="btn primary" onClick={() => window.api.openPath(path)}>
              <span aria-hidden>▶</span> Ver mi video
            </button>
            <button className="btn" onClick={() => window.api.showItem(path)}>
              <span aria-hidden>📁</span> Abrir carpeta
            </button>
            <button className="btn ghost" onClick={onClose}>
              Cerrar
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal onClose={onClose}>
      <div className="export">
        <div className="export-emoji" aria-hidden>
          😕
        </div>
        <h2>Ups, algo salió mal</h2>
        <p>No se pudo crear el video. Inténtalo otra vez o pídele ayuda a un adulto.</p>
        <button className="btn ghost small" onClick={() => setShowDetails((v) => !v)}>
          {showDetails ? 'Ocultar detalles' : 'Ver detalles'}
        </button>
        {showDetails && <pre className="error-details">{result.error}</pre>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </Modal>
  )
}
