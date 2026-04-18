// eslint-disable-next-line import/no-commonjs
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('zaga', {
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickDirectory'),
})
