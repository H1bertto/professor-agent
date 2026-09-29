// Avatar types shared by the main process (settings, tray) and the overlay renderer.

export const EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'relaxed'] as const
export type Emotion = (typeof EMOTIONS)[number]

export type AvatarState = 'idle' | 'listening' | 'thinking' | 'speaking'

export type AvatarKind = 'vrm' | 'pngtuber'

/** The avatar the student picked. `id` is `builtin:<name>` or `user:<name>`. */
export interface AvatarChoice {
  kind: AvatarKind
  id: string
}

/** What the overlay needs to load an avatar. */
export interface AvatarConfig {
  kind: AvatarKind
  name: string
  /** An `avatar://` URL: the .vrm file, or the avatar.json of a PNGTuber folder. */
  url: string
}

/**
 * Where the avatar should look, relative to its eyes, in overlay window heights.
 * 0,0 looks straight ahead, x grows to the right of the screen and y grows downward.
 */
export interface LookTarget {
  x: number
  y: number
}

export const AVATAR_ID_PATTERN = /^(builtin|user):[a-z0-9][a-z0-9_-]{0,63}$/

export function isEmotion(value: unknown): value is Emotion {
  return typeof value === 'string' && (EMOTIONS as readonly string[]).includes(value)
}
