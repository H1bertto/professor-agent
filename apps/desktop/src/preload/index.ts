import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IpcChannel, type ProfessorApi } from '../shared/api'

/** Listens to one channel from the main process, hiding the Electron event from the renderer. */
function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.off(channel, handler)
}

// The renderer gets only this small API, never raw ipcRenderer or Node.
const api: ProfessorApi = {
  settings: {
    get: () => ipcRenderer.invoke(IpcChannel.settingsGet),
    save: (form) => ipcRenderer.invoke(IpcChannel.settingsSave, form),
    testProvider: (provider) => ipcRenderer.invoke(IpcChannel.settingsTestProvider, provider),
    getCoreStatus: () => ipcRenderer.invoke(IpcChannel.coreStatus),
    onCoreStatus: (listener) => subscribe(IpcChannel.coreStatusChanged, listener)
  },
  overlay: {
    getAvatar: () => ipcRenderer.invoke(IpcChannel.avatarGet),
    ready: () => ipcRenderer.send(IpcChannel.overlayReady),
    onAvatarChanged: (listener) => subscribe(IpcChannel.avatarChanged, listener),
    onCursor: (listener) => subscribe(IpcChannel.overlayCursor, listener),
    onPreview: (listener) => subscribe(IpcChannel.overlayPreview, listener),
    setInteractive: (interactive) =>
      ipcRenderer.send(IpcChannel.overlaySetInteractive, interactive),
    startDrag: () => ipcRenderer.send(IpcChannel.overlayDragStart),
    endDrag: () => ipcRenderer.send(IpcChannel.overlayDragEnd),
    resize: (steps) => ipcRenderer.send(IpcChannel.overlayResize, steps)
  }
}

contextBridge.exposeInMainWorld('professor', api)
