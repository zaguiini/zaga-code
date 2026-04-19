import { contextBridge, ipcRenderer } from 'electron'
import type { Settings } from '@zaga/agent/settings' with { "resolution-mode": "import" }

contextBridge.exposeInMainWorld('zaga', {
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickDirectory'),
  getSettings: (path?: string): Promise<Settings> => ipcRenderer.invoke('settings:get', path),
  updateSettings: (path: string, data: Settings): Promise<{ ok: true }> =>
    ipcRenderer.invoke('settings:update', data, path),
})
