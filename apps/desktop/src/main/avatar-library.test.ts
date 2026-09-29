import { describe, expect, it } from 'vitest'

import { findBuiltinAvatar, resolveAvatarConfig } from './avatar-library'

const SEED_SAN = { kind: 'vrm', name: 'Seed-san', url: 'avatar://builtin/seed-san.vrm' }
const CHALK = { kind: 'pngtuber', name: 'Chalk', url: 'avatar://builtin/chalk/avatar.json' }

describe('resolveAvatarConfig', () => {
  it('finds the built-in 3D and 2D avatars', () => {
    expect(resolveAvatarConfig({ kind: 'vrm', id: 'builtin:seed-san' })).toEqual(SEED_SAN)
    expect(resolveAvatarConfig({ kind: 'pngtuber', id: 'builtin:chalk' })).toEqual(CHALK)
  })

  it('falls back to the default for unknown avatars', () => {
    expect(resolveAvatarConfig({ kind: 'vrm', id: 'builtin:missing' })).toEqual(SEED_SAN)
  })

  it('falls back to the default when the kind does not match', () => {
    expect(resolveAvatarConfig({ kind: 'pngtuber', id: 'builtin:seed-san' })).toEqual(SEED_SAN)
  })
})

describe('findBuiltinAvatar', () => {
  it('returns the choice for a known id, or null', () => {
    expect(findBuiltinAvatar('builtin:chalk')).toEqual({ kind: 'pngtuber', id: 'builtin:chalk' })
    expect(findBuiltinAvatar('builtin:missing')).toBeNull()
  })
})
