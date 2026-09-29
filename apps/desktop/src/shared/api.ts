// Types and channel names shared by the main, preload, and renderer processes.

import type { AvatarConfig, Emotion, LookTarget } from './avatar'

export type CoreHealth =
  { status: 'online'; version: string } | { status: 'offline'; reason: string }

/** Where the mouse cursor is, sent to the overlay while it moves. */
export interface CursorUpdate {
  /** Where the avatar should look to face the cursor. */
  look: LookTarget
  /** Whether the cursor is inside the overlay window. */
  overWindow: boolean
}

/** Lets the student try expressions and talking from the tray menu, before the AI drives them. */
export interface AvatarPreview {
  emotion: Emotion
  talking: boolean
}

export const IpcChannel = {
  coreHealth: 'core:health',
  avatarGet: 'avatar:get',
  avatarChanged: 'avatar:changed',
  overlayReady: 'overlay:ready',
  overlayCursor: 'overlay:cursor',
  overlayPreview: 'overlay:preview',
  overlaySetInteractive: 'overlay:set-interactive',
  overlayDragStart: 'overlay:drag-start',
  overlayDragEnd: 'overlay:drag-end',
  overlayResize: 'overlay:resize'
} as const

/** Calls available to the overlay window, which shows the avatar. */
export interface OverlayApi {
  getAvatar(): Promise<AvatarConfig>
  /** The avatar finished loading, so the window can be shown. */
  ready(): void
  /** Each `on...` call returns a function that stops listening. */
  onAvatarChanged(listener: (avatar: AvatarConfig) => void): () => void
  onCursor(listener: (update: CursorUpdate) => void): () => void
  onPreview(listener: (preview: AvatarPreview) => void): () => void
  /** `true` makes the window catch the mouse. `false` lets clicks pass through to other apps. */
  setInteractive(interactive: boolean): void
  /** The window follows the cursor from `startDrag` until `endDrag`. */
  startDrag(): void
  endDrag(): void
  /** Positive steps grow the avatar and negative steps shrink it. */
  resize(steps: number): void
}

/** API that the preload script exposes to the renderer as `window.professor`. */
export interface ProfessorApi {
  getCoreHealth(): Promise<CoreHealth>
  overlay: OverlayApi
}
