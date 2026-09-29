import { BrowserWindow, ipcMain, screen } from 'electron'
import { IpcChannel } from '../shared/api'
import { defaultOverlayBounds } from './window-bounds'
import { hardenWebContents, loadRendererPage, PRELOAD_PATH } from './window-helpers'

/** The transparent window that shows the avatar on top of every other app. */
export function createOverlayWindow(): BrowserWindow {
  const window = new BrowserWindow({
    ...defaultOverlayBounds(screen.getPrimaryDisplay().workArea),
    title: 'Professor Agent Overlay',
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // Clicking the avatar must not steal focus from the app the student is using.
    focusable: false,
    webPreferences: {
      preload: PRELOAD_PATH,
      sandbox: true
    }
  })

  window.setAlwaysOnTop(true, 'screen-saver')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // Clicks pass through the whole window for now. The avatar hit test turns them back on.
  window.setIgnoreMouseEvents(true, { forward: true })
  hardenWebContents(window)

  const onReady = (event: Electron.IpcMainEvent): void => {
    if (event.sender === window.webContents) window.showInactive()
  }
  ipcMain.on(IpcChannel.overlayReady, onReady)
  window.on('closed', () => ipcMain.off(IpcChannel.overlayReady, onReady))

  loadRendererPage(window, 'overlay.html')
  return window
}
