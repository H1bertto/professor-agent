import { BrowserWindow, type WebContents } from 'electron'
import icon from '../../resources/icon.png?asset'
import { hardenWebContents, loadRendererPage, PRELOAD_PATH } from './window-helpers'

let settingsWindow: BrowserWindow | null = null

/** Opens the settings window, or brings it to the front if it is already open. */
export function showSettingsWindow(): void {
  if (settingsWindow) {
    settingsWindow.show()
    settingsWindow.focus()
    return
  }

  settingsWindow = new BrowserWindow({
    width: 560,
    height: 720,
    minWidth: 440,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    title: 'Professor Agent settings',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: PRELOAD_PATH,
      sandbox: true
    }
  })
  settingsWindow.on('ready-to-show', () => settingsWindow?.show())
  settingsWindow.on('closed', () => (settingsWindow = null))
  hardenWebContents(settingsWindow)
  loadRendererPage(settingsWindow, 'index.html')
}

/** Only the settings window may read or change the provider settings. */
export function isSettingsWindow(contents: WebContents): boolean {
  return (
    settingsWindow !== null &&
    !settingsWindow.isDestroyed() &&
    settingsWindow.webContents.id === contents.id
  )
}

export function sendToSettingsWindow(channel: string, payload: unknown): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send(channel, payload)
  }
}
