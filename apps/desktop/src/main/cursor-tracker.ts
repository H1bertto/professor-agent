import { BrowserWindow, screen } from 'electron'
import { IpcChannel, type CursorUpdate } from '../shared/api'
import { cursorToLookTarget } from './look-target'
import { containsPoint } from './window-bounds'

/**
 * The overlay only sees the mouse while it is over the window, so the main process polls the
 * cursor and tells the avatar where to look. It sends nothing while the cursor stands still.
 */
export function startCursorTracking(window: BrowserWindow, intervalMs = 50): () => void {
  let lastSent = ''
  const timer = setInterval(() => {
    if (window.isDestroyed() || !window.isVisible()) return
    const cursor = screen.getCursorScreenPoint()
    const bounds = window.getBounds()
    const update: CursorUpdate = {
      look: cursorToLookTarget(cursor, bounds),
      overWindow: containsPoint(bounds, cursor)
    }
    const key = `${update.look.x.toFixed(3)},${update.look.y.toFixed(3)},${update.overWindow}`
    if (key === lastSent) return
    lastSent = key
    window.webContents.send(IpcChannel.overlayCursor, update)
  }, intervalMs)
  return () => clearInterval(timer)
}
