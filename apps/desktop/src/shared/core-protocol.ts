// Messages between the desktop app and the core, version 1. See docs/protocol.md.

import { isEmotion, type Emotion } from './avatar'

export const PROTOCOL_VERSION = 1

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

export type ClientMessage =
  | { type: 'hello'; protocol: number; client: string; token: string | null }
  | { type: 'configure'; provider: ProviderConfig | null; persona: PersonaConfig }
  | { type: 'provider.test'; requestId: string; provider: ProviderConfig }
  | { type: 'user.text'; id: string; text: string }
  | { type: 'response.cancel'; id: string }

export const CORE_ERROR_CODES = [
  'invalid_key',
  'rate_limited',
  'insufficient_credit',
  'model_not_found',
  'provider_unavailable',
  'not_configured',
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

export type CoreMessage =
  | { type: 'ready'; protocol: number; core: string }
  | { type: 'response.start'; id: string }
  | { type: 'response.delta'; id: string; segments: Segment[] }
  | { type: 'response.emotion'; id: string; emotion: Emotion }
  | { type: 'response.end'; id: string; reason: ResponseEndReason }
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
    default:
      return null
  }
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
  return typeof value === 'string' && (CORE_ERROR_CODES as readonly string[]).includes(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
