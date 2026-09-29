import type { AvatarChoice, AvatarConfig } from '../shared/avatar'

interface BuiltinAvatar extends AvatarConfig {
  id: string
}

/** Avatars shipped with the app, served from `resources/avatars`. */
export const BUILTIN_AVATARS: readonly BuiltinAvatar[] = [
  { id: 'builtin:seed-san', kind: 'vrm', name: 'Seed-san', url: 'avatar://builtin/seed-san.vrm' }
]

const DEFAULT_AVATAR = BUILTIN_AVATARS[0]

/** Turns the saved choice into something the overlay can load. Unknown choices get the default. */
export function resolveAvatarConfig(choice: AvatarChoice): AvatarConfig {
  const avatar =
    BUILTIN_AVATARS.find((item) => item.id === choice.id && item.kind === choice.kind) ??
    DEFAULT_AVATAR
  return { kind: avatar.kind, name: avatar.name, url: avatar.url }
}
