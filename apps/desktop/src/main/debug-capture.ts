import { app, BrowserWindow, desktopCapturer, ipcMain, screen } from 'electron'
import { writeFile } from 'fs/promises'
import { IpcChannel } from '../shared/api'
import type { AvatarChoice } from '../shared/avatar'
import { findBuiltinAvatar } from './avatar-library'

/**
 * Development helper: PROFESSOR_AVATAR=<built-in id> (for example `builtin:chalk`) shows that
 * avatar without changing the saved settings. Packaged builds ignore it.
 */
export function devAvatarOverride(env = process.env): AvatarChoice | null {
  if (app.isPackaged || !env.PROFESSOR_AVATAR) return null
  return findBuiltinAvatar(env.PROFESSOR_AVATAR)
}

/**
 * Development helper to check the overlay without recording the whole screen.
 *
 * - PROFESSOR_CAPTURE_OVERLAY=<file.png> saves what the overlay page renders.
 * - PROFESSOR_CAPTURE_SCREEN=<file.png> saves the screen area under the overlay window only,
 *   to check that the transparency blends with the apps behind it.
 * - PROFESSOR_CAPTURE_EXIT=1 quits the app after the captures.
 *
 * Captures run a moment after the avatar is ready. Packaged builds ignore these variables.
 */
export function scheduleOverlayCapture(window: BrowserWindow, env = process.env): void {
  const pageTarget = env.PROFESSOR_CAPTURE_OVERLAY
  const screenTarget = env.PROFESSOR_CAPTURE_SCREEN
  if ((!pageTarget && !screenTarget) || app.isPackaged) return

  const delayMs = Number(env.PROFESSOR_CAPTURE_DELAY_MS ?? 2000)
  ipcMain.once(IpcChannel.overlayReady, () => {
    setTimeout(async () => {
      if (pageTarget) {
        const image = await window.webContents.capturePage()
        await writeFile(pageTarget, image.toPNG())
      }
      if (screenTarget) await captureScreenUnderWindow(window, screenTarget)
      console.log(`Overlay captured, bounds ${JSON.stringify(window.getBounds())}`)
      if (env.PROFESSOR_CAPTURE_EXIT === '1') app.quit()
    }, delayMs)
  })
}

async function captureScreenUnderWindow(window: BrowserWindow, target: string): Promise<void> {
  const bounds = window.getBounds()
  const display = screen.getDisplayMatching(bounds)
  const scale = display.scaleFactor
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(display.size.width * scale),
      height: Math.round(display.size.height * scale)
    }
  })
  const source = sources.find((item) => item.display_id === String(display.id)) ?? sources[0]
  if (!source) return

  const region = source.thumbnail.crop({
    x: Math.round((bounds.x - display.bounds.x) * scale),
    y: Math.round((bounds.y - display.bounds.y) * scale),
    width: Math.round(bounds.width * scale),
    height: Math.round(bounds.height * scale)
  })
  await writeFile(target, region.toPNG())
}
