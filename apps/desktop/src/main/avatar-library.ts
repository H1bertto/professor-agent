import type { AvatarChoice, AvatarConfig, AvatarKind } from '../shared/avatar'

/** An avatar the student can pick in the tray menu. */
export interface AvatarOption {
  id: string
  kind: AvatarKind
  name: string
}

/** An avatar the student imported into the app data folder. */
export type UserAvatar = AvatarOption

/** File names inside each imported avatar folder. */
export const USER_VRM_FILE = 'model.vrm'
export const USER_PNGTUBER_FILE = 'avatar.json'

interface BuiltinAvatar extends AvatarOption {
  url: string
}

/** Avatars shipped with the app, served from `resources/avatars`. */
export const BUILTIN_AVATARS: readonly BuiltinAvatar[] = [
  { id: 'builtin:seed-san', kind: 'vrm', name: 'Seed-san', url: 'avatar://builtin/seed-san.vrm' },
  {
    id: 'builtin:chalk',
    kind: 'pngtuber',
    name: 'Chalk',
    url: 'avatar://builtin/chalk/avatar.json'
  }
]

const DEFAULT_AVATAR = BUILTIN_AVATARS[0]

export function findBuiltinAvatar(id: string): AvatarChoice | null {
  const avatar = BUILTIN_AVATARS.find((item) => item.id === id)
  return avatar ? { kind: avatar.kind, id: avatar.id } : null
}

/** Every avatar the student can pick: built-in ones first, then imported ones. */
export function avatarOptions(userAvatars: readonly UserAvatar[]): AvatarOption[] {
  return [...BUILTIN_AVATARS.map(({ id, kind, name }) => ({ id, kind, name })), ...userAvatars]
}

/**
 * The avatar to show for a saved choice. A choice that no longer exists, for example an
 * imported avatar that was deleted, falls back to the default.
 */
export function effectiveAvatar(
  choice: AvatarChoice,
  userAvatars: readonly UserAvatar[] = []
): AvatarOption {
  return (
    avatarOptions(userAvatars).find((item) => item.id === choice.id && item.kind === choice.kind) ??
    DEFAULT_AVATAR
  )
}

/** Turns the saved choice into something the overlay can load. */
export function resolveAvatarConfig(
  choice: AvatarChoice,
  userAvatars: readonly UserAvatar[] = []
): AvatarConfig {
  const avatar = effectiveAvatar(choice, userAvatars)
  const builtin = BUILTIN_AVATARS.find((item) => item.id === avatar.id)
  if (builtin) return { kind: builtin.kind, name: builtin.name, url: builtin.url }

  const folder = encodeURIComponent(avatar.id.slice('user:'.length))
  const entry = avatar.kind === 'vrm' ? USER_VRM_FILE : USER_PNGTUBER_FILE
  return { kind: avatar.kind, name: avatar.name, url: `avatar://user/${folder}/${entry}` }
}
