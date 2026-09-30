// AI providers the student can connect. Shared by the settings window and the main process.

import type { PersonaConfig, ProviderKind } from './core-protocol'

export type ProviderPresetId = 'anthropic' | 'openai' | 'openrouter' | 'groq' | 'gemini' | 'custom'

export interface ProviderPreset {
  id: ProviderPresetId
  label: string
  kind: ProviderKind
  /**
   * The API address. `null` means the official Anthropic API, or, for `custom`, the address that
   * the student types.
   */
  baseUrl: string | null
  /** Empty when the student picks a model from the list after testing the connection. */
  defaultModel: string
  /** Where the student creates an API key. */
  keyUrl: string | null
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    kind: 'anthropic',
    baseUrl: null,
    defaultModel: 'claude-opus-5',
    keyUrl: 'https://console.anthropic.com/settings/keys'
  },
  {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: '',
    keyUrl: 'https://platform.openai.com/api-keys'
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: '',
    keyUrl: 'https://openrouter.ai/keys'
  },
  {
    id: 'groq',
    label: 'Groq',
    kind: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: '',
    keyUrl: 'https://console.groq.com/keys'
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    kind: 'openai-compatible',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    defaultModel: '',
    keyUrl: 'https://aistudio.google.com/apikey'
  },
  {
    id: 'custom',
    label: 'Other OpenAI-compatible API',
    kind: 'openai-compatible',
    baseUrl: null,
    defaultModel: '',
    keyUrl: null
  }
]

export function findPreset(id: unknown): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.id === id)
}

/** The address the core calls: the preset's own, or the one the student typed for `custom`. */
export function providerBaseUrl(
  preset: ProviderPreset,
  customBaseUrl: string | null
): string | null {
  return preset.id === 'custom' ? customBaseUrl : preset.baseUrl
}

// Plain http is fine only when the provider runs on this computer. The core checks the same rule.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export function isSafeBaseUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (!parsed.hostname) return false
  return (
    parsed.protocol === 'https:' ||
    (parsed.protocol === 'http:' && LOCAL_HOSTS.has(parsed.hostname))
  )
}

/** The same limits as the core protocol, so the settings window can explain them first. */
export const LIMITS = {
  personaName: 64,
  instructions: 4000,
  model: 200,
  apiKey: 512,
  baseUrl: 2048
} as const

export const DEFAULT_PERSONA: PersonaConfig = { name: 'Professor', instructions: '' }
