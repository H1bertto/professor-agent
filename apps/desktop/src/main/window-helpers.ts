import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

export type RendererPage = 'index.html' | 'overlay.html' | 'ask.html' | 'bubble.html'

export const PRELOAD_PATH = join(__dirname, '../preload/index.js')

/** Blocks navigation and pop-ups. Only https links leave the app, in the system browser. */
export function hardenWebContents(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event) => event.preventDefault())
}

/** electron-vite serves the renderer with HMR in development. */
export function loadRendererPage(window: BrowserWindow, page: RendererPage): void {
  const devServer = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && devServer) {
    window.loadURL(`${devServer}/${page}`)
  } else {
    window.loadFile(join(__dirname, `../renderer/${page}`))
  }
}
