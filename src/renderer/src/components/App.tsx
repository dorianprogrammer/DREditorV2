import { useEffect, useState } from 'react'
import { deleteSelection, importPaths, splitAtPlayhead, startAutosave, useEditor } from '../store'
import { ExportDialog } from './ExportDialog'
import { Inspector } from './Inspector'
import { Preview } from './Preview'
import { RecordPanel } from './RecordPanel'
import { Timeline } from './Timeline'
import { ToolRail } from './ToolRail'
import { TopBar } from './TopBar'
import { BusyOverlay, Toast } from './Overlays'

export function App(): React.JSX.Element {
  const recording = useEditor((s) => s.recording)
  const [exporting, setExporting] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  useEffect(() => {
    let stop: (() => void) | null = null
    let cancelled = false
    window.api.loadProject().then(({ project, missing }) => {
      if (cancelled) return
      if (project) useEditor.getState().loadProject(project)
      if (missing) useEditor.getState().showToast('Algunos videos ya no están en la computadora y se quitaron')
      stop = startAutosave()
    })
    return () => {
      cancelled = true
      stop?.()
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      const { recording, busy } = useEditor.getState()
      if (target.closest('input, textarea, select') || recording || busy) return
      const st = useEditor.getState()
      const mod = e.ctrlKey || e.metaKey
      if (e.code === 'Space') {
        e.preventDefault()
        if (st.project.clips.length) st.setPlaying(!st.playing)
      } else if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) st.redo()
        else st.undo()
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        st.redo()
      } else if ((!mod && !e.altKey && e.key.toLowerCase() === 'c') || (mod && e.key.toLowerCase() === 'b')) {
        // Cut at the playhead: C ("Cortar") or Ctrl+B / ⌘B like other editors. Plain Ctrl+C stays copy.
        e.preventDefault()
        if (!e.repeat) splitAtPlayhead()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteSelection()
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        st.seek(st.time + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 1 / 30))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setDragOver(false)
    const paths = Array.from(e.dataTransfer.files).map((f) => window.api.pathForFile(f)).filter(Boolean)
    if (paths.length) importPaths(paths)
  }

  return (
    <div
      className="app"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={(e) => {
        if (!e.relatedTarget) setDragOver(false)
      }}
      onDrop={onDrop}
    >
      <TopBar onExport={() => setExporting(true)} />
      <main className="workspace">
        <ToolRail />
        <Preview />
        <aside className="side-panel">{recording ? <RecordPanel /> : <Inspector />}</aside>
      </main>
      <Timeline />
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
      {dragOver && (
        <div className="drop-hint">
          <div>
            <span aria-hidden>📥</span>
            Suelta aquí tus videos y fotos
          </div>
        </div>
      )}
      <BusyOverlay />
      <Toast />
    </div>
  )
}
