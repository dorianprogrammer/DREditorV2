import { useEffect, useState } from 'react'
import { useEditor } from '../store'

export function Modal({ children, onClose }: { children: React.ReactNode; onClose?: () => void }): React.JSX.Element {
  useEffect(() => {
    if (!onClose) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  )
}

export function ConfirmDialog(props: {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <Modal onClose={props.onCancel}>
      <h2>{props.title}</h2>
      <p>{props.message}</p>
      <div className="modal-actions">
        <button className="btn ghost" onClick={props.onCancel} autoFocus>
          No, volver
        </button>
        <button className="btn danger" onClick={props.onConfirm}>
          {props.confirmLabel}
        </button>
      </div>
    </Modal>
  )
}

/** Shown while imported videos are being prepared (thumbnails, playable copies) or a long task runs. */
export function BusyOverlay(): React.JSX.Element | null {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  useEffect(
    () =>
      window.api.onMediaProgress((p) => {
        setProgress(p.done >= p.total ? null : p)
      }),
    []
  )
  const busy = useEditor((s) => s.busy)
  if (!progress && !busy) return null
  return (
    <div className="modal-backdrop">
      <div className="modal busy">
        <div className="spinner" aria-hidden />
        {progress ? (
          <>
            <h2>Preparando tus videos…</h2>
            <p>
              {progress.done + 1} de {progress.total}
            </p>
          </>
        ) : (
          <h2>{busy}</h2>
        )}
      </div>
    </div>
  )
}

export function Toast(): React.JSX.Element | null {
  const toast = useEditor((s) => s.toast)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!toast) return
    setVisible(true)
    const id = setTimeout(() => setVisible(false), 3500)
    return () => clearTimeout(id)
  }, [toast])
  if (!toast || !visible) return null
  return (
    <div className="toast" role="status" key={toast.id}>
      {toast.text}
    </div>
  )
}
