import type { SpeechCommand } from '../../../shared/api'
import { pcm16ToFloat, rootMeanSquare } from './audio-format'

/** A short head start, so the first sound is not cut while the audio device wakes up. */
const LEAD_SECONDS = 0.05
const ANALYSER_SIZE = 1024

export interface SpeechPlayerEvents {
  /** The student starts hearing this part of the answer. */
  segment(index: number): void
  /** The last audio after `end` finished playing. */
  finished(): void
}

/**
 * Plays the teacher's speech as it streams in. Each audio frame is scheduled right after the one
 * before it, so sentences play without gaps, and an analyser reads the level for lip sync.
 */
export class SpeechPlayer {
  private context: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private levels: Float32Array<ArrayBuffer> | null = null
  private sampleRate = 24_000
  private nextStart = 0
  private readonly sources = new Set<AudioBufferSourceNode>()
  private readonly timers = new Set<ReturnType<typeof setTimeout>>()
  /** When each part starts, in audio context time, until it is reported. */
  private marks: { time: number; index: number }[] = []
  private paused = false
  /** A part that begins with the next audio frame. */
  private pendingSegment: number | null = null
  private active = false
  private ended = false

  constructor(
    private readonly events: SpeechPlayerEvents,
    private readonly createContext: () => AudioContext = () => new AudioContext()
  ) {}

  /** Whether speech plays now, or is about to. */
  get playing(): boolean {
    return this.sources.size > 0
  }

  handle(command: SpeechCommand): void {
    switch (command.type) {
      case 'start':
        this.start(command.sampleRate)
        return
      case 'segment':
        if (this.active) this.pendingSegment = command.index
        return
      case 'audio':
        this.play(command.pcm)
        return
      case 'end':
        this.ended = this.active
        this.finishIfDone()
        return
      case 'stop':
        this.stop()
        return
      case 'pause':
        this.pause()
        return
      case 'resume':
        this.resume()
        return
    }
  }

  /** How loud the speech is right now, for lip sync. */
  level(): number {
    if (!this.analyser || !this.levels || !this.playing) return 0
    this.analyser.getFloatTimeDomainData(this.levels)
    return rootMeanSquare(this.levels)
  }

  private start(sampleRate: number): void {
    this.stop()
    this.active = true
    this.sampleRate = sampleRate
    void this.audio().resume()
  }

  private audio(): AudioContext {
    if (!this.context) {
      const context = this.createContext()
      const analyser = context.createAnalyser()
      analyser.fftSize = ANALYSER_SIZE
      analyser.connect(context.destination)
      this.context = context
      this.analyser = analyser
      this.levels = new Float32Array(ANALYSER_SIZE)
    }
    return this.context
  }

  private play(pcm: Uint8Array): void {
    const context = this.context
    if (!this.active || this.ended || !context || !this.analyser) return
    const samples = pcm16ToFloat(pcm)
    if (samples.length === 0) return
    const buffer = context.createBuffer(1, samples.length, this.sampleRate)
    buffer.copyToChannel(samples, 0)
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(this.analyser)
    // After a gap, such as a slow sentence, the next frame starts now instead of in the past.
    const startAt = Math.max(this.nextStart, context.currentTime + LEAD_SECONDS)
    this.nextStart = startAt + buffer.duration
    source.onended = () => {
      this.sources.delete(source)
      source.disconnect()
      this.finishIfDone()
    }
    this.sources.add(source)
    source.start(startAt)
    if (this.pendingSegment !== null) {
      this.marks.push({ time: startAt, index: this.pendingSegment })
      this.pendingSegment = null
      if (!this.paused) this.scheduleMarks()
    }
  }

  /** Reports each part when its audio starts. The audio clock stops while paused, so the timers
   * are set again from it on every resume. */
  private scheduleMarks(): void {
    this.clearTimers()
    const now = this.context?.currentTime ?? 0
    for (const mark of this.marks) {
      const timer = setTimeout(
        () => {
          this.timers.delete(timer)
          this.marks = this.marks.filter((other) => other !== mark)
          this.events.segment(mark.index)
        },
        Math.max(0, (mark.time - now) * 1000)
      )
      this.timers.add(timer)
    }
  }

  private pause(): void {
    if (!this.active || this.paused) return
    this.paused = true
    this.clearTimers()
    void this.context?.suspend()
  }

  private resume(): void {
    if (!this.paused) return
    this.paused = false
    void this.context?.resume()
    this.scheduleMarks()
  }

  private clearTimers(): void {
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
  }

  private finishIfDone(): void {
    if (!this.active || !this.ended || this.sources.size > 0) return
    this.reset()
    this.events.finished()
  }

  private stop(): void {
    for (const source of this.sources) {
      source.onended = null
      source.stop()
      source.disconnect()
    }
    this.sources.clear()
    this.reset()
  }

  private reset(): void {
    this.clearTimers()
    this.marks = []
    this.paused = false
    this.active = false
    this.ended = false
    this.pendingSegment = null
    this.nextStart = 0
    // A suspended context keeps the audio device idle while the teacher is quiet.
    void this.context?.suspend()
  }
}
