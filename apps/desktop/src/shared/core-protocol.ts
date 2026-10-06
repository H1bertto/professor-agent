// Messages between the desktop app and the core, version 3. See docs/protocol.md.

import { isEmotion, type Emotion } from './avatar'

export const PROTOCOL_VERSION = 3

export type ProviderKind = 'anthropic' | 'openai-compatible'

export interface ProviderConfig {
  kind: ProviderKind
  /** Required for `openai-compatible`, `null` for `anthropic`. */
  baseUrl: string | null
  model: string
  apiKey: string
}

export interface PersonaConfig {
  name: string
  instructions: string
}

export type SpokenLanguage = 'pt' | 'en'

export interface VoiceConfig {
  /** Loads the speech models and allows spoken questions. */
  enabled: boolean
  /** Also speaks the answers, including answers to typed questions. */
  speakAnswers: boolean
  /** `auto` detects the language, choosing only between Portuguese and English. */
  spokenLanguage: 'auto' | SpokenLanguage
  /** Who says English words: the teacher's own voice, or a native English voice. */
  englishVoice: 'teacher' | 'native'
  /** The teacher's Portuguese voice, which also says short English words in the teacher mode. */
  teacherVoice: TeacherVoice
  /** The native English voice, for English phrases when `englishVoice` is `native`. */
  nativeVoice: NativeVoice
}

export const TEACHER_VOICES = ['dora', 'alex'] as const
export type TeacherVoice = (typeof TEACHER_VOICES)[number]
export const NATIVE_VOICES = ['heart', 'bella', 'michael', 'fenrir', 'puck', 'adam'] as const
export type NativeVoice = (typeof NATIVE_VOICES)[number]

export const VOICE_OFF: VoiceConfig = {
  enabled: false,
  speakAnswers: false,
  spokenLanguage: 'auto',
  englishVoice: 'teacher',
  teacherVoice: 'dora',
  nativeVoice: 'heart'
}

/** Reads voice settings from untrusted data, or gives `null` when they do not match. */
export function parseVoiceConfig(raw: unknown): VoiceConfig | null {
  if (!isRecord(raw)) return null
  const { enabled, speakAnswers, spokenLanguage, englishVoice, teacherVoice, nativeVoice } = raw
  if (typeof enabled !== 'boolean' || typeof speakAnswers !== 'boolean') return null
  if (spokenLanguage !== 'auto' && !isSpokenLanguage(spokenLanguage)) return null
  if (englishVoice !== 'teacher' && englishVoice !== 'native') return null
  if (!isOneOf(TEACHER_VOICES, teacherVoice) || !isOneOf(NATIVE_VOICES, nativeVoice)) return null
  return { enabled, speakAnswers, spokenLanguage, englishVoice, teacherVoice, nativeVoice }
}

export type ClientMessage =
  | { type: 'hello'; protocol: number; client: string; token: string | null }
  | {
      type: 'configure'
      provider: ProviderConfig | null
      persona: PersonaConfig
      voice: VoiceConfig
    }
  | { type: 'provider.test'; requestId: string; provider: ProviderConfig }
  | { type: 'user.text'; id: string; text: string }
  | { type: 'listen.start'; id: string }
  | { type: 'listen.stop'; id: string }
  | { type: 'response.cancel'; id: string }
  /** Conversation mode: the microphone stays open, and the core finds each turn by itself. */
  | { type: 'conversation.start' }
  | { type: 'conversation.stop' }
  /** How many parts of an answer's speech the student has started to hear, and whether the
   * whole speech has played. */
  | { type: 'speech.heard'; id: string; parts: number; finished: boolean }

export const CORE_ERROR_CODES = [
  'invalid_key',
  'rate_limited',
  'insufficient_credit',
  'model_not_found',
  'provider_unavailable',
  'not_configured',
  'no_speech',
  'voice_unavailable',
  'bad_request',
  'internal'
] as const
export type CoreErrorCode = (typeof CORE_ERROR_CODES)[number]

export interface Segment {
  text: string
  /** `null` for the main language of the conversation, or a language code such as `en`. */
  lang: string | null
}

export type ResponseEndReason = 'complete' | 'cancelled' | 'error'

export const VOICE_STATES = [
  'off',
  'downloading',
  'loading',
  'ready',
  'unavailable',
  'error'
] as const
export type VoiceState = (typeof VOICE_STATES)[number]

export const LISTEN_END_REASONS = ['silence', 'stopped', 'too_long', 'cancelled'] as const
export type ListenEndReason = (typeof LISTEN_END_REASONS)[number]

export interface TurnMetrics {
  type: 'turn.metrics'
  id: string
  listenedMs: number | null
  transcribeMs: number | null
  firstTextMs: number | null
  firstAudioMs: number | null
  totalMs: number | null
}

export type CoreMessage =
  | { type: 'ready'; protocol: number; core: string }
  /** In conversation mode, the student started speaking. The id names the question. */
  | { type: 'turn.start'; id: string }
  | { type: 'voice.status'; state: VoiceState; progress: number | null; message: string | null }
  | { type: 'listen.end'; id: string; reason: ListenEndReason }
  | { type: 'transcript'; id: string; text: string; lang: SpokenLanguage }
  | { type: 'response.start'; id: string }
  | { type: 'response.delta'; id: string; segments: Segment[] }
  | { type: 'response.emotion'; id: string; emotion: Emotion }
  | { type: 'response.end'; id: string; reason: ResponseEndReason }
  | { type: 'speech.start'; id: string; sampleRate: number }
  | { type: 'speech.segment'; id: string; index: number; text: string; lang: SpokenLanguage }
  | { type: 'speech.end'; id: string; reason: ResponseEndReason }
  | TurnMetrics
  | {
      type: 'provider.test.result'
      requestId: string
      ok: boolean
      models: string[]
      code: CoreErrorCode | null
      message: string | null
    }
  | { type: 'error'; id: string | null; code: CoreErrorCode; message: string }

/** Reads a message from the core. Anything that does not match the protocol gives `null`. */
export function parseCoreMessage(raw: unknown): CoreMessage | null {
  if (!isRecord(raw)) return null
  switch (raw.type) {
    case 'ready':
      return typeof raw.protocol === 'number' && isString(raw.core)
        ? { type: 'ready', protocol: raw.protocol, core: raw.core }
        : null
    case 'response.start':
      return isString(raw.id) ? { type: 'response.start', id: raw.id } : null
    case 'response.delta': {
      if (!isString(raw.id) || !Array.isArray(raw.segments)) return null
      const segments = raw.segments.map(parseSegment)
      return segments.every((segment) => segment !== null)
        ? { type: 'response.delta', id: raw.id, segments: segments as Segment[] }
        : null
    }
    case 'response.emotion':
      return isString(raw.id) && isEmotion(raw.emotion)
        ? { type: 'response.emotion', id: raw.id, emotion: raw.emotion }
        : null
    case 'response.end':
      return isString(raw.id) && isEndReason(raw.reason)
        ? { type: 'response.end', id: raw.id, reason: raw.reason }
        : null
    case 'provider.test.result': {
      const models = Array.isArray(raw.models) && raw.models.every(isString) ? raw.models : null
      if (!isString(raw.requestId) || typeof raw.ok !== 'boolean' || !models) return null
      if (!(raw.code === null || isErrorCode(raw.code))) return null
      if (!(raw.message === null || isString(raw.message))) return null
      return {
        type: 'provider.test.result',
        requestId: raw.requestId,
        ok: raw.ok,
        models,
        code: raw.code,
        message: raw.message
      }
    }
    case 'error':
      return (raw.id === null || isString(raw.id)) && isErrorCode(raw.code) && isString(raw.message)
        ? { type: 'error', id: raw.id, code: raw.code, message: raw.message }
        : null
    case 'voice.status': {
      const progress = raw.progress
      const validProgress =
        progress === null || (typeof progress === 'number' && progress >= 0 && progress <= 1)
      if (!isOneOf(VOICE_STATES, raw.state) || !validProgress) return null
      if (!(raw.message === null || isString(raw.message))) return null
      return { type: 'voice.status', state: raw.state, progress, message: raw.message }
    }
    case 'turn.start':
      return isString(raw.id) ? { type: 'turn.start', id: raw.id } : null
    case 'listen.end':
      return isString(raw.id) && isOneOf(LISTEN_END_REASONS, raw.reason)
        ? { type: 'listen.end', id: raw.id, reason: raw.reason }
        : null
    case 'transcript':
      return isString(raw.id) && isString(raw.text) && isSpokenLanguage(raw.lang)
        ? { type: 'transcript', id: raw.id, text: raw.text, lang: raw.lang }
        : null
    case 'speech.start':
      return isString(raw.id) && isCount(raw.sampleRate) && raw.sampleRate > 0
        ? { type: 'speech.start', id: raw.id, sampleRate: raw.sampleRate }
        : null
    case 'speech.segment':
      return isString(raw.id) &&
        isCount(raw.index) &&
        isString(raw.text) &&
        isSpokenLanguage(raw.lang)
        ? { type: 'speech.segment', id: raw.id, index: raw.index, text: raw.text, lang: raw.lang }
        : null
    case 'speech.end':
      return isString(raw.id) && isEndReason(raw.reason)
        ? { type: 'speech.end', id: raw.id, reason: raw.reason }
        : null
    case 'turn.metrics': {
      const fields = ['listenedMs', 'transcribeMs', 'firstTextMs', 'firstAudioMs', 'totalMs']
      if (!isString(raw.id) || !fields.every((f) => raw[f] === null || isCount(raw[f]))) {
        return null
      }
      return {
        type: 'turn.metrics',
        id: raw.id,
        listenedMs: raw.listenedMs as number | null,
        transcribeMs: raw.transcribeMs as number | null,
        firstTextMs: raw.firstTextMs as number | null,
        firstAudioMs: raw.firstAudioMs as number | null,
        totalMs: raw.totalMs as number | null
      }
    }
    default:
      return null
  }
}

/** The first byte of a binary frame. */
export const AudioKind = { microphone: 0x01, speech: 0x02 } as const
export type AudioKind = (typeof AudioKind)[keyof typeof AudioKind]

export const MICROPHONE_SAMPLE_RATE = 16_000
/** About two seconds of microphone audio. Real frames are much smaller. */
export const MAX_AUDIO_FRAME_BYTES = 64 * 1024

/** A binary frame: the kind byte, then 16-bit little-endian mono PCM. */
export function encodeAudioFrame(kind: AudioKind, pcm: Uint8Array): Uint8Array {
  const frame = new Uint8Array(pcm.byteLength + 1)
  frame[0] = kind
  frame.set(pcm, 1)
  return frame
}

/** Splits a binary frame, or gives `null` for an unknown kind or broken samples. */
export function decodeAudioFrame(frame: Uint8Array): { kind: AudioKind; pcm: Uint8Array } | null {
  if (frame.byteLength === 0 || frame.byteLength > MAX_AUDIO_FRAME_BYTES) return null
  const kind = frame[0]
  if (kind !== AudioKind.microphone && kind !== AudioKind.speech) return null
  const pcm = frame.subarray(1)
  return pcm.byteLength % 2 === 0 ? { kind, pcm } : null
}

function parseSegment(value: unknown): Segment | null {
  if (!isRecord(value) || !isString(value.text)) return null
  if (!(value.lang === null || isString(value.lang))) return null
  return { text: value.text, lang: value.lang }
}

function isEndReason(value: unknown): value is ResponseEndReason {
  return value === 'complete' || value === 'cancelled' || value === 'error'
}

function isErrorCode(value: unknown): value is CoreErrorCode {
  return isOneOf(CORE_ERROR_CODES, value)
}

function isOneOf<T extends string>(options: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (options as readonly string[]).includes(value)
}

function isSpokenLanguage(value: unknown): value is SpokenLanguage {
  return value === 'pt' || value === 'en'
}

/** A whole number from zero up, such as a sample rate or a duration in milliseconds. */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
