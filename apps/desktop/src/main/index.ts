import { app, dialog, globalShortcut, ipcMain, screen, type IpcMainInvokeEvent } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { IpcChannel, type AvatarPreview, type CoreStatus } from '../shared/api'
import type { AvatarChoice } from '../shared/avatar'
import { avatarOptions, effectiveAvatar, resolveAvatarConfig } from './avatar-library'
import { handleAvatarProtocol, registerAvatarScheme } from './avatar-protocol'
import { CoreClient, coreSocketUrl, coreToken } from './core-client'
import { startCursorTracking } from './cursor-tracker'
import { devAvatarOverride, scheduleOverlayCapture } from './debug-capture'
import { KeyVault } from './key-vault'
import { registerOverlayControls } from './overlay-controls'
import { createOverlayWindow } from './overlay-window'
import { avatarRoots, settingsFile } from './paths'
import { SettingsStore } from './settings-store'
import { isSettingsWindow, sendToSettingsWindow, showSettingsWindow } from './settings-window'
import { systemCipher } from './system-cipher'
import { createTray, TOGGLE_OVERLAY_SHORTCUT } from './tray'
import { TutorSettings } from './tutor-settings'
import { importPngTuberFolder, importVrm, listUserAvatars } from './user-avatars'
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

  const roots = avatarRoots()
  handleAvatarProtocol(roots)
  const settings = await SettingsStore.load(settingsFile())
  let userAvatars = await listUserAvatars(roots.user)
  let preview: AvatarPreview = { emotion: 'neutral', talking: false }

  const core = new CoreClient({
    url: coreSocketUrl(),
    token: coreToken(),
    clientName: `desktop/${app.getVersion()}`
  })
  const tutorSettings = new TutorSettings(settings, new KeyVault(systemCipher), core)
  const coreStatus = (): CoreStatus => ({
    connection: core.currentStatus,
    version: core.coreVersion
  })
  core.onStatus(() => sendToSettingsWindow(IpcChannel.coreStatusChanged, coreStatus()))
  // The client keeps this until the core is ready, and sends it again after every reconnection.
  core.send(tutorSettings.configureMessage())
  core.start()
  registerSettingsHandlers(tutorSettings, coreStatus)

  const currentChoice = (): AvatarChoice => devAvatarOverride() ?? settings.get().avatar
  ipcMain.handle(IpcChannel.avatarGet, () => resolveAvatarConfig(currentChoice(), userAvatars))

  const overlay = createOverlayWindow(initialOverlayBounds(settings.get().overlayBounds))
  registerOverlayControls(overlay, (overlayBounds) => settings.update({ overlayBounds }))
  scheduleOverlayCapture(overlay)
  const stopCursorTracking = startCursorTracking(overlay)

  const sendToOverlay = (channel: string, payload: unknown): void => {
    if (!overlay.isDestroyed()) overlay.webContents.send(channel, payload)
  }

  const selectAvatar = (avatar: AvatarChoice): void => {
    settings.update({ avatar })
    sendToOverlay(IpcChannel.avatarChanged, resolveAvatarConfig(avatar, userAvatars))
    tray.refresh()
  }

  const importAvatar = async (kind: 'vrm' | 'pngtuber'): Promise<void> => {
    const result = await dialog.showOpenDialog(
      kind === 'vrm'
        ? {
            title: 'Import a VRM avatar',
            filters: [{ name: 'VRM avatar', extensions: ['vrm'] }],
            properties: ['openFile']
          }
        : { title: 'Import a PNGTuber folder', properties: ['openDirectory'] }
    )
    const [path] = result.filePaths
    if (result.canceled || !path) return
    try {
      const avatar =
        kind === 'vrm'
          ? await importVrm(roots.user, path)
          : await importPngTuberFolder(roots.user, path)
      userAvatars = await listUserAvatars(roots.user)
      selectAvatar({ kind: avatar.kind, id: avatar.id })
    } catch (error) {
      dialog.showErrorBox(
        'Could not import the avatar',
        error instanceof Error ? error.message : String(error)
      )
    }
  }

  const setPreview = (changes: Partial<AvatarPreview>): void => {
    preview = { ...preview, ...changes }
    sendToOverlay(IpcChannel.overlayPreview, preview)
  }

  const toggleOverlay = (): void => {
    if (overlay.isVisible()) overlay.hide()
    else overlay.showInactive()
    tray.refresh()
  }

  const tray = createTray({
    state: () => ({
      overlayVisible: overlay.isVisible(),
      avatars: avatarOptions(userAvatars),
      currentAvatarId: effectiveAvatar(currentChoice(), userAvatars).id,
      emotion: preview.emotion,
      talking: preview.talking
    }),
    toggleOverlay,
    selectAvatar,
    importVrm: () => void importAvatar('vrm'),
    importPngTuber: () => void importAvatar('pngtuber'),
    previewEmotion: (emotion) => setPreview({ emotion }),
    previewTalking: (talking) => setPreview({ talking }),
    resetPosition: () => {
      const bounds = defaultOverlayBounds(
        screen.getPrimaryDisplay().workArea,
        overlay.getBounds().height
      )
      overlay.setBounds(bounds)
      settings.update({ overlayBounds: bounds })
    },
    showSettings: showSettingsWindow,
    quit: () => app.quit()
  })

  if (!globalShortcut.register(TOGGLE_OVERLAY_SHORTCUT, toggleOverlay)) {
    console.warn(`Another app already uses ${TOGGLE_OVERLAY_SHORTCUT}.`)
  }

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
    core.stop()
    globalShortcut.unregisterAll()
    settings.flush().finally(() => {
      settingsSaved = true
      app.quit()
    })
  })
}

/** The provider settings hold the API key, so only the settings window may reach them. */
function registerSettingsHandlers(
  tutorSettings: TutorSettings,
  coreStatus: () => CoreStatus
): void {
  const fromSettingsWindow = (event: IpcMainInvokeEvent): void => {
    if (!isSettingsWindow(event.sender)) throw new Error('Only the settings window can do this.')
  }
  ipcMain.handle(IpcChannel.coreStatus, () => coreStatus())
  ipcMain.handle(IpcChannel.settingsGet, (event) => {
    fromSettingsWindow(event)
    return tutorSettings.view()
  })
  ipcMain.handle(IpcChannel.settingsSave, (event, form: unknown) => {
    fromSettingsWindow(event)
    return tutorSettings.save(form)
  })
  ipcMain.handle(IpcChannel.settingsTestProvider, (event, provider: unknown) => {
    fromSettingsWindow(event)
    return tutorSettings.testProvider(provider)
  })
}

/** The saved position if it still fits a connected monitor, or the default corner. */
function initialOverlayBounds(saved: Rect | null): Rect {
  if (!saved) return defaultOverlayBounds(screen.getPrimaryDisplay().workArea)
  const sized = { ...saved, ...overlaySize(saved.height) }
  return clampToWorkArea(sized, screen.getDisplayMatching(sized).workArea)
}
