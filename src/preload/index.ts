import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ExportRequest, ExportResult, MediaInfo, Project, SoundRange } from '../shared/project'

type Prepared = { items: MediaInfo[]; failed: string[] }

const api = {
  platform: process.platform,
  pickMedia: (): Promise<Prepared> => ipcRenderer.invoke('media:pick'),
  prepareMedia: (paths: string[]): Promise<Prepared> => ipcRenderer.invoke('media:prepare', paths),
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  onMediaProgress: (cb: (p: { done: number; total: number }) => void): (() => void) => {
    const fn = (_e: unknown, p: { done: number; total: number }): void => cb(p)
    ipcRenderer.on('media:progress', fn)
    return () => ipcRenderer.removeListener('media:progress', fn)
  },
  findSound: (path: string, start: number, end: number): Promise<SoundRange[]> =>
    ipcRenderer.invoke('media:findSound', path, start, end),
  askMic: (): Promise<boolean> => ipcRenderer.invoke('mic:ask'),
  saveVoice: (data: Uint8Array): Promise<{ path: string; duration: number }> => ipcRenderer.invoke('voice:save', data),
  loadProject: (): Promise<{ project: Project | null; missing: number }> => ipcRenderer.invoke('project:load'),
  saveProject: (json: string): Promise<void> => ipcRenderer.invoke('project:save', json),
  newProject: (): Promise<void> => ipcRenderer.invoke('project:new'),
  exportVideo: (req: ExportRequest): Promise<ExportResult> => ipcRenderer.invoke('export:start', req),
  cancelExport: (): Promise<void> => ipcRenderer.invoke('export:cancel'),
  onExportProgress: (cb: (fraction: number) => void): (() => void) => {
    const fn = (_e: unknown, f: number): void => cb(f)
    ipcRenderer.on('export:progress', fn)
    return () => ipcRenderer.removeListener('export:progress', fn)
  },
  showItem: (p: string): Promise<void> => ipcRenderer.invoke('shell:showItem', p),
  openPath: (p: string): Promise<string> => ipcRenderer.invoke('shell:openPath', p)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
