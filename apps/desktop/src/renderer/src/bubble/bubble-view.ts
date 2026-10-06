// Small decisions for the answer bubble, kept apart from the DOM so they are easy to test.

import type { Answer } from '../../../shared/api'
import type { Segment } from '../../../shared/core-protocol'

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

/** Where the part the student hears now sits in the answer text, as character offsets. */
export function spokenRange(answer: Answer): { start: number; end: number } | null {
  const current = answer.speakingIndex
  if (answer.speech !== 'playing' || current === null) return null
  const text = answer.segments.map((segment) => segment.text).join('')
  // The parts come in order, so each one is searched after the one before it.
  let from = 0
  for (let index = 0; index <= current; index++) {
    const part = answer.speechParts[index]
    const at = part ? text.indexOf(part, from) : -1
    if (at < 0) return null
    if (index === current) return { start: at, end: at + part.length }
    from = at + part.length
  }
  return null
}

/** A stretch of the answer with one language, and whether the student hears it now. */
export interface TextRun {
  text: string
  lang: string | null
  spoken: boolean
}

/** The answer's segments, cut where the spoken part begins and ends. */
export function subtitleRuns(
  segments: Segment[],
  spoken: { start: number; end: number } | null
): TextRun[] {
  const runs: TextRun[] = []
  let offset = 0
  for (const segment of segments) {
    const end = offset + segment.text.length
    const cuts = spoken ? [spoken.start, spoken.end].filter((cut) => cut > offset && cut < end) : []
    let from = offset
    for (const cut of [...cuts, end]) {
      if (cut > from) {
        runs.push({
          text: segment.text.slice(from - offset, cut - offset),
          lang: segment.lang,
          spoken: spoken !== null && from >= spoken.start && from < spoken.end
        })
      }
      from = cut
    }
    offset = end
  }
  return runs
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
    case 'notice':
      return { text: answer.error ?? '', kind: 'note' }
    case 'cancelled':
      return { text: 'Stopped.', kind: 'note' }
    case 'error':
      return { text: answer.error ?? 'Something went wrong.', kind: 'error' }
    default:
      return null
  }
}
