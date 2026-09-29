import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Answer, AvatarPose } from '../shared/api'
import type { ClientMessage } from '../shared/core-protocol'
import { FakeCoreConnection } from './test-helpers'
import { appendSegments, Tutor } from './tutor'
import { CORE_OFFLINE_MESSAGE } from './tutor-settings'

let core: FakeCoreConnection
let answers: Answer[]
let poses: Partial<AvatarPose>[]
let tutor: Tutor

beforeEach(() => {
  vi.useFakeTimers()
  core = new FakeCoreConnection()
  answers = []
  poses = []
  tutor = new Tutor(core, {
    answer: (answer) => answers.push(answer),
    pose: (changes) => poses.push(changes)
  })
})

afterEach(() => {
  tutor.dispose()
  vi.useRealTimers()
})

function askedId(): string {
  const question = core.sent.filter((message) => message.type === 'user.text').at(-1)
  if (!question || question.type !== 'user.text') throw new Error('Nothing was asked')
  return question.id
}

describe('Tutor', () => {
  it('asks the core and shows the teacher thinking', () => {
    expect(tutor.ask('  Since or for?  ')).toEqual({ ok: true })

    const sent = core.sent[0] as Extract<ClientMessage, { type: 'user.text' }>
    expect(sent.text).toBe('Since or for?')
    expect(answers.at(-1)).toEqual({
      id: sent.id,
      question: 'Since or for?',
      segments: [],
      status: 'waiting',
      error: null
    })
    expect(poses.at(-1)).toEqual({ state: 'thinking', emotion: 'neutral', talking: false })
  })

  it('streams the answer, talks while it streams, and relaxes afterwards', () => {
    tutor.ask('Since or for?')
    const id = askedId()
    core.emit({ type: 'response.start', id })
    core.emit({ type: 'response.emotion', id, emotion: 'happy' })
    core.emit({ type: 'response.delta', id, segments: [{ text: 'Usamos ', lang: null }] })
    core.emit({ type: 'response.delta', id, segments: [{ text: 'since', lang: 'en' }] })
    core.emit({ type: 'response.end', id, reason: 'complete' })

    expect(answers.at(-1)).toMatchObject({
      status: 'complete',
      segments: [
        { text: 'Usamos ', lang: null },
        { text: 'since', lang: 'en' }
      ]
    })
    expect(poses).toEqual([
      { state: 'thinking', emotion: 'neutral', talking: false },
      { emotion: 'happy' },
      { state: 'speaking', talking: true },
      { state: 'idle', talking: false }
    ])

    vi.advanceTimersByTime(8000)
    expect(poses.at(-1)).toEqual({ emotion: 'neutral' })
  })

  it('shows the error the core sent', () => {
    tutor.ask('hi')
    const id = askedId()
    core.emit({ type: 'response.start', id })
    core.emit({ type: 'error', id, code: 'invalid_key', message: 'The provider refused the key.' })
    core.emit({ type: 'response.end', id, reason: 'error' })

    expect(answers.at(-1)).toMatchObject({
      status: 'error',
      error: 'The provider refused the key.'
    })
  })

  it('cancels the running answer', () => {
    tutor.ask('hi')
    const id = askedId()
    tutor.cancel()
    expect(core.sent.at(-1)).toEqual({ type: 'response.cancel', id })

    core.emit({ type: 'response.end', id, reason: 'cancelled' })
    expect(answers.at(-1)?.status).toBe('cancelled')
    tutor.cancel()
    expect(core.sent.filter((message) => message.type === 'response.cancel')).toHaveLength(1)
  })

  it('ignores what arrives for an older answer', () => {
    tutor.ask('first')
    const first = askedId()
    tutor.ask('second')
    const second = askedId()

    core.emit({ type: 'response.end', id: first, reason: 'cancelled' })
    core.emit({ type: 'response.delta', id: first, segments: [{ text: 'old', lang: null }] })
    expect(answers.at(-1)).toMatchObject({ id: second, status: 'waiting', segments: [] })
  })

  it('ends the answer when the core goes away', () => {
    tutor.ask('hi')
    core.setStatus('connecting')
    expect(answers.at(-1)).toMatchObject({
      status: 'error',
      error: 'Lost the connection to the core.'
    })
    expect(poses.at(-1)).toEqual({ state: 'idle', talking: false })
  })

  it('refuses empty or very long questions, and questions while the core is offline', () => {
    expect(tutor.ask('   ').ok).toBe(false)
    expect(tutor.ask('x'.repeat(8001)).ok).toBe(false)
    core.currentStatus = 'offline'
    expect(tutor.ask('hi')).toEqual({ ok: false, message: CORE_OFFLINE_MESSAGE })
    expect(core.sent).toEqual([])
    expect(answers).toEqual([])
  })

  it('keeps a copy of the last answer for the bubble', () => {
    expect(tutor.current).toBeNull()
    tutor.ask('hi')
    const copy = tutor.current!
    copy.question = 'changed'
    expect(tutor.current?.question).toBe('hi')
  })
})

describe('appendSegments', () => {
  it('joins text in the same language and skips empty pieces', () => {
    expect(
      appendSegments(
        [{ text: 'A ', lang: null }],
        [
          { text: 'b ', lang: null },
          { text: '', lang: 'en' },
          { text: 'c', lang: 'en' },
          { text: 'd', lang: 'en' }
        ]
      )
    ).toEqual([
      { text: 'A b ', lang: null },
      { text: 'cd', lang: 'en' }
    ])
  })
})
