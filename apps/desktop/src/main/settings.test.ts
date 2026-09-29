import { describe, expect, it } from 'vitest'

import { DEFAULT_SETTINGS, parseSettings } from './settings'

const VALID = {
  version: 1,
  avatar: { kind: 'pngtuber', id: 'builtin:chalk' },
  overlayBounds: { x: 10, y: 20, width: 300, height: 400 }
}

describe('parseSettings', () => {
  it('reads valid settings', () => {
    expect(parseSettings(VALID)).toEqual(VALID)
  })

  it('returns the defaults for anything that is not a settings object', () => {
    for (const raw of [null, undefined, 42, 'text', [], { version: 2 }]) {
      expect(parseSettings(raw)).toEqual(DEFAULT_SETTINGS)
    }
  })

  it('falls back to the default avatar when the avatar is invalid', () => {
    const invalidAvatars = [
      { kind: 'live2d', id: 'builtin:chalk' },
      { kind: 'vrm', id: '../../etc/passwd' },
      { kind: 'vrm', id: 'user:Name With Spaces' },
      'builtin:seed-san'
    ]
    for (const avatar of invalidAvatars) {
      expect(parseSettings({ ...VALID, avatar }).avatar).toEqual(DEFAULT_SETTINGS.avatar)
    }
  })

  it('drops overlay bounds that are not finite positive numbers', () => {
    const invalidBounds = [
      { x: 0, y: 0, width: 0, height: 400 },
      { x: 0, y: 0, width: 300, height: -1 },
      { x: Number.NaN, y: 0, width: 300, height: 400 },
      { x: '10', y: 0, width: 300, height: 400 },
      [1, 2, 3, 4]
    ]
    for (const overlayBounds of invalidBounds) {
      expect(parseSettings({ ...VALID, overlayBounds }).overlayBounds).toBeNull()
    }
  })

  it('does not share the default objects between calls', () => {
    const first = parseSettings(null)
    first.avatar.id = 'user:changed'
    expect(parseSettings(null).avatar.id).toBe('builtin:seed-san')
  })
})
