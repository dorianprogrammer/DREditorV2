import { useState } from 'react'
import { formatOf, projectDuration } from '@shared/project'
import { formatTime, setFormat, useEditor } from '../store'
import { ConfirmDialog } from './Overlays'

export function TopBar({ onExport }: { onExport: () => void }): React.JSX.Element {
  const canUndo = useEditor((s) => s.past.length > 0)
  const canRedo = useEditor((s) => s.future.length > 0)
  const total = useEditor((s) => projectDuration(s.project))
  const hasClips = useEditor((s) => s.project.clips.length > 0)
  const recording = useEditor((s) => s.recording)
  const format = useEditor((s) => formatOf(s.project))
  const [confirmNew, setConfirmNew] = useState(false)
  const st = useEditor.getState()
  const mod = window.api.platform === 'darwin' ? '⌘' : 'Ctrl+'

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden>
          ▶
        </span>
        <span className="brand-name">DR Editor</span>
      </div>

      <div className="topbar-group">
        <button className="btn ghost" disabled={!canUndo || recording} onClick={st.undo} title={`Deshacer (${mod}Z)`}>
          <span aria-hidden>↶</span> Deshacer
        </button>
        <button className="btn ghost" disabled={!canRedo || recording} onClick={st.redo} title={`Rehacer (${mod}Y)`}>
          <span aria-hidden>↷</span> Rehacer
        </button>
      </div>

      <div className="topbar-length" title="Duración de tu video">
        <span aria-hidden>⏱</span> {formatTime(total)}
      </div>

      <div className="format-switch" role="radiogroup" aria-label="Formato del video">
        <button
          role="radio"
          aria-checked={format === 'tiktok'}
          className={format === 'tiktok' ? 'on' : ''}
          disabled={recording}
          onClick={() => setFormat('tiktok')}
          title="Video vertical (9:16), para TikTok"
        >
          <span aria-hidden>📱</span> TikTok
        </button>
        <button
          role="radio"
          aria-checked={format === 'youtube'}
          className={format === 'youtube' ? 'on' : ''}
          disabled={recording}
          onClick={() => setFormat('youtube')}
          title="Video horizontal (16:9), para YouTube"
        >
          <span aria-hidden>📺</span> YouTube
        </button>
      </div>

      <div className="topbar-group right">
        <button className="btn ghost" disabled={recording} onClick={() => setConfirmNew(true)}>
          <span aria-hidden>✨</span> Nuevo
        </button>
        <button className="btn primary big" disabled={!hasClips || recording} onClick={onExport}>
          <span aria-hidden>💾</span> Guardar video
        </button>
      </div>

      {confirmNew && (
        <ConfirmDialog
          title="¿Empezar un video nuevo?"
          message="Se borrará el video que estás editando. Los videos que ya guardaste no se borran."
          confirmLabel="Sí, empezar de nuevo"
          onCancel={() => setConfirmNew(false)}
          onConfirm={async () => {
            setConfirmNew(false)
            await window.api.newProject()
            useEditor.getState().loadProject({ version: 1, clips: [], texts: [], voices: [] })
          }}
        />
      )}
    </header>
  )
}
