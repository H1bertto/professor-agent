import { BrowserWindow, ipcMain, screen, type IpcMainEvent } from 'electron'
import { IpcChannel } from '../shared/api'
import {
  clampToWorkArea,
  dragBounds,
  resizeKeepingBase,
  type Point,
  type Rect
} from './window-bounds'

const DRAG_INTERVAL_MS = 16
/** A drag that never receives its end event stops by itself after this long. */
const DRAG_TIMEOUT_MS = 30_000
const MAX_RESIZE_STEPS = 5

interface Drag {
  bounds: Rect
  cursor: Point
  timer: ReturnType<typeof setInterval>
  startedAt: number
}

/**
 * Click-through, dragging, and resizing for the overlay. The main process moves the window with
 * the real cursor position, which stays correct across monitors with different scaling.
 */
export function registerOverlayControls(
  window: BrowserWindow,
  onBoundsChanged: (bounds: Rect) => void
): void {
  let drag: Drag | null = null
  const fromOverlay = (event: IpcMainEvent): boolean => event.sender === window.webContents

  const keepOnScreen = (bounds: Rect): Rect =>
    clampToWorkArea(bounds, screen.getDisplayMatching(bounds).workArea)

  const finishDrag = (): void => {
    if (!drag) return
    clearInterval(drag.timer)
    drag = null
    const bounds = keepOnScreen(window.getBounds())
    window.setBounds(bounds)
    onBoundsChanged(bounds)
  }

  ipcMain.on(IpcChannel.overlaySetInteractive, (event, interactive: unknown) => {
    if (!fromOverlay(event) || typeof interactive !== 'boolean') return
    window.setIgnoreMouseEvents(!interactive, { forward: true })
  })

  ipcMain.on(IpcChannel.overlayDragStart, (event) => {
    if (!fromOverlay(event) || drag) return
    const startedAt = Date.now()
    const bounds = window.getBounds()
    const cursor = screen.getCursorScreenPoint()
    const timer = setInterval(() => {
      if (window.isDestroyed() || Date.now() - startedAt > DRAG_TIMEOUT_MS) return finishDrag()
      window.setBounds(dragBounds(bounds, cursor, screen.getCursorScreenPoint()))
    }, DRAG_INTERVAL_MS)
    drag = { bounds, cursor, timer, startedAt }
  })

  ipcMain.on(IpcChannel.overlayDragEnd, (event) => {
    if (fromOverlay(event)) finishDrag()
  })

  ipcMain.on(IpcChannel.overlayResize, (event, steps: unknown) => {
    if (!fromOverlay(event) || drag || !Number.isInteger(steps)) return
    const limited = Math.max(-MAX_RESIZE_STEPS, Math.min(MAX_RESIZE_STEPS, steps as number))
    const bounds = keepOnScreen(resizeKeepingBase(window.getBounds(), limited))
    window.setBounds(bounds)
    onBoundsChanged(bounds)
  })

  window.on('closed', () => {
    if (drag) clearInterval(drag.timer)
  })
}
