import { describe, expect, it } from 'vitest'

import { DEFAULT_SETTINGS, DEFAULT_VOICE, parseSettings } from './settings'

const PROVIDER = {
  preset: 'anthropic',
  baseUrl: null,
  model: 'claude-opus-5',
  encryptedKey: 'c2VhbGVk'
}

const VALID = {
  version: 1,
  avatar: { kind: 'pngtuber', id: 'builtin:chalk' },
  overlayBounds: { x: 10, y: 20, width: 300, height: 400 },
  provider: PROVIDER,
  persona: { name: 'Ana', instructions: 'Correct my grammar.' },
  voice: { enabled: true, speakAnswers: false, spokenLanguage: 'en', englishVoice: 'native' }
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

  it('falls back to the default voice settings when they are missing or invalid', () => {
    const invalidVoices = [
      undefined,
      { ...VALID.voice, enabled: 'yes' },
      { ...VALID.voice, spokenLanguage: 'fr' },
      { ...VALID.voice, englishVoice: 'robot' }
    ]
    for (const voice of invalidVoices) {
      expect(parseSettings({ ...VALID, voice }).voice).toEqual(DEFAULT_VOICE)
    }
    expect(DEFAULT_VOICE.enabled).toBe(false)
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

  it('reads settings saved before providers existed', () => {
    const older = { version: 1, avatar: VALID.avatar, overlayBounds: VALID.overlayBounds }
    expect(parseSettings(older)).toMatchObject({
      provider: null,
      persona: DEFAULT_SETTINGS.persona
    })
  })

  it('drops a provider that is incomplete or unknown', () => {
    const invalidProviders = [
      { ...PROVIDER, preset: 'ollama' },
      { ...PROVIDER, model: '' },
      { ...PROVIDER, model: 'm'.repeat(201) },
      { ...PROVIDER, encryptedKey: '' },
      { ...PROVIDER, encryptedKey: 42 },
      { ...PROVIDER, preset: 'custom', baseUrl: null },
      { ...PROVIDER, preset: 'custom', baseUrl: 'http://example.com/v1' },
      'anthropic'
    ]
    for (const provider of invalidProviders) {
      expect(parseSettings({ ...VALID, provider }).provider).toBeNull()
    }
  })

  it('keeps the address only for custom providers', () => {
    const custom = { ...PROVIDER, preset: 'custom', baseUrl: 'http://localhost:1234/v1' }
    expect(parseSettings({ ...VALID, provider: custom }).provider).toEqual(custom)
    const openai = { ...PROVIDER, preset: 'openai', baseUrl: 'https://example.com/v1' }
    expect(parseSettings({ ...VALID, provider: openai }).provider?.baseUrl).toBeNull()
  })

  it('falls back to the default persona field by field', () => {
    const persona = { name: '', instructions: 'x'.repeat(4001) }
    expect(parseSettings({ ...VALID, persona }).persona).toEqual(DEFAULT_SETTINGS.persona)
    expect(parseSettings({ ...VALID, persona: { name: 'Ana' } }).persona).toEqual({
      name: 'Ana',
      instructions: ''
    })
  })

  it('does not share the default objects between calls', () => {
    const first = parseSettings(null)
    first.avatar.id = 'user:changed'
    first.persona.name = 'Changed'
    expect(parseSettings(null).avatar.id).toBe('builtin:seed-san')
    expect(parseSettings(null).persona.name).toBe('Professor')
  })
})
