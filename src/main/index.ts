import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell, systemPreferences } from 'electron'
import { existsSync, mkdirSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExportRequest, ExportResult, MediaInfo, Project } from '../shared/project'
import { cancelExport, findSound, IMAGE_EXTS, prepareMedia, renderVideo, saveVoice, VIDEO_EXTS } from './ffmpeg'
import { handleMediaProtocol, registerMediaScheme } from './media-protocol'

registerMediaScheme()

// Dev-only: a fake microphone (test tone) so recording can be tested without a real mic or permission prompt.
const fakeMic = !app.isPackaged && process.env['DREDITOR_FAKE_MIC'] === '1'
if (fakeMic) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream')
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
}

let win: BrowserWindow | null = null

const projectDir = (): string => join(app.getPath('userData'), 'proyecto')
const projectFile = (): string => join(projectDir(), 'proyecto.json')
const voicesDir = (): string => join(projectDir(), 'voces')

function createWindow(): void {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 700,
    title: 'DR Editor',
    backgroundColor: '#14112b',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.once('ready-to-show', () => {
    win?.maximize()
    win?.show()
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function prepareAll(paths: string[]): Promise<{ items: MediaInfo[]; failed: string[] }> {
  const items: MediaInfo[] = []
  const failed: string[] = []
  for (let i = 0; i < paths.length; i++) {
    win?.webContents.send('media:progress', { done: i, total: paths.length })
    try {
      items.push(await prepareMedia(paths[i]))
    } catch (err) {
      console.error('prepareMedia failed', paths[i], err)
      failed.push(paths[i])
    }
  }
  win?.webContents.send('media:progress', { done: paths.length, total: paths.length })
  return { items, failed }
}

function registerIpc(): void {
  ipcMain.handle('media:pick', async () => {
    const exts = [...VIDEO_EXTS, ...IMAGE_EXTS].map((e) => e.slice(1))
    const res = await dialog.showOpenDialog(win!, {
      title: 'Elige tus videos y fotos',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Videos y fotos', extensions: exts }]
    })
    if (res.canceled) return { items: [], failed: [] }
    return prepareAll(res.filePaths)
  })

  ipcMain.handle('media:prepare', (_e, paths: string[]) => prepareAll(paths))

  ipcMain.handle('media:findSound', (_e, file: string, start: number, end: number) => findSound(file, start, end))

  ipcMain.handle('voice:save', (_e, data: Uint8Array) => saveVoice(data, voicesDir()))

  ipcMain.handle('mic:ask', async () => {
    if (process.platform !== 'darwin' || fakeMic) return true
    return systemPreferences.askForMediaAccess('microphone')
  })

  ipcMain.handle('project:load', async (): Promise<{ project: Project | null; missing: number }> => {
    try {
      const project = JSON.parse(await fs.readFile(projectFile(), 'utf8')) as Project
      const before = project.clips.length + project.voices.length
      project.clips = project.clips.filter((c) => existsSync(c.path))
      project.voices = project.voices.filter((v) => existsSync(v.path))
      return { project, missing: before - project.clips.length - project.voices.length }
    } catch {
      return { project: null, missing: 0 }
    }
  })

  // Saves run one at a time; each writes a temp file and renames it so a crash never leaves a half-written project.
  let saving: Promise<void> = Promise.resolve()
  ipcMain.handle('project:save', (_e, json: string) => {
    saving = saving
      .catch(() => {})
      .then(async () => {
        mkdirSync(projectDir(), { recursive: true })
        const tmp = `${projectFile()}.${Date.now()}.tmp`
        await fs.writeFile(tmp, json)
        await fs.rename(tmp, projectFile())
      })
    return saving
  })

  ipcMain.handle('project:new', async () => {
    await fs.rm(voicesDir(), { recursive: true, force: true })
    await fs.rm(projectFile(), { force: true })
  })

  ipcMain.handle('export:start', async (_e, req: ExportRequest): Promise<ExportResult> => {
    const workDir = join(tmpdir(), `dreditor-${Date.now()}`)
    mkdirSync(workDir, { recursive: true })
    try {
      const textFiles = new Map<string, string>()
      for (const t of req.textImages) {
        const file = join(workDir, `texto-${t.id}.png`)
        await fs.writeFile(file, t.png)
        textFiles.set(t.id, file)
      }
      const outDir = join(app.getPath('videos'), 'DR Editor')
      mkdirSync(outDir, { recursive: true })
      const d = new Date()
      const pad = (n: number): string => String(n).padStart(2, '0')
      const stamp = `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`
      const outPath = join(outDir, `Mi video ${stamp}.mp4`)
      const partPath = join(workDir, 'video.mp4')

      const status = await renderVideo(req.project, textFiles, workDir, partPath, (f) =>
        win?.webContents.send('export:progress', f)
      )
      if (status === 'cancelled') return { ok: false, cancelled: true }
      await fs.copyFile(partPath, outPath)
      return { ok: true, path: outPath }
    } catch (err) {
      console.error('export failed', err)
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      fs.rm(workDir, { recursive: true, force: true }).catch(() => {})
    }
  })

  ipcMain.handle('export:cancel', () => cancelExport())
  ipcMain.handle('shell:showItem', (_e, p: string) => shell.showItemInFolder(p))
  ipcMain.handle('shell:openPath', (_e, p: string) => shell.openPath(p))
}

app.whenReady().then(() => {
  // Windows: no menu bar for kids. Mac keeps the default menu so Cmd+C/V/Q work.
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null)

  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'))
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media')

  handleMediaProtocol()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  cancelExport()
  app.quit()
})
