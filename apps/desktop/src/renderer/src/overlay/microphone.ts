/** The audio graph that turns the microphone into 16 kHz PCM blocks. See capture-graph.ts. */
export interface CaptureGraph {
  /** Feeds the stream into the capture worklet, and returns a function that disconnects it. */
  attach(stream: MediaStream): () => void
  resume(): Promise<void>
  suspend(): Promise<void>
}

export interface MicrophoneEvents {
  audio(pcm: Uint8Array): void
  failed(message: string): void
}

export interface MicrophoneDevices {
  /** Asks the system for the microphone. */
  requestStream(): Promise<MediaStream>
  buildGraph(onBlock: (pcm: Uint8Array) => void): Promise<CaptureGraph>
}

/** What the overlay asks for. Echo cancellation keeps the teacher's voice out of the question. */
export const MICROPHONE_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  },
  video: false
}

/**
 * The microphone, open only while the teacher listens. The audio graph stays ready between
 * questions, but the device itself is released, so the system shows it in use only then.
 */
export class Microphone {
  private graph: Promise<CaptureGraph> | null = null
  private stream: MediaStream | null = null
  private detach: (() => void) | null = null
  private wanted = false
  /** Counts opens and closes, so a slow open that was closed meanwhile lets the device go. */
  private generation = 0

  constructor(
    private readonly events: MicrophoneEvents,
    private readonly devices: MicrophoneDevices
  ) {}

  set(on: boolean): void {
    if (on) void this.open()
    else this.close()
  }

  private async open(): Promise<void> {
    if (this.wanted) return
    this.wanted = true
    const generation = ++this.generation
    let stream: MediaStream | null = null
    try {
      const graph = await this.captureGraph()
      stream = await this.devices.requestStream()
      if (generation !== this.generation) {
        release(stream)
        return
      }
      this.stream = stream
      this.detach = graph.attach(stream)
      await graph.resume()
    } catch (error) {
      if (stream && stream !== this.stream) release(stream)
      if (generation !== this.generation) return
      this.close()
      this.events.failed(microphoneError(error))
    }
  }

  private captureGraph(): Promise<CaptureGraph> {
    this.graph ??= this.devices
      .buildGraph((pcm) => {
        if (this.stream) this.events.audio(pcm)
      })
      .catch((error: unknown) => {
        // The next question tries again.
        this.graph = null
        throw error
      })
    return this.graph
  }

  private close(): void {
    this.wanted = false
    this.generation += 1
    this.detach?.()
    this.detach = null
    if (this.stream) release(this.stream)
    this.stream = null
    void this.graph?.then((graph) => graph.suspend()).catch(() => undefined)
  }
}

function release(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop()
}

/** Words for the student when the microphone does not open. */
export function microphoneError(error: unknown): string {
  const name = error instanceof Error || error instanceof DOMException ? error.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'The microphone is blocked. Allow desktop apps to use it in the Windows privacy settings.'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone was found. Connect one and try again.'
    case 'NotReadableError':
    case 'AbortError':
      return 'The microphone is busy in another app, or it stopped working.'
    default:
      return 'Could not open the microphone. Try again.'
  }
}
