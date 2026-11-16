import { addText, canSplit, deleteSelection, importPaths, splitAtPlayhead, useEditor } from '../store'

export function ToolRail(): React.JSX.Element {
  const recording = useEditor((s) => s.recording)
  const hasSelection = useEditor((s) => s.selection !== null)
  const splittable = useEditor((s) => canSplit(s.project, s.time))

  return (
    <nav className="tool-rail" aria-label="Herramientas">
      <button className="tool tool-media" disabled={recording} onClick={() => importPaths(null)}>
        <span className="tool-icon" aria-hidden>
          🎬
        </span>
        Videos y fotos
      </button>
      <button className="tool tool-text" disabled={recording} onClick={addText}>
        <span className="tool-icon" aria-hidden>
          🔤
        </span>
        Texto
      </button>
      <button
        className="tool tool-voice"
        disabled={recording}
        onClick={() => {
          const st = useEditor.getState()
          st.setPlaying(false)
          st.select(null)
          st.setRecording(true)
        }}
      >
        <span className="tool-icon" aria-hidden>
          🎤
        </span>
        Grabar voz
      </button>
      <div className="tool-divider" />
      <button className="tool small" disabled={recording || !splittable} onClick={splitAtPlayhead} title={`Corta el video donde está la línea roja (C o ${window.api.platform === 'darwin' ? '⌘B' : 'Ctrl+B'})`}>
        <span className="tool-icon" aria-hidden>
          ✂️
        </span>
        Cortar aquí
      </button>
      <button className="tool small danger" disabled={recording || !hasSelection} onClick={deleteSelection}>
        <span className="tool-icon" aria-hidden>
          🗑️
        </span>
        Borrar
      </button>
    </nav>
  )
}
