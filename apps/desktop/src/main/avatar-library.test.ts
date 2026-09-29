import { describe, expect, it } from 'vitest'

import { resolveAvatarConfig } from './avatar-library'

const SEED_SAN = { kind: 'vrm', name: 'Seed-san', url: 'avatar://builtin/seed-san.vrm' }

describe('resolveAvatarConfig', () => {
  it('finds a built-in avatar', () => {
    expect(resolveAvatarConfig({ kind: 'vrm', id: 'builtin:seed-san' })).toEqual(SEED_SAN)
  })

  it('falls back to the default for unknown avatars', () => {
    expect(resolveAvatarConfig({ kind: 'vrm', id: 'builtin:missing' })).toEqual(SEED_SAN)
  })

  it('falls back to the default when the kind does not match', () => {
    expect(resolveAvatarConfig({ kind: 'pngtuber', id: 'builtin:seed-san' })).toEqual(SEED_SAN)
  })
})
