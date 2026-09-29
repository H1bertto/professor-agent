import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IpcChannel, type CursorUpdate, type ProfessorApi } from '../shared/api'

// The renderer gets only this small API, never raw ipcRenderer or Node.
const api: ProfessorApi = {
  getCoreHealth: () => ipcRenderer.invoke(IpcChannel.coreHealth),
  overlay: {
    getAvatar: () => ipcRenderer.invoke(IpcChannel.avatarGet),
    ready: () => ipcRenderer.send(IpcChannel.overlayReady),
    onCursor: (listener) => {
      const handler = (_event: IpcRendererEvent, update: CursorUpdate): void => listener(update)
      ipcRenderer.on(IpcChannel.overlayCursor, handler)
      return () => ipcRenderer.off(IpcChannel.overlayCursor, handler)
    },
    setInteractive: (interactive) =>
      ipcRenderer.send(IpcChannel.overlaySetInteractive, interactive),
    startDrag: () => ipcRenderer.send(IpcChannel.overlayDragStart),
    endDrag: () => ipcRenderer.send(IpcChannel.overlayDragEnd),
    resize: (steps) => ipcRenderer.send(IpcChannel.overlayResize, steps)
  }
}

contextBridge.exposeInMainWorld('professor', api)
