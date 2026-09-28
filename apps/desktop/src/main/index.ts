import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { IpcChannel } from '../shared/api'
import { checkCoreHealth, coreBaseUrl } from './core-health'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 480,
    height: 320,
    show: false,
    autoHideMenuBar: true,
    title: 'Professor Agent',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  // Only https links can leave the app, and they always open in the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())

  // electron-vite serves the renderer with HMR in development.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('io.github.h1bertto.professoragent')

  // F12 toggles DevTools in development. Reload shortcuts are disabled in production.
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  ipcMain.handle(IpcChannel.coreHealth, () => checkCoreHealth(coreBaseUrl()))

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
