import { BrowserWindow } from 'electron'
import icon from '../../resources/icon.png?asset'
import { hardenWebContents, loadRendererPage, PRELOAD_PATH } from './window-helpers'

let statusWindow: BrowserWindow | null = null

/** Opens the small status window, or brings it to the front if it is already open. */
export function showStatusWindow(): void {
  if (statusWindow) {
    statusWindow.show()
    statusWindow.focus()
    return
  }

  statusWindow = new BrowserWindow({
    width: 480,
    height: 360,
    show: false,
    autoHideMenuBar: true,
    title: 'Professor Agent',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: PRELOAD_PATH,
      sandbox: true
    }
  })
  statusWindow.on('ready-to-show', () => statusWindow?.show())
  statusWindow.on('closed', () => (statusWindow = null))
  hardenWebContents(statusWindow)
  loadRendererPage(statusWindow, 'index.html')
}
