import { BrowserWindow, app } from 'electron'
import { setup } from '@zaga/agent/setup'
import { AGENT_PORT, WEB_PORT, getWebDistPath, startServers } from './servers.js'

const IS_DEV = !app.isPackaged

function buildUrl(projectPath: string | null): string {
  const base = `http://localhost:${WEB_PORT}`
  return projectPath ? `${base}/?projectPath=${encodeURIComponent(projectPath)}` : base
}

let mainWindow: BrowserWindow | null = null

function createWindow(url: string) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })
  mainWindow.loadURL(url)
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

async function main() {
  const projectPath = process.cwd()

  const gotLock = app.requestSingleInstanceLock({ projectPath })
  if (!gotLock) {
    app.quit()
    return
  }

  app.on('second-instance', (_event, _argv, _cwd, data) => {
    const { projectPath: incomingPath } = data as { projectPath: string | null }
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      mainWindow.loadURL(buildUrl(incomingPath))
    }
  })

  await app.whenReady()

  await setup({ logLevel: 'verbose' })

  if (IS_DEV) {
    const { startAgentServer } = await import('@zaga/agent/server')
    await startAgentServer(AGENT_PORT)
  } else {
    await startServers(getWebDistPath())
  }

  createWindow(buildUrl(projectPath))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(buildUrl(null))
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

main().catch(err => {
  console.error('Startup error:', err)
  app.quit()
})
