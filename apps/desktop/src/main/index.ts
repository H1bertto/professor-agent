import { app, ipcMain } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { IpcChannel } from '../shared/api'
import { checkCoreHealth, coreBaseUrl } from './core-health'
import { scheduleOverlayCapture } from './debug-capture'
import { createOverlayWindow } from './overlay-window'
import { showStatusWindow } from './status-window'
import { createTray } from './tray'

// A second copy of the app would put a second avatar on the screen.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.whenReady().then(() => {
    electronApp.setAppUserModelId('io.github.h1bertto.professoragent')

    // F12 toggles DevTools in development. Reload shortcuts are disabled in production.
    app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

    ipcMain.handle(IpcChannel.coreHealth, () => checkCoreHealth(coreBaseUrl()))

    const overlay = createOverlayWindow()
    scheduleOverlayCapture(overlay)

    const tray = createTray({
      isOverlayVisible: () => overlay.isVisible(),
      toggleOverlay: () => (overlay.isVisible() ? overlay.hide() : overlay.showInactive()),
      showStatus: showStatusWindow,
      quit: () => app.quit()
    })

    app.on('second-instance', () => {
      overlay.showInactive()
      tray.refresh()
    })
  })
}
