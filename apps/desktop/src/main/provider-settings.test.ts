import { describe, expect, it } from 'vitest'

import { checkPersona, checkProviderForm, checkSettingsForm, keyHint } from './provider-settings'

const ANTHROPIC = { preset: 'anthropic', baseUrl: null, model: 'claude-opus-5', apiKey: null }
const PERSONA = { name: 'Professor', instructions: '' }

describe('checkProviderForm', () => {
  it('accepts a preset and trims what the student typed', () => {
    const result = checkProviderForm(
      { ...ANTHROPIC, model: ' claude-opus-5 ', apiKey: '  sk-ant-abc123  ' },
      { requireModel: true }
    )
    expect(result).toEqual({
      ok: true,
      value: { preset: 'anthropic', baseUrl: null, model: 'claude-opus-5', apiKey: 'sk-ant-abc123' }
    })
  })

  it('treats an empty key as keeping the saved one', () => {
    const result = checkProviderForm({ ...ANTHROPIC, apiKey: '   ' }, { requireModel: true })
    expect(result.ok && result.value.apiKey).toBeNull()
  })

  it('ignores the typed address for presets that have their own', () => {
    const result = checkProviderForm(
      { ...ANTHROPIC, preset: 'openai', baseUrl: 'https://attacker.example/v1' },
      { requireModel: true }
    )
    expect(result.ok && result.value.baseUrl).toBeNull()
  })

  it('needs a safe address for custom providers', () => {
    const custom = { ...ANTHROPIC, preset: 'custom' }
    for (const baseUrl of [null, '', 'http://example.com/v1', 'http://localhost.example.com']) {
      const result = checkProviderForm({ ...custom, baseUrl }, { requireModel: true })
      expect(result.ok, String(baseUrl)).toBe(false)
    }
    const local = checkProviderForm(
      { ...custom, baseUrl: ' http://localhost:1234/v1 ' },
      { requireModel: true }
    )
    expect(local.ok && local.value.baseUrl).toBe('http://localhost:1234/v1')
  })

  it('needs a model to save, but not to test', () => {
    const noModel = { ...ANTHROPIC, model: '' }
    expect(checkProviderForm(noModel, { requireModel: true })).toEqual({
      ok: false,
      message: 'Choose a model.'
    })
    expect(checkProviderForm(noModel, { requireModel: false }).ok).toBe(true)
  })

  it('refuses keys with spaces, line breaks, or too many characters', () => {
    for (const apiKey of ['sk ant', 'sk-ant\nX-Header: 1', 'chave-é', 'k'.repeat(513)]) {
      expect(checkProviderForm({ ...ANTHROPIC, apiKey }, { requireModel: true }).ok).toBe(false)
    }
  })

  it('refuses anything that is not a known provider', () => {
    for (const raw of [null, 'anthropic', [], { ...ANTHROPIC, preset: 'ollama' }]) {
      expect(checkProviderForm(raw, { requireModel: false }).ok).toBe(false)
    }
  })
})

describe('checkPersona', () => {
  it('trims the name and instructions', () => {
    expect(checkPersona({ name: ' Ana ', instructions: ' Be patient. ' })).toEqual({
      ok: true,
      value: { name: 'Ana', instructions: 'Be patient.' }
    })
  })

  it('needs a name and keeps both fields within the core limits', () => {
    expect(checkPersona({ name: ' ', instructions: '' }).ok).toBe(false)
    expect(checkPersona({ name: 'n'.repeat(65), instructions: '' }).ok).toBe(false)
    expect(checkPersona({ name: 'Ana', instructions: 'x'.repeat(4001) }).ok).toBe(false)
    expect(checkPersona({ name: 'Ana' })).toEqual({
      ok: true,
      value: { name: 'Ana', instructions: '' }
    })
  })
})

describe('checkSettingsForm', () => {
  it('accepts a form without a provider, which removes it', () => {
    expect(checkSettingsForm({ provider: null, persona: PERSONA })).toEqual({
      ok: true,
      value: { provider: null, persona: PERSONA }
    })
  })

  it('checks the voice settings when the form has them', () => {
    const voice = {
      enabled: true,
      speakAnswers: true,
      spokenLanguage: 'auto',
      englishVoice: 'teacher',
      teacherVoice: 'dora',
      nativeVoice: 'heart'
    }
    expect(checkSettingsForm({ provider: null, persona: PERSONA, voice })).toEqual({
      ok: true,
      value: { provider: null, persona: PERSONA, voice }
    })
    for (const invalid of [
      null,
      { ...voice, spokenLanguage: 'es' },
      { ...voice, speakAnswers: 1 }
    ]) {
      expect(checkSettingsForm({ provider: null, persona: PERSONA, voice: invalid }).ok).toBe(false)
    }
  })

  it('checks the persona and the provider', () => {
    expect(checkSettingsForm({ provider: ANTHROPIC, persona: { name: '' } }).ok).toBe(false)
    expect(checkSettingsForm({ provider: { ...ANTHROPIC, model: '' }, persona: PERSONA }).ok).toBe(
      false
    )
    expect(checkSettingsForm('settings').ok).toBe(false)
  })
})

describe('keyHint', () => {
  it('shows only the last characters of long keys', () => {
    expect(keyHint('sk-ant-api03-abcdefgh1234')).toBe('...1234')
    expect(keyHint('short')).toBe('...')
  })
})
