import { describe, expect, it } from 'vitest'

import type { SettingsView, VoiceStatusView } from '../../shared/api'
import {
  initialForm,
  modelWarning,
  savedKeyApplies,
  toProviderForm,
  toSettingsForm,
  voiceStatusLine,
  withPreset
} from './settings-form'

const EMPTY: SettingsView = {
  provider: null,
  persona: { name: 'Professor', instructions: '' },
  voice: { enabled: false, speakAnswers: true, spokenLanguage: 'auto', englishVoice: 'teacher' },
  keyStorageAvailable: true
}

const SAVED: SettingsView = {
  ...EMPTY,
  provider: {
    preset: 'custom',
    baseUrl: 'http://localhost:1234/v1',
    model: 'llama',
    keyHint: '...1234'
  }
}

describe('settings form', () => {
  it('starts with Anthropic and its default model when nothing is saved', () => {
    expect(initialForm(EMPTY)).toMatchObject({ preset: 'anthropic', model: 'claude-opus-5' })
  })

  it('starts with the saved provider', () => {
    expect(initialForm(SAVED)).toMatchObject({
      preset: 'custom',
      baseUrl: 'http://localhost:1234/v1',
      model: 'llama',
      apiKey: ''
    })
  })

  it('brings the saved values back when the student returns to the saved provider', () => {
    const openai = withPreset(initialForm(SAVED), 'openai', SAVED)
    expect(openai).toMatchObject({ preset: 'openai', baseUrl: '', model: '' })
    expect(withPreset(openai, 'custom', SAVED)).toMatchObject({
      baseUrl: 'http://localhost:1234/v1',
      model: 'llama'
    })
  })

  it('sends the address only for custom providers, and null for an empty key', () => {
    const form = { ...initialForm(EMPTY), preset: 'openai' as const, baseUrl: 'https://x.test' }
    expect(toProviderForm(form)).toEqual({
      preset: 'openai',
      baseUrl: null,
      model: 'claude-opus-5',
      apiKey: null
    })
    expect(toSettingsForm({ ...form, apiKey: ' key ' }).provider?.apiKey).toBe('key')
  })

  it('keeps the saved key only for the same provider at the same address', () => {
    const form = initialForm(SAVED)
    expect(savedKeyApplies(form, SAVED)).toBe(true)
    expect(savedKeyApplies({ ...form, baseUrl: 'https://other.test/v1' }, SAVED)).toBe(false)
    expect(savedKeyApplies(withPreset(form, 'openai', SAVED), SAVED)).toBe(false)
    expect(
      savedKeyApplies(form, { ...SAVED, provider: { ...SAVED.provider!, keyHint: null } })
    ).toBe(false)
  })

  it('warns when the tested key does not list the chosen model', () => {
    expect(modelWarning('claude-opus-5', [])).toBeNull()
    expect(modelWarning('claude-opus-5', ['claude-opus-5'])).toBeNull()
    expect(modelWarning('', ['claude-opus-5'])).toBeNull()
    expect(modelWarning('gpt-4', ['claude-opus-5'])).not.toBeNull()
  })
})

describe('voice settings', () => {
  it('sends the voice settings with the rest of the form', () => {
    const form = initialForm(EMPTY)
    const voice = { ...form.voice, enabled: true }
    expect(toSettingsForm({ ...form, voice }).voice).toEqual(voice)
  })

  it('tells where voice is, once the student chose it', () => {
    const status = (
      state: VoiceStatusView['state'],
      progress: number | null = null
    ): VoiceStatusView => ({
      state,
      progress,
      message: state === 'error' ? 'No GPU.' : null
    })
    const on = { coreOnline: true, saved: true, chosen: true }
    expect(voiceStatusLine(status('ready'), { ...on, chosen: false })).toBeNull()
    expect(voiceStatusLine(status('off'), { ...on, saved: false })?.text).toBe(
      'Save to turn voice on.'
    )
    expect(voiceStatusLine(status('off'), { ...on, coreOnline: false })?.text).toContain('core')
    expect(voiceStatusLine(status('downloading', 0.42), on)?.text).toContain('(42%)')
    expect(voiceStatusLine(status('ready'), on)).toEqual({ text: 'Voice is ready.', kind: 'ok' })
    expect(voiceStatusLine(status('error'), on)).toEqual({ text: 'No GPU.', kind: 'error' })
  })
})
