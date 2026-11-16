import '@fontsource-variable/nunito'
import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './components/App'
import { importPaths, useEditor } from './store'

// Lets automated UI tests import files without the OS file dialog. Not included in production builds.
if (import.meta.env.DEV) Object.assign(window, { __dev: { importPaths, useEditor } })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
