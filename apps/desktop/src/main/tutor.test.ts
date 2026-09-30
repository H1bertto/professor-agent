import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Answer, AvatarPose, SpeechCommand } from '../shared/api'
import type { ClientMessage, CoreMessage } from '../shared/core-protocol'
import { FakeCoreConnection } from './test-helpers'
import { appendSegments, LISTEN_LIMIT_MS, SPEECH_GRACE_MS, Tutor } from './tutor'
import { CORE_OFFLINE_MESSAGE } from './tutor-settings'

let core: FakeCoreConnection
let answers: Answer[]
let poses: Partial<AvatarPose>[]
let microphone: boolean[]
let speech: SpeechCommand[]
let tutor: Tutor

beforeEach(() => {
  vi.useFakeTimers()
  core = new FakeCoreConnection()
  answers = []
  poses = []
  microphone = []
  speech = []
  tutor = new Tutor(core, {
    answer: (answer) => answers.push(answer),
    pose: (changes) => poses.push(changes),
    microphone: (on) => microphone.push(on),
    speech: (command) => speech.push(command)
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

function listenedId(): string {
  const listen = core.sent.filter((message) => message.type === 'listen.start').at(-1)
  if (!listen || listen.type !== 'listen.start') throw new Error('Nothing was heard')
  return listen.id
}

const VOICE_READY: CoreMessage = {
  type: 'voice.status',
  state: 'ready',
  progress: null,
  message: null
}

/** 16-bit PCM of this length at 24 kHz, as the core speaks it. */
function speechAudio(seconds: number): Uint8Array {
  return new Uint8Array(Math.round(24_000 * seconds) * 2)
}

/** Asks a typed question whose answer is spoken, up to its first spoken sentence. */
function spokenAnswer(): string {
  tutor.ask('Since or for?')
  const id = askedId()
  core.emit({ type: 'response.start', id })
  core.emit({ type: 'response.delta', id, segments: [{ text: 'Oi. Usamos ', lang: null }] })
  core.emit({ type: 'speech.start', id, sampleRate: 24_000 })
  core.emit({ type: 'speech.segment', id, index: 0, text: 'Oi.', lang: 'pt' })
  return id
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
      error: null,
      speech: 'none',
      speechParts: [],
      speakingIndex: null
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

  it('gives up when the core never answers', () => {
    tutor.ask('hi')
    const id = askedId()
    vi.advanceTimersByTime(89_000)
    expect(answers.at(-1)?.status).toBe('waiting')

    vi.advanceTimersByTime(1_000)
    expect(core.sent.at(-1)).toEqual({ type: 'response.cancel', id })
    expect(answers.at(-1)).toMatchObject({ status: 'error' })
    expect(answers.at(-1)?.error).toContain('did not answer')
    expect(poses.at(-1)).toEqual({ state: 'idle', talking: false })
  })

  it('does not give up on an answer that is streaming', () => {
    tutor.ask('hi')
    const id = askedId()
    core.emit({ type: 'response.delta', id, segments: [{ text: 'Oi', lang: null }] })
    vi.advanceTimersByTime(120_000)

    expect(answers.at(-1)?.status).toBe('streaming')
    expect(core.sent.filter((message) => message.type === 'response.cancel')).toEqual([])
  })

  it('keeps a copy of the last answer for the bubble', () => {
    expect(tutor.current).toBeNull()
    tutor.ask('hi')
    const copy = tutor.current!
    copy.question = 'changed'
    expect(tutor.current?.question).toBe('hi')
  })
})

describe('Tutor voice', () => {
  it('hears a spoken question with the hotkey and answers it', () => {
    core.emit(VOICE_READY)
    tutor.listen()
    const id = listenedId()
    expect(answers.at(-1)).toMatchObject({ id, question: '', status: 'listening' })
    expect(poses.at(-1)).toEqual({ state: 'listening', emotion: 'neutral', talking: false })
    expect(microphone).toEqual([true])

    const pcm = new Uint8Array([1, 2, 3, 4])
    tutor.hear(pcm)
    expect(core.sentAudio).toEqual([pcm])

    core.emit({ type: 'listen.end', id, reason: 'silence' })
    expect(microphone).toEqual([true, false])
    expect(answers.at(-1)?.status).toBe('waiting')
    expect(poses.at(-1)).toEqual({ state: 'thinking', talking: false })
    tutor.hear(pcm)
    expect(core.sentAudio).toHaveLength(1)

    core.emit({ type: 'transcript', id, text: 'Since or for?', lang: 'en' })
    core.emit({ type: 'response.start', id })
    core.emit({ type: 'response.delta', id, segments: [{ text: 'Usamos', lang: null }] })
    core.emit({ type: 'response.end', id, reason: 'complete' })
    expect(answers.at(-1)).toMatchObject({ question: 'Since or for?', status: 'complete' })
    expect(poses.at(-1)).toEqual({ state: 'idle', talking: false })
  })

  it('ends the question on a second press', () => {
    core.emit(VOICE_READY)
    tutor.listen()
    const id = listenedId()
    tutor.listen()

    expect(core.sent.at(-1)).toEqual({ type: 'listen.stop', id })
    expect(microphone).toEqual([true, false])
    core.emit({ type: 'listen.end', id, reason: 'stopped' })
    expect(answers.at(-1)?.status).toBe('waiting')
  })

  it('stops listening by itself if the core never ends the question', () => {
    core.emit(VOICE_READY)
    tutor.listen()
    const id = listenedId()
    vi.advanceTimersByTime(LISTEN_LIMIT_MS)

    expect(core.sent.at(-1)).toEqual({ type: 'listen.stop', id })
    expect(microphone).toEqual([true, false])
  })

  it('says so when the core heard nothing', () => {
    core.emit(VOICE_READY)
    tutor.listen()
    const id = listenedId()
    core.emit({ type: 'listen.end', id, reason: 'silence' })
    core.emit({ type: 'error', id, code: 'no_speech', message: 'I did not hear anything.' })

    expect(answers.at(-1)).toMatchObject({ status: 'error', error: 'I did not hear anything.' })
    expect(poses.at(-1)).toEqual({ state: 'idle', talking: false })
  })

  it('ends the question when the microphone cannot open', () => {
    core.emit(VOICE_READY)
    tutor.listen()
    const id = listenedId()
    tutor.microphoneFailed('Allow the microphone in the Windows settings.')

    expect(core.sent.at(-1)).toEqual({ type: 'response.cancel', id })
    expect(microphone).toEqual([true, false])
    expect(answers.at(-1)).toMatchObject({
      status: 'error',
      error: 'Allow the microphone in the Windows settings.'
    })
  })

  it('explains why it cannot listen, without opening the microphone', () => {
    tutor.listen()
    expect(answers.at(-1)).toMatchObject({ status: 'error', question: '' })
    expect(answers.at(-1)?.error).toContain('Voice is off')

    core.emit({ type: 'voice.status', state: 'downloading', progress: 0.42, message: null })
    tutor.listen()
    expect(answers.at(-1)?.error).toContain('downloading (42%)')

    core.emit(VOICE_READY)
    core.setStatus('connecting')
    core.setStatus('online')
    tutor.listen()
    expect(answers.at(-1)?.error).toContain('Voice is off')

    expect(core.sent.filter((message) => message.type === 'listen.start')).toEqual([])
    expect(microphone).toEqual([])
  })

  it('interrupts the teacher to listen', () => {
    core.emit(VOICE_READY)
    const first = spokenAnswer()
    tutor.listen()

    expect(core.sent).toContainEqual({ type: 'response.cancel', id: first })
    expect(speech.at(-1)).toEqual({ type: 'stop' })
    expect(answers.at(-1)).toMatchObject({ id: listenedId(), status: 'listening' })
  })

  it('plays the spoken answer and follows it for the subtitles', () => {
    const id = spokenAnswer()
    expect(answers.at(-1)).toMatchObject({ speech: 'playing', speechParts: ['Oi.'] })
    expect(poses.at(-1)).toEqual({ state: 'speaking', talking: false })

    const pcm = speechAudio(0.2)
    core.emitAudio(pcm)
    tutor.speechReport({ type: 'segment', index: 0 })
    expect(answers.at(-1)?.speakingIndex).toBe(0)

    core.emit({ type: 'response.end', id, reason: 'complete' })
    expect(answers.at(-1)).toMatchObject({ status: 'complete', speech: 'playing' })
    expect(poses.at(-1)).toEqual({ talking: false })

    // A pause between sentences is not the end of the speech.
    tutor.speechReport({ type: 'finished' })
    expect(answers.at(-1)?.speech).toBe('playing')

    core.emit({ type: 'speech.end', id, reason: 'complete' })
    tutor.speechReport({ type: 'finished' })
    expect(answers.at(-1)).toMatchObject({ speech: 'done', speakingIndex: null })
    expect(poses.at(-1)).toEqual({ state: 'idle', talking: false })
    expect(speech).toEqual([
      { type: 'start', sampleRate: 24_000 },
      { type: 'segment', index: 0 },
      { type: 'audio', pcm },
      { type: 'end' }
    ])
  })

  it('drops speech audio when no answer is being spoken', () => {
    core.emitAudio(speechAudio(0.2))
    tutor.ask('hi')
    core.emitAudio(speechAudio(0.2))
    expect(speech).toEqual([])
  })

  it('finishes the speech by itself if the overlay never reports it', () => {
    const id = spokenAnswer()
    core.emitAudio(speechAudio(1))
    core.emit({ type: 'response.end', id, reason: 'complete' })
    core.emit({ type: 'speech.end', id, reason: 'complete' })

    vi.advanceTimersByTime(1000 + SPEECH_GRACE_MS - 1)
    expect(answers.at(-1)?.speech).toBe('playing')
    vi.advanceTimersByTime(1)
    expect(answers.at(-1)?.speech).toBe('done')
    expect(poses.at(-1)).toEqual({ state: 'idle', talking: false })
  })

  it('cancels speech that runs after the text is complete', () => {
    const id = spokenAnswer()
    core.emit({ type: 'response.end', id, reason: 'complete' })
    tutor.cancel()

    expect(core.sent.at(-1)).toEqual({ type: 'response.cancel', id })
    expect(speech.at(-1)).toEqual({ type: 'stop' })
    expect(answers.at(-1)).toMatchObject({ status: 'complete', speech: 'done' })
    expect(poses.at(-1)).toEqual({ state: 'idle', talking: false })
  })

  it('stops the speech of an answer that fails', () => {
    const id = spokenAnswer()
    core.emit({ type: 'error', id, code: 'provider_unavailable', message: 'The provider is down.' })
    core.emit({ type: 'response.end', id, reason: 'error' })

    expect(speech.at(-1)).toEqual({ type: 'stop' })
    expect(answers.at(-1)).toMatchObject({ status: 'error', speech: 'done' })
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
