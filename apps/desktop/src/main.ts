import { homedir } from 'node:os'
import { BrowserWindow, app, dialog } from 'electron'
import { setup } from '@zaga/agent/setup'
import { WEB_PORT, getWebDistPath, startServers } from './servers.js'

const IS_DEV = !app.isPackaged

function isUnusableStartupCwd(cwd: string): boolean {
  if (!cwd || cwd === '/') return true
  const n = cwd.replace(/\\/g, '/')
  if (n.includes('.app/Contents/')) return true
  return false
}

function getInitialProjectPath(): string {
  const cwd = process.cwd()
  return isUnusableStartupCwd(cwd) ? homedir() : cwd
}

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
  const projectPath = getInitialProjectPath()

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

  if (!IS_DEV) {
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
  const message = err instanceof Error ? err.message : String(err)
  if (app.isReady()) {
    dialog.showErrorBox('Zaga Code failed to start', message)
  }
  app.quit()
})
