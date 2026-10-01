import { randomUUID } from 'crypto'
import type {
  Answer,
  AnswerStatus,
  AskResult,
  AvatarPose,
  CoreConnectionStatus,
  SpeechCommand,
  SpeechReport,
  VoiceStatusView
} from '../shared/api'
import type { CoreMessage, Segment } from '../shared/core-protocol'
import { CORE_OFFLINE_MESSAGE, type CoreConnection } from './tutor-settings'

/** The core connection, plus its status and audio, so the tutor can listen and speak. */
export interface TutorCore extends CoreConnection {
  onStatus(listener: (status: CoreConnectionStatus) => void): () => void
  sendAudio(pcm: Uint8Array): boolean
  onAudio(listener: (pcm: Uint8Array) => void): () => void
}

export interface TutorEvents {
  /** The answer changed: more text, a new status, or an error. */
  answer(answer: Answer): void
  pose(changes: Partial<AvatarPose>): void
  /** Opens or closes the microphone in the overlay. */
  microphone(on: boolean): void
  /** Drives the speech playback in the overlay. */
  speech(command: SpeechCommand): void
  /** The speech models changed state, for the settings window. */
  voiceStatus(status: VoiceStatusView): void
}

type VoiceStatus = Extract<CoreMessage, { type: 'voice.status' }>

/** The same limit as the core protocol. */
export const MAX_QUESTION_LENGTH = 8000
/** The avatar keeps the emotion of the answer for a while, then relaxes. */
const RELAX_AFTER_MS = 8000
/**
 * The core stops a provider that stays silent for 45 seconds. This longer limit only matters if
 * the core itself stops responding, so the bubble never waits forever.
 */
const WAIT_LIMIT_MS = 90_000
/** The core ends a spoken question after 30 seconds of audio. This covers audio that stops. */
export const LISTEN_LIMIT_MS = 35_000
/** How long past the end of the audio the overlay may take to say it finished playing. */
export const SPEECH_GRACE_MS = 5000
const GENERIC_ERROR = 'Something went wrong. Try again.'
const VOICE_OFF: VoiceStatus = { type: 'voice.status', state: 'off', progress: null, message: null }

/** The speech of the current answer, from `speech.start` until the overlay finishes it. */
interface Speech {
  sampleRate: number
  /** How much audio arrived, in milliseconds. */
  audioMs: number
  firstAudioAt: number | null
  /** The core sent `speech.end`, so no more audio is coming. */
  ended: boolean
}

/**
 * Sends the student's questions to the core and follows the answers. One answer runs at a time:
 * a new question, typed or spoken, stops the current answer and its speech.
 */
export class Tutor {
  private answer: Answer | null = null
  /** Whether the core started the answer, after which it always ends it with `response.end`. */
  private responseStarted = false
  private microphoneOpen = false
  private speech: Speech | null = null
  private voice: VoiceStatus = VOICE_OFF
  private relaxTimer: ReturnType<typeof setTimeout> | undefined
  private waitTimer: ReturnType<typeof setTimeout> | undefined
  private listenTimer: ReturnType<typeof setTimeout> | undefined
  private speechTimer: ReturnType<typeof setTimeout> | undefined
  private readonly stopFollowingCore: (() => void)[]

  constructor(
    private readonly core: TutorCore,
    private readonly events: TutorEvents,
    private readonly relaxAfterMs = RELAX_AFTER_MS,
    private readonly waitLimitMs = WAIT_LIMIT_MS
  ) {
    this.stopFollowingCore = [
      core.onMessage((message) => this.receive(message)),
      core.onAudio((pcm) => this.play(pcm)),
      core.onStatus((status) => {
        if (status !== 'online') this.lostCore()
      })
    ]
  }

  /** The last answer, to show again when the bubble opens. */
  get current(): Answer | null {
    return this.answer && structuredClone(this.answer)
  }

  get voiceStatus(): VoiceStatusView {
    const { state, progress, message } = this.voice
    return { state, progress, message }
  }

  ask(question: string): AskResult {
    const text = question.trim()
    if (!text) return { ok: false, message: 'Type a question first.' }
    if (text.length > MAX_QUESTION_LENGTH) {
      return { ok: false, message: 'The question is too long. Try a shorter one.' }
    }
    if (this.core.currentStatus !== 'online') return { ok: false, message: CORE_OFFLINE_MESSAGE }
    this.halt()
    const id = randomUUID()
    if (!this.core.send({ type: 'user.text', id, text })) {
      return { ok: false, message: CORE_OFFLINE_MESSAGE }
    }
    this.begin(id, text, 'waiting')
    this.events.pose({ state: 'thinking', emotion: 'neutral', talking: false })
    this.waitForAnswer(id)
    return { ok: true }
  }

  /**
   * The talk hotkey. It starts a spoken question, or ends the one being heard. Starting one also
   * interrupts the teacher. Problems show in the bubble, since a hotkey has no box of its own.
   */
  listen(): void {
    if (this.answer?.status === 'listening') {
      this.stopListening(this.answer.id)
      return
    }
    this.halt()
    const problem = this.cannotListen()
    if (problem) {
      this.showProblem(problem)
      return
    }
    const id = randomUUID()
    if (!this.core.send({ type: 'listen.start', id })) {
      this.showProblem(CORE_OFFLINE_MESSAGE)
      return
    }
    this.begin(id, '', 'listening')
    this.events.pose({ state: 'listening', emotion: 'neutral', talking: false })
    this.microphoneOpen = true
    this.events.microphone(true)
    this.listenTimer = setTimeout(() => this.stopListening(id), LISTEN_LIMIT_MS)
  }

  /** Microphone audio from the overlay, which goes to the core while a question is heard. */
  hear(pcm: Uint8Array): void {
    if (this.answer?.status === 'listening' && this.microphoneOpen) this.core.sendAudio(pcm)
  }

  microphoneFailed(message: string): void {
    const answer = this.answer
    if (answer?.status !== 'listening') return
    this.core.send({ type: 'response.cancel', id: answer.id })
    this.finish('error', message)
  }

  /** What the overlay reports while it plays the speech. */
  speechReport(report: SpeechReport): void {
    const answer = this.answer
    if (!answer || answer.speech !== 'playing' || !this.speech) return
    if (report.type === 'segment') {
      if (report.index < answer.speechParts.length && report.index !== answer.speakingIndex) {
        answer.speakingIndex = report.index
        this.publish()
      }
      return
    }
    // The overlay finishes only after `end`. Before that, a gap between sentences is not the end.
    if (this.speech.ended) this.speechDone()
  }

  /** Stops the answer and its speech, or the question being heard. */
  cancel(): void {
    if (!this.halt()) return
    this.publish()
    this.settle()
  }

  dispose(): void {
    for (const timer of [this.relaxTimer, this.waitTimer, this.listenTimer, this.speechTimer]) {
      clearTimeout(timer)
    }
    for (const stop of this.stopFollowingCore) stop()
  }

  private begin(id: string, question: string, status: 'listening' | 'waiting'): void {
    clearTimeout(this.relaxTimer)
    this.answer = { ...newAnswer(id), question, status }
    this.responseStarted = false
    this.publish()
  }

  /** A problem that is not an answer, such as voice being off. */
  private showProblem(message: string): void {
    this.answer = { ...newAnswer(randomUUID()), status: 'error', error: message }
    this.publish()
  }

  private cannotListen(): string | null {
    if (this.core.currentStatus !== 'online') return CORE_OFFLINE_MESSAGE
    switch (this.voice.state) {
      case 'ready':
        return null
      case 'off':
        return 'Voice is off. Turn it on in the settings to talk to the teacher.'
      case 'downloading': {
        const progress = this.voice.progress
        const done = progress === null ? '' : ` (${Math.round(progress * 100)}%)`
        return `The speech models are still downloading${done}. Try again when they are ready.`
      }
      case 'loading':
        return 'The speech models are still loading. Try again in a moment.'
      default:
        return this.voice.message ?? 'Voice is not available on this computer.'
    }
  }

  private stopListening(id: string): void {
    const answer = this.answer
    if (answer?.id !== id || answer.status !== 'listening') return
    clearTimeout(this.listenTimer)
    this.closeMicrophone()
    this.core.send({ type: 'listen.stop', id })
    // The core answers with `listen.end`. This covers a core that never does.
    this.waitForAnswer(id)
  }

  private waitForAnswer(id: string): void {
    clearTimeout(this.waitTimer)
    this.waitTimer = setTimeout(() => this.giveUpWaiting(id), this.waitLimitMs)
  }

  private giveUpWaiting(id: string): void {
    const answer = this.answer
    if (answer?.id !== id || (answer.status !== 'waiting' && answer.status !== 'listening')) return
    this.core.send({ type: 'response.cancel', id })
    this.finish(
      'error',
      'The teacher did not answer. Check that the core is running and try again.'
    )
  }

  /**
   * Stops what runs now without showing it, since the caller either starts something new or
   * shows the cancelled answer. Returns `false` when nothing was running.
   */
  private halt(): boolean {
    const answer = this.answer
    if (!answer) return false
    const running = isRunning(answer.status)
    const speaking = answer.speech === 'playing'
    if (!running && !speaking) return false
    this.core.send({ type: 'response.cancel', id: answer.id })
    this.clearTurnTimers()
    this.closeMicrophone()
    if (speaking) this.stopSpeech()
    if (running) answer.status = 'cancelled'
    return true
  }

  private receive(message: CoreMessage): void {
    if (message.type === 'voice.status') {
      this.setVoice(message)
      return
    }
    const answer = this.answer
    // Messages for older answers, such as the end of a cancelled one, change nothing.
    if (!answer || !('id' in message) || message.id !== answer.id) return
    if (message.type.startsWith('speech.')) {
      this.receiveSpeech(answer, message)
      return
    }
    if (!isRunning(answer.status)) return
    switch (message.type) {
      case 'listen.end':
        if (answer.status !== 'listening') return
        clearTimeout(this.listenTimer)
        this.closeMicrophone()
        if (message.reason === 'cancelled') {
          this.finish('cancelled')
          return
        }
        answer.status = 'waiting'
        this.publish()
        this.events.pose({ state: 'thinking', talking: false })
        this.waitForAnswer(answer.id)
        return
      case 'transcript':
        answer.question = message.text
        this.publish()
        return
      case 'response.start':
        this.responseStarted = true
        return
      case 'response.delta':
        answer.segments = appendSegments(answer.segments, message.segments)
        if (answer.status === 'waiting') {
          answer.status = 'streaming'
          clearTimeout(this.waitTimer)
          // Speech moves the mouth with its own audio, so the text only does it until then.
          this.events.pose({ state: 'speaking', talking: answer.speech !== 'playing' })
        }
        this.publish()
        return
      case 'response.emotion':
        this.events.pose({ emotion: message.emotion })
        return
      case 'error':
        // Before the answer starts, an error such as `no_speech` is the end of the question.
        if (!this.responseStarted) this.finish('error', message.message)
        else answer.error = message.message
        return
      case 'response.end':
        this.finish(message.reason)
        return
    }
  }

  private receiveSpeech(answer: Answer, message: CoreMessage): void {
    switch (message.type) {
      case 'speech.start': {
        const speakable = isRunning(answer.status) || answer.status === 'complete'
        if (answer.speech !== 'none' || !speakable) return
        answer.speech = 'playing'
        this.speech = {
          sampleRate: message.sampleRate,
          audioMs: 0,
          firstAudioAt: null,
          ended: false
        }
        this.events.speech({ type: 'start', sampleRate: message.sampleRate })
        this.events.pose({ state: 'speaking', talking: false })
        this.publish()
        return
      }
      case 'speech.segment':
        if (answer.speech !== 'playing' || !this.speech || this.speech.ended) return
        if (message.index > answer.speechParts.length) return
        answer.speechParts[message.index] = message.text
        this.events.speech({ type: 'segment', index: message.index })
        this.publish()
        return
      case 'speech.end':
        this.endSpeech()
        return
    }
  }

  private play(pcm: Uint8Array): void {
    const speech = this.speech
    if (this.answer?.speech !== 'playing' || !speech || speech.ended) return
    speech.firstAudioAt ??= Date.now()
    speech.audioMs += (pcm.byteLength / 2 / speech.sampleRate) * 1000
    this.events.speech({ type: 'audio', pcm })
  }

  /** No more audio is coming. The overlay plays what it has, then reports `finished`. */
  private endSpeech(): void {
    const speech = this.speech
    if (this.answer?.speech !== 'playing' || !speech || speech.ended) return
    speech.ended = true
    this.events.speech({ type: 'end' })
    // In case the overlay never reports, for example after it reloaded.
    const played = speech.firstAudioAt === null ? 0 : Date.now() - speech.firstAudioAt
    const left = Math.max(0, speech.audioMs - played)
    this.speechTimer = setTimeout(() => this.speechDone(), left + SPEECH_GRACE_MS)
  }

  private speechDone(): void {
    const answer = this.answer
    if (!answer || answer.speech !== 'playing') return
    this.forgetSpeech(answer)
    this.publish()
    if (!isRunning(answer.status)) this.settle()
  }

  /** Silences the overlay at once and drops the rest of the speech. */
  private stopSpeech(): void {
    const answer = this.answer
    if (!answer || answer.speech !== 'playing') return
    this.forgetSpeech(answer)
    this.events.speech({ type: 'stop' })
  }

  private forgetSpeech(answer: Answer): void {
    clearTimeout(this.speechTimer)
    this.speech = null
    answer.speech = 'done'
    answer.speakingIndex = null
  }

  private setVoice(status: VoiceStatus): void {
    const changed =
      status.state !== this.voice.state ||
      status.progress !== this.voice.progress ||
      status.message !== this.voice.message
    this.voice = status
    if (changed) this.events.voiceStatus(this.voiceStatus)
  }

  private lostCore(): void {
    this.setVoice(VOICE_OFF)
    const answer = this.answer
    if (!answer) return
    if (isRunning(answer.status)) {
      this.finish('error', 'Lost the connection to the core.')
      return
    }
    // A finished answer can still play the speech that already arrived.
    this.endSpeech()
  }

  private finish(status: 'complete' | 'cancelled' | 'error', error?: string): void {
    const answer = this.answer
    if (!answer || !isRunning(answer.status)) return
    this.clearTurnTimers()
    this.closeMicrophone()
    answer.status = status
    if (status === 'error') answer.error ??= error ?? GENERIC_ERROR
    if (status !== 'complete') this.stopSpeech()
    this.publish()
    // A spoken answer keeps talking after its text is complete.
    if (answer.speech === 'playing') this.events.pose({ talking: false })
    else this.settle()
  }

  /** The avatar goes back to rest and relaxes its face a little later. */
  private settle(): void {
    this.events.pose({ state: 'idle', talking: false })
    clearTimeout(this.relaxTimer)
    this.relaxTimer = setTimeout(() => this.events.pose({ emotion: 'neutral' }), this.relaxAfterMs)
  }

  private closeMicrophone(): void {
    if (!this.microphoneOpen) return
    this.microphoneOpen = false
    this.events.microphone(false)
  }

  private clearTurnTimers(): void {
    clearTimeout(this.waitTimer)
    clearTimeout(this.listenTimer)
  }

  private publish(): void {
    if (this.answer) this.events.answer(structuredClone(this.answer))
  }
}

function newAnswer(id: string): Answer {
  return {
    id,
    question: '',
    segments: [],
    status: 'waiting',
    error: null,
    speech: 'none',
    speechParts: [],
    speakingIndex: null
  }
}

function isRunning(status: AnswerStatus): boolean {
  return status === 'listening' || status === 'waiting' || status === 'streaming'
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
