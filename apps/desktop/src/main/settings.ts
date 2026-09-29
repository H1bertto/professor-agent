import { AVATAR_ID_PATTERN, type AvatarChoice } from '../shared/avatar'
import type { Rect } from './window-bounds'

export interface Settings {
  version: 1
  avatar: AvatarChoice
  /** Where the student left the overlay. `null` means the default corner. */
  overlayBounds: Rect | null
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  avatar: { kind: 'vrm', id: 'builtin:seed-san' },
  overlayBounds: null
}

/** Reads settings from untrusted JSON. Any invalid field falls back to its default. */
export function parseSettings(raw: unknown): Settings {
  if (!isRecord(raw) || raw.version !== 1) return structuredClone(DEFAULT_SETTINGS)
  return {
    version: 1,
    avatar: parseAvatarChoice(raw.avatar) ?? { ...DEFAULT_SETTINGS.avatar },
    overlayBounds: parseRect(raw.overlayBounds)
  }
}

function parseAvatarChoice(value: unknown): AvatarChoice | null {
  if (!isRecord(value)) return null
  const { kind, id } = value
  if ((kind !== 'vrm' && kind !== 'pngtuber') || typeof id !== 'string') return null
  return AVATAR_ID_PATTERN.test(id) ? { kind, id } : null
}

function parseRect(value: unknown): Rect | null {
  if (!isRecord(value)) return null
  const { x, y, width, height } = value
  const numbers = [x, y, width, height]
  if (!numbers.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  if ((width as number) <= 0 || (height as number) <= 0) return null
  return { x: x as number, y: y as number, width: width as number, height: height as number }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
