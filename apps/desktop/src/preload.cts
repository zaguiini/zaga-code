import { contextBridge, ipcRenderer } from 'electron'
import type { Settings } from '@zaga/agent/settings' with { "resolution-mode": "import" }

contextBridge.exposeInMainWorld('zaga', {
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickDirectory'),
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  updateSettings: (data: Settings): Promise<{ ok: true }> =>
    ipcRenderer.invoke('settings:update', data),
})
