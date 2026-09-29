// Types and channel names shared by the main, preload, and renderer processes.

export type CoreHealth =
  { status: 'online'; version: string } | { status: 'offline'; reason: string }

export const IpcChannel = {
  coreHealth: 'core:health',
  overlayReady: 'overlay:ready'
} as const

/** Calls available to the overlay window, which shows the avatar. */
export interface OverlayApi {
  /** The avatar finished loading, so the window can be shown. */
  ready(): void
}

/** API that the preload script exposes to the renderer as `window.professor`. */
export interface ProfessorApi {
  getCoreHealth(): Promise<CoreHealth>
  overlay: OverlayApi
}
