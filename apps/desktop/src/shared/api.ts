// Types and channel names shared by the main, preload, and renderer processes.

import type { AvatarConfig, LookTarget } from './avatar'

export type CoreHealth =
  { status: 'online'; version: string } | { status: 'offline'; reason: string }

export const IpcChannel = {
  coreHealth: 'core:health',
  avatarGet: 'avatar:get',
  overlayReady: 'overlay:ready',
  overlayLookTarget: 'overlay:look-target'
} as const

/** Calls available to the overlay window, which shows the avatar. */
export interface OverlayApi {
  getAvatar(): Promise<AvatarConfig>
  /** The avatar finished loading, so the window can be shown. */
  ready(): void
  /** Follows the mouse cursor anywhere on the screen. Returns a function that stops listening. */
  onLookTarget(listener: (target: LookTarget) => void): () => void
}

/** API that the preload script exposes to the renderer as `window.professor`. */
export interface ProfessorApi {
  getCoreHealth(): Promise<CoreHealth>
  overlay: OverlayApi
}
