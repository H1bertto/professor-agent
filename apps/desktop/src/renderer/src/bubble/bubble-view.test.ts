import { describe, expect, it } from 'vitest'

import type { Answer } from '../../../shared/api'
import { hideDelayMs, isFinished, statusLine } from './bubble-view'

function answer(changes: Partial<Answer> = {}): Answer {
  return { id: 'q1', question: 'hi', segments: [], status: 'complete', error: null, ...changes }
}

describe('bubble view', () => {
  it('knows when the answer is finished', () => {
    expect(isFinished(answer({ status: 'waiting' }))).toBe(false)
    expect(isFinished(answer({ status: 'streaming' }))).toBe(false)
    expect(isFinished(answer({ status: 'cancelled' }))).toBe(true)
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
})
