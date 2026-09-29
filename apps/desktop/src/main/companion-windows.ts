import { BrowserWindow, ipcMain, screen, type IpcMainEvent } from 'electron'
import { IpcChannel, type Answer, type AskResult } from '../shared/api'
import { ASK_SIZE, BUBBLE_MIN_HEIGHT, BUBBLE_WIDTH, companionBounds } from './window-bounds'
import {
  hardenWebContents,
  loadRendererPage,
  PRELOAD_PATH,
  type RendererPage
} from './window-helpers'

export interface CompanionOptions {
  teacherName(): string
  ask(question: string): AskResult
  cancel(): void
}

export interface CompanionWindows {
  /** Opens the question box beside the avatar, or closes it if it is open. */
  toggleAsk(): void
  showAnswer(answer: Answer): void
}

/**
 * The question box and the answer bubble. Both sit beside the avatar and follow it when the
 * student drags it.
 */
export function createCompanionWindows(
  overlay: BrowserWindow,
  options: CompanionOptions
): CompanionWindows {
  // The question box takes focus, so the student can type right away.
  const ask = createWindow('ask.html', { ...ASK_SIZE, focusable: true })
  // The bubble never takes focus from the app the student is using.
  const bubble = createWindow('bubble.html', {
    width: BUBBLE_WIDTH,
    height: BUBBLE_MIN_HEIGHT,
    focusable: false
  })
  let bubbleHeight = BUBBLE_MIN_HEIGHT
  // A closed bubble stays closed until the next question, even while its answer still streams.
  let answerId: string | null = null
  let dismissed = false

  const place = (): void => {
    const bounds = overlay.getBounds()
    const placed = companionBounds(bounds, screen.getDisplayMatching(bounds).workArea, bubbleHeight)
    ask.setBounds(placed.ask)
    bubble.setBounds(placed.bubble)
  }
  overlay.on('move', place)
  overlay.on('resize', place)
  overlay.on('hide', () => {
    ask.hide()
    bubble.hide()
  })
  // Clicking anywhere else closes the question box, like a search bar.
  ask.on('blur', () => ask.hide())

  const from =
    (window: BrowserWindow) =>
    (event: IpcMainEvent | Electron.IpcMainInvokeEvent): boolean =>
      !window.isDestroyed() && event.sender.id === window.webContents.id
  const fromAsk = from(ask)
  const fromBubble = from(bubble)
  const fromOverlay = from(overlay)

  const toggleAsk = (): void => {
    if (ask.isVisible()) {
      ask.hide()
      return
    }
    if (!overlay.isVisible()) overlay.showInactive()
    place()
    ask.show()
    ask.focus()
    ask.webContents.send(IpcChannel.askOpened, { teacherName: options.teacherName() })
  }

  ipcMain.handle(IpcChannel.askSubmit, (event, question: unknown): AskResult => {
    if (!fromAsk(event)) throw new Error('Only the question box can ask.')
    if (typeof question !== 'string') return { ok: false, message: 'Type a question first.' }
    const result = options.ask(question)
    if (result.ok) ask.hide()
    return result
  })
  ipcMain.on(IpcChannel.askClose, (event) => {
    if (fromAsk(event)) ask.hide()
  })
  ipcMain.on(IpcChannel.overlayClick, (event) => {
    if (fromOverlay(event)) toggleAsk()
  })
  ipcMain.on(IpcChannel.bubbleResize, (event, height: unknown) => {
    if (!fromBubble(event) || typeof height !== 'number' || !Number.isFinite(height)) return
    bubbleHeight = height
    place()
  })
  ipcMain.on(IpcChannel.bubbleCancel, (event) => {
    if (fromBubble(event)) options.cancel()
  })
  ipcMain.on(IpcChannel.bubbleDismiss, (event) => {
    if (!fromBubble(event)) return
    dismissed = true
    bubble.hide()
  })

  return {
    toggleAsk,
    showAnswer: (answer) => {
      if (bubble.isDestroyed()) return
      if (answer.id !== answerId) {
        answerId = answer.id
        dismissed = false
      }
      bubble.webContents.send(IpcChannel.bubbleAnswer, {
        teacherName: options.teacherName(),
        answer
      })
      if (!dismissed && !bubble.isVisible() && overlay.isVisible()) {
        place()
        bubble.showInactive()
      }
    }
  }
}

function createWindow(
  page: RendererPage,
  { width, height, focusable }: { width: number; height: number; focusable: boolean }
): BrowserWindow {
  const window = new BrowserWindow({
    width,
    height,
    title: 'Professor Agent',
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable,
    webPreferences: {
      preload: PRELOAD_PATH,
      sandbox: true
    }
  })
  window.setAlwaysOnTop(true, 'screen-saver')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  hardenWebContents(window)
  loadRendererPage(window, page)
  return window
}
