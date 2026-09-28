import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannel, type ProfessorApi } from '../shared/api'

// The renderer gets only this small API, never raw ipcRenderer or Node.
const api: ProfessorApi = {
  getCoreHealth: () => ipcRenderer.invoke(IpcChannel.coreHealth)
}

contextBridge.exposeInMainWorld('professor', api)
