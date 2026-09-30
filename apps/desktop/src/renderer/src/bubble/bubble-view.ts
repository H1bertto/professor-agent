// Small decisions for the answer bubble, kept apart from the DOM so they are easy to test.

import type { Answer } from '../../../shared/api'

const MIN_VISIBLE_MS = 12_000
const MAX_VISIBLE_MS = 60_000
/**
 * Roughly the time to read one character in a second language, about 11 characters a second.
 * Pin keeps the bubble, and the mouse over it pauses the countdown.
 */
const MS_PER_CHARACTER = 90

/** Finished once the text is done and the teacher stopped speaking it. */
export function isFinished(answer: Answer): boolean {
  const running = ['listening', 'waiting', 'streaming'].includes(answer.status)
  return !running && answer.speech !== 'playing'
}

/** How long a finished answer stays on screen: time to read it, within limits. */
export function hideDelayMs(answer: Answer): number {
  const characters = answer.segments.reduce((total, segment) => total + segment.text.length, 0)
  return Math.min(MAX_VISIBLE_MS, Math.max(MIN_VISIBLE_MS, characters * MS_PER_CHARACTER))
}

/** The line under the answer, or `null` when there is nothing to say. */
export function statusLine(
  answer: Answer
): { text: string; kind: 'thinking' | 'note' | 'error' } | null {
  switch (answer.status) {
    case 'listening':
      return { text: 'Listening...', kind: 'thinking' }
    case 'waiting':
      return { text: 'Thinking...', kind: 'thinking' }
    case 'cancelled':
      return { text: 'Stopped.', kind: 'note' }
    case 'error':
      return { text: answer.error ?? 'Something went wrong.', kind: 'error' }
    default:
      return null
  }
}
