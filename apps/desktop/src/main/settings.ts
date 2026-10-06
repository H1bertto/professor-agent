import { AVATAR_ID_PATTERN, type AvatarChoice } from '../shared/avatar'
import type { TalkSettings } from '../shared/api'
import { parseVoiceConfig, type PersonaConfig, type VoiceConfig } from '../shared/core-protocol'
import { DEFAULT_TALK_HOTKEY, DEFAULT_TALK_HOTKEY_LABEL } from '../shared/hotkeys'
import { parseTalkSettings } from './provider-settings'
import {
  DEFAULT_PERSONA,
  findPreset,
  isSafeBaseUrl,
  LIMITS,
  type ProviderPresetId
} from '../shared/providers'
import type { Rect } from './window-bounds'

export interface StoredProvider {
  preset: ProviderPresetId
  /** Only for the `custom` preset. The others always use their own address. */
  baseUrl: string | null
  model: string
  /** The API key encrypted by the operating system (see key-vault.ts), in base64. */
  encryptedKey: string
}

export interface Settings {
  version: 1
  avatar: AvatarChoice
  /** Where the student left the overlay. `null` means the default corner. */
  overlayBounds: Rect | null
  provider: StoredProvider | null
  persona: PersonaConfig
  voice: VoiceConfig
  talk: TalkSettings
}

export const DEFAULT_TALK: TalkSettings = {
  mode: 'hotkey',
  hotkey: DEFAULT_TALK_HOTKEY,
  hotkeyLabel: DEFAULT_TALK_HOTKEY_LABEL,
  autoPauseMinutes: 3
}

/** Voice starts off, since it downloads about 2 GB of speech models the first time. */
export const DEFAULT_VOICE: VoiceConfig = {
  enabled: false,
  speakAnswers: true,
  spokenLanguage: 'auto',
  englishVoice: 'teacher',
  teacherVoice: 'dora',
  nativeVoice: 'heart'
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  avatar: { kind: 'vrm', id: 'builtin:seed-san' },
  overlayBounds: null,
  provider: null,
  persona: DEFAULT_PERSONA,
  voice: DEFAULT_VOICE,
  talk: DEFAULT_TALK
}

// Encrypted keys are a little longer than the keys themselves, in base64.
const MAX_ENCRYPTED_KEY_LENGTH = 4096

/** Reads settings from untrusted JSON. Any invalid field falls back to its default. */
export function parseSettings(raw: unknown): Settings {
  if (!isRecord(raw) || raw.version !== 1) return structuredClone(DEFAULT_SETTINGS)
  return {
    version: 1,
    avatar: parseAvatarChoice(raw.avatar) ?? { ...DEFAULT_SETTINGS.avatar },
    overlayBounds: parseRect(raw.overlayBounds),
    provider: parseProvider(raw.provider),
    persona: parsePersona(raw.persona),
    // Settings saved before a voice field existed take its default and keep the rest.
    voice: parseVoiceConfig(isRecord(raw.voice) ? { ...DEFAULT_VOICE, ...raw.voice } : null) ?? {
      ...DEFAULT_VOICE
    },
    talk: parseTalkSettings(isRecord(raw.talk) ? { ...DEFAULT_TALK, ...raw.talk } : null) ?? {
      ...DEFAULT_TALK
    }
  }
}

function parseProvider(value: unknown): StoredProvider | null {
  if (!isRecord(value)) return null
  const { preset, baseUrl, model, encryptedKey } = value
  const found = findPreset(preset)
  if (!found || !isText(model, LIMITS.model) || !isText(encryptedKey, MAX_ENCRYPTED_KEY_LENGTH)) {
    return null
  }
  if (found.id !== 'custom') return { preset: found.id, baseUrl: null, model, encryptedKey }
  if (!isText(baseUrl, LIMITS.baseUrl) || !isSafeBaseUrl(baseUrl)) return null
  return { preset: found.id, baseUrl, model, encryptedKey }
}

function parsePersona(value: unknown): PersonaConfig {
  if (!isRecord(value)) return { ...DEFAULT_PERSONA }
  const { name, instructions } = value
  return {
    name: isText(name, LIMITS.personaName) ? name : DEFAULT_PERSONA.name,
    instructions:
      typeof instructions === 'string' && instructions.length <= LIMITS.instructions
        ? instructions
        : DEFAULT_PERSONA.instructions
  }
}

/** A non-empty string no longer than `maxLength`. */
function isText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function parseAvatarChoice(value: unknown): AvatarChoice | null {
  if (!isRecord(value)) return null
  const { kind, id } = value
  if ((kind !== 'vrm' && kind !== 'pngtuber') || typeof id !== 'string') return null
  return AVATAR_ID_PATTERN.test(id) ? { kind, id } : null
}

function parseRect(value: unknown): Rect | null {
  if (!isRecord(value)) return null
  const { x, y, width, height } = value
  const numbers = [x, y, width, height]
  if (!numbers.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  if ((width as number) <= 0 || (height as number) <= 0) return null
  return { x: x as number, y: y as number, width: width as number, height: height as number }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
