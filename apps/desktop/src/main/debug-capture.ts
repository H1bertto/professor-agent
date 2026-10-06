import { app, BrowserWindow, desktopCapturer, ipcMain, screen } from 'electron'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { IpcChannel, type CoreConnectionStatus } from '../shared/api'
import type { AvatarChoice } from '../shared/avatar'
import type { ProviderConfig } from '../shared/core-protocol'
import { findBuiltinAvatar } from './avatar-library'

/**
 * Development helper: PROFESSOR_DEV_PROFILE=<name> keeps settings and the single-instance lock
 * apart from the student's, so a check can run while the app is open. Call it before the lock.
 * Packaged builds ignore it.
 */
export function applyDevProfile(env = process.env): void {
  const name = env.PROFESSOR_DEV_PROFILE
  if (app.isPackaged || !name || !/^[a-z0-9-]{1,32}$/.test(name)) return
  app.setPath('userData', join(app.getPath('appData'), `professor-agent-${name}`))
}

/**
 * Development helper: PROFESSOR_AVATAR=<built-in id> (for example `builtin:chalk`) shows that
 * avatar without changing the saved settings. Packaged builds ignore it.
 */
export function devAvatarOverride(env = process.env): AvatarChoice | null {
  if (app.isPackaged || !env.PROFESSOR_AVATAR) return null
  return findBuiltinAvatar(env.PROFESSOR_AVATAR)
}

/**
 * Development helper: PROFESSOR_DEV_PROVIDER=<provider JSON> replaces the saved provider, for
 * example with the fake provider of the core tests (`uv run python tests/fake_provider.py`).
 * Packaged builds ignore it.
 */
export function devProviderOverride(env = process.env): ProviderConfig | null {
  if (app.isPackaged || !env.PROFESSOR_DEV_PROVIDER) return null
  try {
    const value: unknown = JSON.parse(env.PROFESSOR_DEV_PROVIDER)
    if (isProviderConfig(value)) return value
  } catch {
    // Reported below.
  }
  console.warn('PROFESSOR_DEV_PROVIDER is not a valid provider, so the app ignores it.')
  return null
}

/**
 * Development helper: PROFESSOR_DEV_ASK=<question> asks it once, when the avatar is on screen
 * and the core is online. Packaged builds ignore it.
 */
export function scheduleDevAsk(
  core: {
    readonly currentStatus: CoreConnectionStatus
    onStatus(listener: (status: CoreConnectionStatus) => void): () => void
  },
  ask: (question: string) => void,
  env = process.env
): void {
  const question = env.PROFESSOR_DEV_ASK
  if (app.isPackaged || !question) return
  // The configuration goes out right after ready, so a short wait lets it arrive first.
  const askSoon = (): void => void setTimeout(() => ask(question), 500)
  ipcMain.once(IpcChannel.overlayReady, () => {
    if (core.currentStatus === 'online') return askSoon()
    const stop = core.onStatus((status) => {
      if (status !== 'online') return
      stop()
      askSoon()
    })
  })
}

/**
 * Development helper to check the overlay without recording the whole screen.
 *
 * - PROFESSOR_CAPTURE_OVERLAY=<file.png> saves what the overlay page renders.
 * - PROFESSOR_CAPTURE_SCREEN=<file.png> saves the screen area under the overlay window only,
 *   to check that the transparency blends with the apps behind it.
 * - PROFESSOR_CAPTURE_BUBBLE=<file.png> saves what the answer bubble page renders.
 * - PROFESSOR_CAPTURE_EXIT=1 quits the app after the captures.
 *
 * Captures run a moment after the avatar is ready. Packaged builds ignore these variables.
 */
export function scheduleOverlayCapture(
  window: BrowserWindow,
  bubble: BrowserWindow,
  env = process.env
): void {
  const pageTarget = env.PROFESSOR_CAPTURE_OVERLAY
  const screenTarget = env.PROFESSOR_CAPTURE_SCREEN
  const bubbleTarget = env.PROFESSOR_CAPTURE_BUBBLE
  if ((!pageTarget && !screenTarget && !bubbleTarget) || app.isPackaged) return

  const delayMs = Number(env.PROFESSOR_CAPTURE_DELAY_MS ?? 2000)
  ipcMain.once(IpcChannel.overlayReady, () => {
    setTimeout(async () => {
      if (pageTarget) {
        const image = await window.webContents.capturePage()
        await writeFile(pageTarget, image.toPNG())
      }
      if (screenTarget) await captureScreenUnderWindow(window, screenTarget)
      // A hidden window draws nothing, so capturing it would wait forever.
      if (bubbleTarget && !bubble.isVisible()) console.log('Bubble hidden, so not captured')
      else if (bubbleTarget) {
        const image = await bubble.webContents.capturePage()
        await writeFile(bubbleTarget, image.toPNG())
        console.log(
          `Bubble captured, visible ${bubble.isVisible()}, bounds ${JSON.stringify(bubble.getBounds())}`
        )
      }
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

function isProviderConfig(value: unknown): value is ProviderConfig {
  if (typeof value !== 'object' || value === null) return false
  const { kind, baseUrl, model, apiKey } = value as Record<string, unknown>
  return (
    (kind === 'anthropic' || kind === 'openai-compatible') &&
    (baseUrl === null || typeof baseUrl === 'string') &&
    typeof model === 'string' &&
    typeof apiKey === 'string'
  )
}
