// Checks what the settings window sends before the main process uses it. The window is our own
// page, but anything that crosses IPC is treated as untrusted.

import type { ProviderForm, SettingsForm } from '../shared/api'
import { parseVoiceConfig, type PersonaConfig, type VoiceConfig } from '../shared/core-protocol'
import { findPreset, isSafeBaseUrl, LIMITS } from '../shared/providers'

export type Checked<T> = { ok: true; value: T } | { ok: false; message: string }

// API keys are printable ASCII without spaces. Anything else is usually a copy-and-paste mistake.
const API_KEY_PATTERN = /^[\x21-\x7e]+$/

export function checkProviderForm(
  raw: unknown,
  { requireModel }: { requireModel: boolean }
): Checked<ProviderForm> {
  if (!isRecord(raw)) return fail('Choose a provider.')
  const preset = findPreset(raw.preset)
  if (!preset) return fail('Choose a provider.')

  let baseUrl: string | null = null
  if (preset.id === 'custom') {
    baseUrl = typeof raw.baseUrl === 'string' ? raw.baseUrl.trim() : ''
    if (!baseUrl || baseUrl.length > LIMITS.baseUrl || !isSafeBaseUrl(baseUrl)) {
      return fail(
        'Type the address of the API. It must start with https://, or with http://localhost for a provider on this computer.'
      )
    }
  }

  const model = typeof raw.model === 'string' ? raw.model.trim() : ''
  if (requireModel && !model) return fail('Choose a model.')
  if (model.length > LIMITS.model) return fail('The model name is too long.')

  let apiKey: string | null = null
  if (typeof raw.apiKey === 'string' && raw.apiKey.trim()) {
    apiKey = raw.apiKey.trim()
    if (apiKey.length > LIMITS.apiKey) return fail('The API key is too long.')
    if (!API_KEY_PATTERN.test(apiKey)) {
      return fail('The API key has spaces or unusual characters. Copy it again from the provider.')
    }
  }

  return { ok: true, value: { preset: preset.id, baseUrl, model, apiKey } }
}

export function checkPersona(raw: unknown): Checked<PersonaConfig> {
  if (!isRecord(raw)) return fail('Give the teacher a name.')
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!name) return fail('Give the teacher a name.')
  if (name.length > LIMITS.personaName) return fail('The teacher name is too long.')
  const instructions = typeof raw.instructions === 'string' ? raw.instructions.trim() : ''
  if (instructions.length > LIMITS.instructions) {
    return fail(`The instructions are too long. Keep them under ${LIMITS.instructions} characters.`)
  }
  return { ok: true, value: { name, instructions } }
}

export function checkVoice(raw: unknown): Checked<VoiceConfig> {
  const voice = parseVoiceConfig(raw)
  return voice ? { ok: true, value: voice } : fail('The voice settings could not be read.')
}

export function checkSettingsForm(raw: unknown): Checked<SettingsForm> {
  if (!isRecord(raw)) return fail('The settings could not be read.')
  const persona = checkPersona(raw.persona)
  if (!persona.ok) return persona
  // A form without voice settings keeps the saved ones.
  let voice: VoiceConfig | undefined
  if (raw.voice !== undefined) {
    const checked = checkVoice(raw.voice)
    if (!checked.ok) return checked
    voice = checked.value
  }
  const withVoice = voice ? { voice } : {}
  if (raw.provider === null) {
    return { ok: true, value: { provider: null, persona: persona.value, ...withVoice } }
  }
  const provider = checkProviderForm(raw.provider, { requireModel: true })
  if (!provider.ok) return provider
  return { ok: true, value: { provider: provider.value, persona: persona.value, ...withVoice } }
}

/** Shows enough of a key to recognize it, like the provider consoles do. */
export function keyHint(key: string): string {
  return key.length >= 12 ? `...${key.slice(-4)}` : '...'
}

function fail(message: string): { ok: false; message: string } {
  return { ok: false, message }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
