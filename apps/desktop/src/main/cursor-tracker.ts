import { BrowserWindow, screen } from 'electron'
import { IpcChannel } from '../shared/api'
import { cursorToLookTarget } from './look-target'

/**
 * The overlay only sees the mouse while it is over the window, so the main process polls the
 * cursor and tells the avatar where to look. It sends nothing while the cursor stands still.
 */
export function startCursorTracking(window: BrowserWindow, intervalMs = 50): () => void {
  let lastSent = ''
  const timer = setInterval(() => {
    if (window.isDestroyed() || !window.isVisible()) return
    const target = cursorToLookTarget(screen.getCursorScreenPoint(), window.getBounds())
    const key = `${target.x.toFixed(3)},${target.y.toFixed(3)}`
    if (key === lastSent) return
    lastSent = key
    window.webContents.send(IpcChannel.overlayLookTarget, target)
  }, intervalMs)
  return () => clearInterval(timer)
}
