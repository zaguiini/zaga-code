import { existsSync, statSync, symlinkSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, Menu, app, dialog, ipcMain, nativeTheme } from 'electron'
import { parseSettings, writeSettings } from '@zaga/agent/settings'
import { WEB_PORT, getWebDistPath, startServers } from './servers.js'
import type { Settings } from '@zaga/agent/settings'

const __dirname = dirname(fileURLToPath(import.meta.url))

const IS_DEV = !app.isPackaged

function isUnusableStartupCwd(cwd: string): boolean {
  if (!cwd || cwd === '/') return true
  const n = cwd.replace(/\\/g, '/')
  if (n.includes('.app/Contents/')) return true
  return false
}

function getCliPathArg(): string | null {
  // In Electron, process.argv is [electron, main-script, ...user-args]
  // In packaged apps, process.argv is [app-binary, ...user-args]
  const userArgs = app.isPackaged ? process.argv.slice(1) : process.argv.slice(2)
  const candidate = userArgs.find(a => !a.startsWith('-'))
  if (!candidate) return null
  const abs = resolve(process.cwd(), candidate)
  try {
    if (existsSync(abs) && statSync(abs).isDirectory()) return abs
  } catch {
    /* ignore */
  }
  return null
}

function getInitialProjectPath(): string {
  const explicit = getCliPathArg()
  if (explicit) return explicit
  const cwd = process.cwd()
  return isUnusableStartupCwd(cwd) ? homedir() : cwd
}

function buildUrl(projectPath: string | null): string {
  const base = `http://localhost:${WEB_PORT}`
  return projectPath ? `${base}/?projectPath=${encodeURIComponent(projectPath)}` : base
}

let mainWindow: BrowserWindow | null = null

function getSystemTheme(): 'light' | 'dark' {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}

function createWindow(url: string) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, '..', 'dist', 'preload.cjs'),
    },
  })
  mainWindow.loadURL(url)
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

const SYMLINK_PATH = '/usr/local/bin/zaga'

function getCliSourcePath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'bin', 'zaga')
  }
  return join(__dirname, '..', 'bin', 'zaga')
}

async function installCli() {
  const source = getCliSourcePath()
  try {
    if (existsSync(SYMLINK_PATH)) unlinkSync(SYMLINK_PATH)
    symlinkSync(source, SYMLINK_PATH)
    dialog.showMessageBox({
      type: 'info',
      message: "Command 'zaga' installed",
      detail: `You can now run 'zaga' from the terminal.\n\nSymlink: ${SYMLINK_PATH} → ${source}`,
    })
  } catch {
    // Likely a permissions error — retry with elevated privileges via osascript
    const { execFile } = await import('node:child_process')
    const script = `do shell script "ln -sf '${source}' '${SYMLINK_PATH}'" with administrator privileges`
    execFile('osascript', ['-e', script], err => {
      if (err) {
        dialog.showErrorBox(
          'Failed to install CLI',
          `Could not create symlink at ${SYMLINK_PATH}.\n\n${err.message}`
        )
      } else {
        dialog.showMessageBox({
          type: 'info',
          message: "Command 'zaga' installed",
          detail: `You can now run 'zaga' from the terminal.`,
        })
      }
    })
  }
}

function setupMenu() {
  const template: Array<Electron.MenuItemConstructorOptions> = [
    { role: 'appMenu' },
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'Shell',
      submenu: [
        {
          label: "Install 'zaga' command in PATH",
          click: () => installCli(),
        },
      ],
    },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
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

  setupMenu()

  ipcMain.handle('dialog:pickDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle('settings:get', _event => {
    return parseSettings()
  })

  ipcMain.handle('settings:update', async (_event, data: Settings) => {
    await writeSettings(data)
    return { ok: true }
  })
  ipcMain.handle('theme:getSystem', () => getSystemTheme())

  nativeTheme.on('updated', () => {
    const theme = getSystemTheme()
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('theme:system-changed', theme)
    }
  })

  if (!IS_DEV) {
    startServers(getWebDistPath())
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
