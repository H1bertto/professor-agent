import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IpcChannel, type ProfessorApi } from '../shared/api'
import type { LookTarget } from '../shared/avatar'

// The renderer gets only this small API, never raw ipcRenderer or Node.
const api: ProfessorApi = {
  getCoreHealth: () => ipcRenderer.invoke(IpcChannel.coreHealth),
  overlay: {
    getAvatar: () => ipcRenderer.invoke(IpcChannel.avatarGet),
    ready: () => ipcRenderer.send(IpcChannel.overlayReady),
    onLookTarget: (listener) => {
      const handler = (_event: IpcRendererEvent, target: LookTarget): void => listener(target)
      ipcRenderer.on(IpcChannel.overlayLookTarget, handler)
      return () => ipcRenderer.off(IpcChannel.overlayLookTarget, handler)
    }
  }
}

contextBridge.exposeInMainWorld('professor', api)
