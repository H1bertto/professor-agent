import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SpeechPlayer } from './speech-player'

class FakeBuffer {
  constructor(
    readonly length: number,
    readonly sampleRate: number
  ) {}

  get duration(): number {
    return this.length / this.sampleRate
  }

  copyToChannel = (): undefined => undefined
}

class FakeSource {
  buffer: FakeBuffer | null = null
  onended: (() => void) | null = null
  startedAt: number | null = null
  stopped = false

  connect = (): undefined => undefined
  disconnect = (): undefined => undefined

  start(when: number): void {
    this.startedAt = when
  }

  stop(): void {
    this.stopped = true
  }

  /** The audio device finished playing this frame. */
  end(): void {
    this.onended?.()
  }
}

/** Just enough of an AudioContext for the player, with a clock the test moves. */
class FakeContext {
  currentTime = 0
  state: 'running' | 'suspended' = 'suspended'
  readonly destination = {}
  readonly sources: FakeSource[] = []
  level = 0

  createAnalyser(): object {
    return {
      fftSize: 0,
      connect: () => undefined,
      getFloatTimeDomainData: (target: Float32Array) => target.fill(this.level)
    }
  }

  createBuffer(_channels: number, length: number, sampleRate: number): FakeBuffer {
    return new FakeBuffer(length, sampleRate)
  }

  createBufferSource(): FakeSource {
    const source = new FakeSource()
    this.sources.push(source)
    return source
  }

  resume(): Promise<void> {
    this.state = 'running'
    return Promise.resolve()
  }

  suspend(): Promise<void> {
    this.state = 'suspended'
    return Promise.resolve()
  }
}

/** 16-bit PCM of this length at 24 kHz. */
function audio(seconds: number): Uint8Array {
  return new Uint8Array(Math.round(24_000 * seconds) * 2)
}

let context: FakeContext
let segments: number[]
let finished: number
let player: SpeechPlayer

beforeEach(() => {
  vi.useFakeTimers()
  context = new FakeContext()
  segments = []
  finished = 0
  player = new SpeechPlayer(
    { segment: (index) => segments.push(index), finished: () => (finished += 1) },
    () => context as unknown as AudioContext
  )
})

afterEach(() => {
  vi.useRealTimers()
})

describe('SpeechPlayer', () => {
  it('plays the frames back to back and reports each part as it starts', () => {
    player.handle({ type: 'start', sampleRate: 24_000 })
    expect(context.state).toBe('running')
    player.handle({ type: 'segment', index: 0 })
    player.handle({ type: 'audio', pcm: audio(0.2) })
    player.handle({ type: 'audio', pcm: audio(0.2) })
    player.handle({ type: 'segment', index: 1 })
    player.handle({ type: 'audio', pcm: audio(0.1) })

    const starts = context.sources.map((source) => source.startedAt)
    expect(starts[0]).toBeCloseTo(0.05)
    expect(starts[1]).toBeCloseTo(0.25)
    expect(starts[2]).toBeCloseTo(0.45)
    expect(player.playing).toBe(true)

    vi.advanceTimersByTime(50)
    expect(segments).toEqual([0])
    vi.advanceTimersByTime(400)
    expect(segments).toEqual([0, 1])
  })

  it('finishes only once the core is done and the last frame has played', () => {
    player.handle({ type: 'start', sampleRate: 24_000 })
    player.handle({ type: 'audio', pcm: audio(0.2) })
    player.handle({ type: 'audio', pcm: audio(0.2) })

    // The queue runs dry between two sentences, but more speech is coming.
    context.sources[0].end()
    context.sources[1].end()
    expect(finished).toBe(0)

    player.handle({ type: 'audio', pcm: audio(0.2) })
    player.handle({ type: 'end' })
    expect(finished).toBe(0)
    context.sources[2].end()
    expect(finished).toBe(1)
    expect(context.state).toBe('suspended')
  })

  it('finishes at once when the core ends with nothing left to play', () => {
    player.handle({ type: 'start', sampleRate: 24_000 })
    player.handle({ type: 'audio', pcm: audio(0.2) })
    context.sources[0].end()
    player.handle({ type: 'end' })
    expect(finished).toBe(1)
  })

  it('starts a late frame now instead of in the past', () => {
    player.handle({ type: 'start', sampleRate: 24_000 })
    player.handle({ type: 'audio', pcm: audio(0.2) })
    context.currentTime = 1
    player.handle({ type: 'audio', pcm: audio(0.2) })
    expect(context.sources[1].startedAt).toBeCloseTo(1.05)
  })

  it('stops at once, forgets the queue, and ignores what comes after', () => {
    player.handle({ type: 'start', sampleRate: 24_000 })
    player.handle({ type: 'segment', index: 0 })
    player.handle({ type: 'audio', pcm: audio(0.2) })
    player.handle({ type: 'audio', pcm: audio(0.2) })
    player.handle({ type: 'stop' })

    expect(context.sources.every((source) => source.stopped)).toBe(true)
    expect(player.playing).toBe(false)
    player.handle({ type: 'audio', pcm: audio(0.2) })
    player.handle({ type: 'end' })
    vi.runAllTimers()
    expect(context.sources).toHaveLength(2)
    expect(segments).toEqual([])
    expect(finished).toBe(0)
  })

  it('reads the loudness only while speech plays', () => {
    context.level = 0.3
    expect(player.level()).toBe(0)
    player.handle({ type: 'start', sampleRate: 24_000 })
    player.handle({ type: 'audio', pcm: audio(0.2) })
    expect(player.level()).toBeCloseTo(0.3)
  })
})
