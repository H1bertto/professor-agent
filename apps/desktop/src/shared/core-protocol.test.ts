import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

import { EMOTIONS } from './avatar'
import {
  AudioKind,
  decodeAudioFrame,
  encodeAudioFrame,
  MAX_AUDIO_FRAME_BYTES,
  parseCoreMessage,
  type ClientMessage
} from './core-protocol'

const FIXTURES = join(__dirname, '..', '..', '..', '..', 'protocol', 'fixtures')

function fixture(path: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, path), 'utf-8'))
}

describe('core messages', () => {
  const files = readdirSync(join(FIXTURES, 'core'))

  it.each(files)('parses the %s fixture exactly', (file) => {
    const raw = fixture(join('core', file))
    expect(parseCoreMessage(raw)).toEqual(raw)
  })

  it('rejects unknown types and malformed messages', () => {
    const invalid = [
      null,
      'ready',
      { type: 'shutdown' },
      { type: 'response.emotion', id: 'm', emotion: 'furious' },
      { type: 'response.delta', id: 'm', segments: [{ text: 1, lang: null }] },
      { type: 'error', id: null, code: 'boom', message: 'x' },
      { type: 'response.end', id: 'm', reason: 'maybe' },
      { type: 'voice.status', state: 'sleeping', progress: null, message: null },
      { type: 'voice.status', state: 'downloading', progress: 1.5, message: null },
      { type: 'transcript', id: 'v', text: 'hola', lang: 'es' },
      { type: 'speech.start', id: 'v', sampleRate: 0 },
      { type: 'speech.segment', id: 'v', index: -1, text: 'x', lang: 'pt' },
      { type: 'turn.metrics', id: 'v', listenedMs: '1', transcribeMs: null },
      { type: 'listen.end', id: 'v', reason: 'bored' }
    ]
    for (const raw of invalid) expect(parseCoreMessage(raw)).toBeNull()
  })
})

describe('audio frames', () => {
  it('round-trip the kind byte and the samples', () => {
    const pcm = new Uint8Array([1, 0, 255, 127])
    const frame = encodeAudioFrame(AudioKind.microphone, pcm)
    expect([...frame]).toEqual([1, 1, 0, 255, 127])
    const decoded = decodeAudioFrame(frame)
    expect(decoded?.kind).toBe(AudioKind.microphone)
    expect([...(decoded?.pcm ?? [])]).toEqual([...pcm])
    expect(decodeAudioFrame(encodeAudioFrame(AudioKind.speech, pcm))?.kind).toBe(AudioKind.speech)
  })

  it('rejects empty, unknown, odd, and oversized frames', () => {
    for (const frame of [
      new Uint8Array([]),
      new Uint8Array([7, 0, 0]),
      new Uint8Array([1, 0]),
      new Uint8Array(MAX_AUDIO_FRAME_BYTES + 1).fill(1)
    ]) {
      expect(decodeAudioFrame(frame)).toBeNull()
    }
  })
})

describe('client messages', () => {
  // Typing each fixture as ClientMessage makes the type checker catch protocol drift.
  const expected: Record<string, ClientMessage> = {
    'hello.json': { type: 'hello', protocol: 3, client: 'desktop/0.1.0', token: null },
    'configure.json': {
      type: 'configure',
      provider: {
        kind: 'anthropic',
        baseUrl: null,
        model: 'claude-haiku-4-5',
        apiKey: 'test-key-not-real'
      },
      persona: { name: 'Professor', instructions: 'Use examples about cooking.' },
      voice: {
        enabled: true,
        speakAnswers: true,
        spokenLanguage: 'auto',
        englishVoice: 'teacher',
        teacherVoice: 'alex',
        nativeVoice: 'michael'
      }
    },
    'conversation.start.json': { type: 'conversation.start' },
    'conversation.stop.json': { type: 'conversation.stop' },
    'speech.heard.json': { type: 'speech.heard', id: 'voice-1', parts: 2 },
    'listen.start.json': { type: 'listen.start', id: 'voice-1' },
    'listen.stop.json': { type: 'listen.stop', id: 'voice-1' },
    'provider.test.json': {
      type: 'provider.test',
      requestId: 'test-1',
      provider: {
        kind: 'openai-compatible',
        baseUrl: 'https://api.groq.com/openai/v1',
        model: 'llama-3.3-70b-versatile',
        apiKey: 'test-key-not-real'
      }
    },
    'user.text.json': {
      type: 'user.text',
      id: 'msg-1',
      text: 'Qual a diferença entre since e for?'
    },
    'response.cancel.json': { type: 'response.cancel', id: 'msg-1' }
  }

  it('has a typed example for every fixture', () => {
    expect(Object.keys(expected).sort()).toEqual(readdirSync(join(FIXTURES, 'client')).sort())
  })

  it.each(Object.entries(expected))('matches the %s fixture', (file, message) => {
    expect(fixture(join('client', file))).toEqual(message)
  })
})

describe('emotion vocabulary', () => {
  it('matches the vocabulary shared with the core', () => {
    expect(fixture('emotions.json')).toEqual([...EMOTIONS])
  })
})
