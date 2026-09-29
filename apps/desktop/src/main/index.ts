import { app, ipcMain, screen } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { IpcChannel } from '../shared/api'
import { resolveAvatarConfig } from './avatar-library'
import { handleAvatarProtocol, registerAvatarScheme } from './avatar-protocol'
import { checkCoreHealth, coreBaseUrl } from './core-health'
import { startCursorTracking } from './cursor-tracker'
import { scheduleOverlayCapture } from './debug-capture'
import { createOverlayWindow } from './overlay-window'
import { avatarRoots, settingsFile } from './paths'
import { SettingsStore } from './settings-store'
import { showStatusWindow } from './status-window'
import { createTray } from './tray'
import { clampToWorkArea, defaultOverlayBounds, overlaySize, type Rect } from './window-bounds'

registerAvatarScheme()

// A second copy of the app would put a second avatar on the screen.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.whenReady().then(start)
}

async function start(): Promise<void> {
  electronApp.setAppUserModelId('io.github.h1bertto.professoragent')

  // F12 toggles DevTools in development. Reload shortcuts are disabled in production.
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  handleAvatarProtocol(avatarRoots())
  const settings = await SettingsStore.load(settingsFile())

  ipcMain.handle(IpcChannel.coreHealth, () => checkCoreHealth(coreBaseUrl()))
  ipcMain.handle(IpcChannel.avatarGet, () => resolveAvatarConfig(settings.get().avatar))

  const overlay = createOverlayWindow(initialOverlayBounds(settings.get().overlayBounds))
  scheduleOverlayCapture(overlay)
  const stopCursorTracking = startCursorTracking(overlay)

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

  // Save pending settings before the app goes away.
  let settingsSaved = false
  app.on('before-quit', (event) => {
    if (settingsSaved) return
    event.preventDefault()
    stopCursorTracking()
    settings.flush().finally(() => {
      settingsSaved = true
      app.quit()
    })
  })
}

/** The saved position if it still fits a connected monitor, or the default corner. */
function initialOverlayBounds(saved: Rect | null): Rect {
  if (!saved) return defaultOverlayBounds(screen.getPrimaryDisplay().workArea)
  const sized = { ...saved, ...overlaySize(saved.height) }
  return clampToWorkArea(sized, screen.getDisplayMatching(sized).workArea)
}
