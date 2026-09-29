import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

import { EMOTIONS } from './avatar'
import { parseCoreMessage, type ClientMessage } from './core-protocol'

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
      { type: 'response.end', id: 'm', reason: 'maybe' }
    ]
    for (const raw of invalid) expect(parseCoreMessage(raw)).toBeNull()
  })
})

describe('client messages', () => {
  // Typing each fixture as ClientMessage makes the type checker catch protocol drift.
  const expected: Record<string, ClientMessage> = {
    'hello.json': { type: 'hello', protocol: 1, client: 'desktop/0.1.0', token: null },
    'configure.json': {
      type: 'configure',
      provider: {
        kind: 'anthropic',
        baseUrl: null,
        model: 'claude-haiku-4-5',
        apiKey: 'test-key-not-real'
      },
      persona: { name: 'Professor', instructions: 'Use examples about cooking.' }
    },
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
