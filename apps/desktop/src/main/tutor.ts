import { randomUUID } from 'crypto'
import type {
  Answer,
  AnswerStatus,
  AskResult,
  AvatarPose,
  CoreConnectionStatus
} from '../shared/api'
import type { CoreMessage, Segment } from '../shared/core-protocol'
import { CORE_OFFLINE_MESSAGE, type CoreConnection } from './tutor-settings'

/** The core connection, plus its status, so a lost connection can end the answer. */
export interface TutorCore extends CoreConnection {
  onStatus(listener: (status: CoreConnectionStatus) => void): () => void
}

export interface TutorEvents {
  /** The answer changed: more text, a new status, or an error. */
  answer(answer: Answer): void
  pose(changes: Partial<AvatarPose>): void
}

/** The same limit as the core protocol. */
export const MAX_QUESTION_LENGTH = 8000
/** The avatar keeps the emotion of the answer for a while, then relaxes. */
const RELAX_AFTER_MS = 8000
const GENERIC_ERROR = 'Something went wrong. Try again.'

/**
 * Sends the student's questions to the core and follows the answers. One answer runs at a time:
 * a new question replaces the current one, and the core cancels the old answer by itself.
 */
export class Tutor {
  private answer: Answer | null = null
  private relaxTimer: ReturnType<typeof setTimeout> | undefined
  private readonly stopListening: (() => void)[]

  constructor(
    private readonly core: TutorCore,
    private readonly events: TutorEvents,
    private readonly relaxAfterMs = RELAX_AFTER_MS
  ) {
    this.stopListening = [
      core.onMessage((message) => this.receive(message)),
      core.onStatus((status) => {
        if (status !== 'online') this.finish('error', 'Lost the connection to the core.')
      })
    ]
  }

  /** The last answer, to show again when the bubble opens. */
  get current(): Answer | null {
    return this.answer && structuredClone(this.answer)
  }

  ask(question: string): AskResult {
    const text = question.trim()
    if (!text) return { ok: false, message: 'Type a question first.' }
    if (text.length > MAX_QUESTION_LENGTH) {
      return { ok: false, message: 'The question is too long. Try a shorter one.' }
    }
    const id = randomUUID()
    if (!this.core.send({ type: 'user.text', id, text })) {
      return { ok: false, message: CORE_OFFLINE_MESSAGE }
    }
    clearTimeout(this.relaxTimer)
    this.answer = { id, question: text, segments: [], status: 'waiting', error: null }
    this.publish()
    this.events.pose({ state: 'thinking', emotion: 'neutral', talking: false })
    return { ok: true }
  }

  /** Stops the answer that is running, if any. */
  cancel(): void {
    if (this.answer && isRunning(this.answer.status)) {
      this.core.send({ type: 'response.cancel', id: this.answer.id })
    }
  }

  dispose(): void {
    clearTimeout(this.relaxTimer)
    for (const stop of this.stopListening) stop()
  }

  private receive(message: CoreMessage): void {
    const answer = this.answer
    // Messages for older answers, such as the end of a cancelled one, change nothing.
    if (!answer || !('id' in message) || message.id !== answer.id || !isRunning(answer.status)) {
      return
    }
    switch (message.type) {
      case 'response.delta':
        answer.segments = appendSegments(answer.segments, message.segments)
        if (answer.status === 'waiting') {
          answer.status = 'streaming'
          this.events.pose({ state: 'speaking', talking: true })
        }
        this.publish()
        return
      case 'response.emotion':
        this.events.pose({ emotion: message.emotion })
        return
      case 'error':
        answer.error = message.message
        return
      case 'response.end':
        this.finish(message.reason)
        return
    }
  }

  private finish(status: 'complete' | 'cancelled' | 'error', error?: string): void {
    const answer = this.answer
    if (!answer || !isRunning(answer.status)) return
    answer.status = status
    if (status === 'error') answer.error ??= error ?? GENERIC_ERROR
    this.publish()
    this.events.pose({ state: 'idle', talking: false })
    clearTimeout(this.relaxTimer)
    this.relaxTimer = setTimeout(() => this.events.pose({ emotion: 'neutral' }), this.relaxAfterMs)
  }

  private publish(): void {
    if (this.answer) this.events.answer(structuredClone(this.answer))
  }
}

function isRunning(status: AnswerStatus): boolean {
  return status === 'waiting' || status === 'streaming'
}

/** Adds streamed text, joining neighbors in the same language so the bubble gets few spans. */
export function appendSegments(existing: Segment[], incoming: Segment[]): Segment[] {
  const result = existing.map((segment) => ({ ...segment }))
  for (const segment of incoming) {
    if (!segment.text) continue
    const last = result.at(-1)
    if (last && last.lang === segment.lang) last.text += segment.text
    else result.push({ ...segment })
  }
  return result
}
