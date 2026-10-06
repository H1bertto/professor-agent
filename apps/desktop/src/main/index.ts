import { app, dialog, globalShortcut, ipcMain, screen, type IpcMainInvokeEvent } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { IpcChannel, type AvatarPose, type CoreStatus, type TalkSettings } from '../shared/api'
import type { AvatarChoice } from '../shared/avatar'
import { avatarOptions, effectiveAvatar, resolveAvatarConfig } from './avatar-library'
import { handleAvatarProtocol, registerAvatarScheme } from './avatar-protocol'
import { createCompanionWindows } from './companion-windows'
import { CoreClient, coreSocketUrl, coreToken } from './core-client'
import { startCursorTracking } from './cursor-tracker'
import {
  devAvatarOverride,
  devProviderOverride,
  scheduleDevAsk,
  scheduleOverlayCapture
} from './debug-capture'
import {
  devConversationRequested,
  devTalkRequested,
  devVoiceOverride,
  FileMicrophone,
  SpeechRecorder
} from './dev-voice'
import { KeyVault } from './key-vault'
import { registerOverlayControls } from './overlay-controls'
import { createOverlayWindow } from './overlay-window'
import { avatarRoots, settingsFile } from './paths'
import { SettingsStore } from './settings-store'
import { isSettingsWindow, sendToSettingsWindow, showSettingsWindow } from './settings-window'
import { systemCipher } from './system-cipher'
import { ASK_SHORTCUT, createTray, TOGGLE_OVERLAY_SHORTCUT } from './tray'
import { Tutor } from './tutor'
import { TutorSettings } from './tutor-settings'
import { importPngTuberFolder, importVrm, listUserAvatars } from './user-avatars'
import { guardPermissions, registerVoiceChannels } from './voice-channels'
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
  let pose: AvatarPose = { state: 'idle', emotion: 'neutral', talking: false }

  const core = new CoreClient({
    url: coreSocketUrl(),
    token: coreToken(),
    clientName: `desktop/${app.getVersion()}`
  })
  const tutorSettings = new TutorSettings(
    settings,
    new KeyVault(systemCipher),
    core,
    undefined,
    (next) => applyTalk(next)
  )
  const coreStatus = (): CoreStatus => ({
    connection: core.currentStatus,
    version: core.coreVersion
  })
  core.onStatus(() => sendToSettingsWindow(IpcChannel.coreStatusChanged, coreStatus()))
  // The client keeps this until the core is ready, and sends it again after every reconnection.
  const devProvider = devProviderOverride()
  const devVoice = devVoiceOverride()
  core.send({
    ...tutorSettings.configureMessage(),
    ...(devProvider && { provider: devProvider }),
    ...(devVoice && { voice: devVoice })
  })
  core.start()
  registerSettingsHandlers(tutorSettings, coreStatus)

  const currentChoice = (): AvatarChoice => devAvatarOverride() ?? settings.get().avatar
  ipcMain.handle(IpcChannel.avatarGet, () => resolveAvatarConfig(currentChoice(), userAvatars))

  const overlay = createOverlayWindow(initialOverlayBounds(settings.get().overlayBounds))
  guardPermissions(overlay)
  registerOverlayControls(overlay, (overlayBounds) => settings.update({ overlayBounds }))
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

  const setPose = (changes: Partial<AvatarPose>): void => {
    pose = { ...pose, ...changes }
    sendToOverlay(IpcChannel.overlayPose, pose)
  }

  const toggleOverlay = (): void => {
    if (overlay.isVisible()) overlay.hide()
    else overlay.showInactive()
    tray.refresh()
  }

  // Development stand-ins for the microphone and the student's ears. See dev-voice.ts.
  const fileMicrophone = await FileMicrophone.load()
  const speechRecorder = SpeechRecorder.fromEnv()
  let devTalkPending = devTalkRequested()
  const tutor = new Tutor(core, {
    answer: (answer) => companions.showAnswer(answer),
    pose: setPose,
    microphone: (on) => {
      if (fileMicrophone) fileMicrophone.set(on, (pcm) => tutor.hear(pcm))
      else sendToOverlay(IpcChannel.overlayMicrophone, on)
    },
    speech: (command) => {
      speechRecorder?.handle(command)
      sendToOverlay(IpcChannel.overlaySpeech, command)
    },
    conversation: (view) => {
      tray.refresh()
      sendToOverlay(IpcChannel.overlayConversation, view)
    },
    voiceStatus: (status) => {
      sendToSettingsWindow(IpcChannel.voiceStatusChanged, status)
      if (devTalkPending && status.state === 'ready') {
        devTalkPending = false
        setTimeout(() => talk(), 1000)
      }
    }
  })
  ipcMain.handle(IpcChannel.voiceStatus, () => tutor.voiceStatus)
  registerVoiceChannels(overlay, {
    microphoneAudio: (pcm) => tutor.hear(pcm),
    microphoneFailed: (message) => tutor.microphoneFailed(message),
    speechReport: (report) => {
      speechRecorder?.report(report)
      tutor.speechReport(report)
    }
  })
  const talk = (): void => {
    // Tells, while developing, whether the hotkey reached the app at all.
    if (!app.isPackaged) console.log(`Talk hotkey, answer ${tutor.current?.status ?? 'none'}`)
    // The bubble shows only beside a visible avatar.
    if (!overlay.isVisible()) {
      overlay.showInactive()
      tray.refresh()
    }
    tutor.listen()
  }
  // The talk hotkey comes from the settings. A new one replaces the old only if it registers.
  let talkHotkey: string | null = null
  const setTalkHotkey = (accelerator: string): string | null => {
    if (accelerator === talkHotkey) return null
    const register = (key: string): boolean => {
      try {
        return globalShortcut.register(key, talk)
      } catch {
        return false
      }
    }
    const previous = talkHotkey
    if (previous) globalShortcut.unregister(previous)
    if (register(accelerator)) {
      talkHotkey = accelerator
      return null
    }
    if (previous) register(previous)
    return 'Another app already uses this shortcut. Choose another one.'
  }
  const applyConversation = (next: TalkSettings): void =>
    tutor.setConversation(next.mode === 'conversation', next.autoPauseMinutes * 60_000)
  const applyTalk = (next: TalkSettings): string | null => {
    const problem = setTalkHotkey(next.hotkey)
    if (problem) return problem
    applyConversation(next)
    tray.refresh()
    return null
  }
  const companions = createCompanionWindows(overlay, {
    teacherName: () => settings.get().persona.name,
    ask: (question) => tutor.ask(question),
    cancel: () => tutor.cancel()
  })
  scheduleOverlayCapture(overlay, companions.bubbleWindow)
  scheduleDevAsk(core, (question) => tutor.ask(question))

  const tray = createTray({
    state: () => ({
      overlayVisible: overlay.isVisible(),
      avatars: avatarOptions(userAvatars),
      currentAvatarId: effectiveAvatar(currentChoice(), userAvatars).id,
      emotion: pose.emotion,
      talking: pose.talking,
      talkLabel: settings.get().talk.hotkeyLabel,
      conversation: tutor.conversation
    }),
    ask: () => companions.toggleAsk(),
    talk,
    toggleConversation: () => {
      const current = settings.get().talk
      const mode = current.mode === 'conversation' ? 'hotkey' : 'conversation'
      settings.update({ talk: { ...current, mode } })
      applyConversation({ ...current, mode })
    },
    toggleOverlay,
    selectAvatar,
    importVrm: () => void importAvatar('vrm'),
    importPngTuber: () => void importAvatar('pngtuber'),
    previewEmotion: (emotion) => setPose({ emotion }),
    previewTalking: (talking) => setPose({ talking }),
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

  for (const [shortcut, action] of [
    [TOGGLE_OVERLAY_SHORTCUT, toggleOverlay],
    [ASK_SHORTCUT, () => companions.toggleAsk()]
  ] as const) {
    if (!globalShortcut.register(shortcut, action)) {
      console.warn(`Another app already uses ${shortcut}.`)
    }
  }
  const startingTalk = settings.get().talk
  const hotkeyProblem = setTalkHotkey(startingTalk.hotkey)
  if (hotkeyProblem) console.warn(`${hotkeyProblem} (${startingTalk.hotkey})`)
  applyConversation(startingTalk)
  if (devConversationRequested()) tutor.setConversation(true, 0)

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
