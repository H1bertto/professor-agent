import { describe, expect, it } from 'vitest'

import type { Answer } from '../../../shared/api'
import { hideDelayMs, isFinished, spokenRange, statusLine, subtitleRuns } from './bubble-view'

function answer(changes: Partial<Answer> = {}): Answer {
  return {
    id: 'q1',
    question: 'hi',
    segments: [],
    status: 'complete',
    error: null,
    speech: 'none',
    speechParts: [],
    speakingIndex: null,
    ...changes
  }
}

describe('bubble view', () => {
  it('knows when the answer is finished', () => {
    expect(isFinished(answer({ status: 'waiting' }))).toBe(false)
    expect(isFinished(answer({ status: 'streaming' }))).toBe(false)
    expect(isFinished(answer({ status: 'cancelled' }))).toBe(true)
    expect(isFinished(answer({ status: 'listening' }))).toBe(false)
    expect(isFinished(answer({ status: 'complete', speech: 'playing' }))).toBe(false)
    expect(isFinished(answer({ status: 'complete', speech: 'done' }))).toBe(true)
  })

  it('keeps longer answers on screen longer, within limits', () => {
    const text = (length: number): Answer =>
      answer({ segments: [{ text: 'x'.repeat(length), lang: null }] })
    expect(hideDelayMs(text(10))).toBe(12_000)
    expect(hideDelayMs(text(300))).toBe(27_000)
    expect(hideDelayMs(text(5_000))).toBe(60_000)
  })

  it('explains waiting, stopping, and errors', () => {
    expect(statusLine(answer({ status: 'waiting' }))?.kind).toBe('thinking')
    expect(statusLine(answer({ status: 'cancelled' }))?.text).toBe('Stopped.')
    expect(statusLine(answer({ status: 'error', error: 'No credit.' }))).toEqual({
      text: 'No credit.',
      kind: 'error'
    })
    expect(statusLine(answer())).toBeNull()
  })

  it('shows a notice in a calm tone, as finished', () => {
    const notice = answer({ status: 'notice', error: 'Listening paused.' })
    expect(statusLine(notice)).toEqual({ text: 'Listening paused.', kind: 'note' })
    expect(isFinished(notice)).toBe(true)
  })
})

describe('subtitles', () => {
  const segments = [
    { text: 'Usamos ', lang: null },
    { text: 'since', lang: 'en' },
    { text: ' para o início. E ', lang: null },
    { text: 'for', lang: 'en' },
    { text: ' para a duração.', lang: null }
  ]
  const speaking = (speakingIndex: number | null, speechParts: string[]): Answer =>
    answer({ segments, speech: 'playing', speechParts, speakingIndex })

  it('finds the part being said in the answer text', () => {
    const parts = ['Usamos since para o início.', 'E for para a duração.']
    expect(spokenRange(speaking(0, parts))).toEqual({ start: 0, end: 27 })
    expect(spokenRange(speaking(1, parts))).toEqual({ start: 28, end: 49 })
  })

  it('finds a repeated phrase in its own place, after the parts before it', () => {
    const repeated = answer({
      segments: [{ text: 'Muito bem. Muito bem.', lang: null }],
      speech: 'playing',
      speechParts: ['Muito bem.', 'Muito bem.'],
      speakingIndex: 1
    })
    expect(spokenRange(repeated)).toEqual({ start: 11, end: 21 })
  })

  it('shows no subtitle when nothing is being said', () => {
    expect(spokenRange(speaking(null, ['Usamos since para o início.']))).toBeNull()
    expect(spokenRange(answer({ segments, speechParts: ['Usamos'], speakingIndex: 0 }))).toBeNull()
    expect(spokenRange(speaking(0, ['text that is not there']))).toBeNull()
  })

  it('cuts the text where the spoken part begins and ends, keeping each language', () => {
    const runs = subtitleRuns(segments, { start: 28, end: 49 })
    expect(runs).toEqual([
      { text: 'Usamos ', lang: null, spoken: false },
      { text: 'since', lang: 'en', spoken: false },
      { text: ' para o início. ', lang: null, spoken: false },
      { text: 'E ', lang: null, spoken: true },
      { text: 'for', lang: 'en', spoken: true },
      { text: ' para a duração.', lang: null, spoken: true }
    ])
    expect(runs.map((run) => run.text).join('')).toBe(segments.map((s) => s.text).join(''))
  })

  it('keeps the segments as they are without a spoken part', () => {
    expect(subtitleRuns(segments, null).every((run) => !run.spoken)).toBe(true)
    expect(subtitleRuns(segments, null)).toHaveLength(segments.length)
  })
})
