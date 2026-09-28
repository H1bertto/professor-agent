// Types and channel names shared by the main, preload, and renderer processes.

export type CoreHealth =
  { status: 'online'; version: string } | { status: 'offline'; reason: string }

export const IpcChannel = {
  coreHealth: 'core:health'
} as const

/** API that the preload script exposes to the renderer as `window.professor`. */
export interface ProfessorApi {
  getCoreHealth(): Promise<CoreHealth>
}
