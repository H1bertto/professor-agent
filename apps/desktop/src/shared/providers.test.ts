import { describe, expect, it } from 'vitest'

import { findPreset, isSafeBaseUrl, PROVIDER_PRESETS, providerBaseUrl } from './providers'

describe('isSafeBaseUrl', () => {
  it('accepts https anywhere and http only on this computer', () => {
    for (const url of [
      'https://api.example.com/v1',
      'http://localhost:1234/v1',
      'http://127.0.0.1:11434/v1',
      'http://[::1]:8080/v1'
    ]) {
      expect(isSafeBaseUrl(url), url).toBe(true)
    }
  })

  it('refuses plain http to other hosts, even ones that look local', () => {
    for (const url of [
      'http://example.com/v1',
      'http://localhost.example.com/v1',
      'http://127.0.0.1.example.com/v1',
      'ftp://localhost/v1',
      'https://',
      'not a url',
      ''
    ]) {
      expect(isSafeBaseUrl(url), url).toBe(false)
    }
  })
})

describe('presets', () => {
  it('have unique ids and safe addresses', () => {
    const ids = PROVIDER_PRESETS.map((preset) => preset.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const preset of PROVIDER_PRESETS) {
      if (preset.baseUrl) expect(isSafeBaseUrl(preset.baseUrl), preset.id).toBe(true)
      if (preset.keyUrl) expect(preset.keyUrl.startsWith('https://'), preset.id).toBe(true)
      if (preset.kind === 'openai-compatible' && preset.id !== 'custom') {
        expect(preset.baseUrl, preset.id).not.toBeNull()
      }
    }
  })

  it('use the typed address only for custom providers', () => {
    const custom = findPreset('custom')!
    const openai = findPreset('openai')!
    expect(providerBaseUrl(custom, 'http://localhost:1234/v1')).toBe('http://localhost:1234/v1')
    expect(providerBaseUrl(openai, 'https://attacker.example/v1')).toBe(openai.baseUrl)
    expect(providerBaseUrl(findPreset('anthropic')!, null)).toBeNull()
    expect(findPreset('ollama')).toBeUndefined()
  })
})
