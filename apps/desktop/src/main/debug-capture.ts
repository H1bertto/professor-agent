import { app, BrowserWindow, ipcMain } from 'electron'
import { writeFile } from 'fs/promises'
import { IpcChannel } from '../shared/api'

/**
 * Development helper. When PROFESSOR_CAPTURE_OVERLAY is set to a file path, saves a PNG of the
 * overlay a moment after the avatar is ready. It lets us check the rendering without recording
 * the screen. With PROFESSOR_CAPTURE_EXIT=1, the app quits after the capture.
 */
export function scheduleOverlayCapture(window: BrowserWindow, env = process.env): void {
  const target = env.PROFESSOR_CAPTURE_OVERLAY
  if (!target || app.isPackaged) return

  const delayMs = Number(env.PROFESSOR_CAPTURE_DELAY_MS ?? 2000)
  ipcMain.once(IpcChannel.overlayReady, () => {
    setTimeout(async () => {
      const image = await window.webContents.capturePage()
      await writeFile(target, image.toPNG())
      console.log(`Overlay captured to ${target} (${JSON.stringify(window.getBounds())})`)
      if (env.PROFESSOR_CAPTURE_EXIT === '1') app.quit()
    }, delayMs)
  })
}
