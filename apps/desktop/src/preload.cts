import { contextBridge, ipcRenderer } from 'electron'
import type { Settings } from '@zaga/agent/settings' with { 'resolution-mode': 'import' }

contextBridge.exposeInMainWorld('zaga', {
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickDirectory'),
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  updateSettings: (data: Settings): Promise<{ ok: true }> =>
    ipcRenderer.invoke('settings:update', data),
  getSystemTheme: (): Promise<'light' | 'dark'> => ipcRenderer.invoke('theme:getSystem'),
  onSystemThemeChange: (listener: (theme: 'light' | 'dark') => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, theme: 'light' | 'dark') => listener(theme)
    ipcRenderer.on('theme:system-changed', wrapped)
    return () => ipcRenderer.removeListener('theme:system-changed', wrapped)
  },
})
