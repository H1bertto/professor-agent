import { describe, expect, it } from 'vitest'

import {
  avatarOptions,
  effectiveAvatar,
  findBuiltinAvatar,
  resolveAvatarConfig,
  type UserAvatar
} from './avatar-library'

const SEED_SAN = { kind: 'vrm', name: 'Seed-san', url: 'avatar://builtin/seed-san.vrm' }
const CHALK = { kind: 'pngtuber', name: 'Chalk', url: 'avatar://builtin/chalk/avatar.json' }
const USER: UserAvatar[] = [
  { id: 'user:my-tutor', kind: 'vrm', name: 'My Tutor' },
  { id: 'user:sketch', kind: 'pngtuber', name: 'Sketch' }
]

describe('resolveAvatarConfig', () => {
  it('finds the built-in 3D and 2D avatars', () => {
    expect(resolveAvatarConfig({ kind: 'vrm', id: 'builtin:seed-san' })).toEqual(SEED_SAN)
    expect(resolveAvatarConfig({ kind: 'pngtuber', id: 'builtin:chalk' })).toEqual(CHALK)
  })

  it('points imported avatars to their folder in the user library', () => {
    expect(resolveAvatarConfig({ kind: 'vrm', id: 'user:my-tutor' }, USER)).toEqual({
      kind: 'vrm',
      name: 'My Tutor',
      url: 'avatar://user/my-tutor/model.vrm'
    })
    expect(resolveAvatarConfig({ kind: 'pngtuber', id: 'user:sketch' }, USER).url).toBe(
      'avatar://user/sketch/avatar.json'
    )
  })

  it('falls back to the default for unknown avatars or a kind that does not match', () => {
    expect(resolveAvatarConfig({ kind: 'vrm', id: 'builtin:missing' })).toEqual(SEED_SAN)
    expect(resolveAvatarConfig({ kind: 'pngtuber', id: 'builtin:seed-san' })).toEqual(SEED_SAN)
    expect(resolveAvatarConfig({ kind: 'vrm', id: 'user:deleted' }, USER)).toEqual(SEED_SAN)
  })
})

describe('avatarOptions and effectiveAvatar', () => {
  it('lists built-in avatars before imported ones', () => {
    expect(avatarOptions(USER).map((option) => option.id)).toEqual([
      'builtin:seed-san',
      'builtin:chalk',
      'user:my-tutor',
      'user:sketch'
    ])
  })

  it('reports the default when the saved choice is gone', () => {
    expect(effectiveAvatar({ kind: 'vrm', id: 'user:deleted' }, USER).id).toBe('builtin:seed-san')
  })
})

describe('findBuiltinAvatar', () => {
  it('returns the choice for a known id, or null', () => {
    expect(findBuiltinAvatar('builtin:chalk')).toEqual({ kind: 'pngtuber', id: 'builtin:chalk' })
    expect(findBuiltinAvatar('builtin:missing')).toBeNull()
  })
})
