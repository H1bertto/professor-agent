import { describe, expect, it } from 'vitest'

import { Microphone, microphoneError, type CaptureGraph } from './microphone'

class FakeStream {
  stopped = false

  getTracks(): { stop(): void }[] {
    return [{ stop: () => (this.stopped = true) }]
  }
}

/** A system microphone that answers when the test says so. */
class FakeDevices {
  readonly streams: FakeStream[] = []
  readonly attached: FakeStream[] = []
  detached = 0
  suspended = 0
  onBlock: ((pcm: Uint8Array) => void) | null = null
  private pending: { resolve(stream: FakeStream): void; reject(error: unknown): void }[] = []

  requestStream = (): Promise<MediaStream> =>
    new Promise((resolve, reject) => {
      this.pending.push({ resolve: (stream) => resolve(stream as unknown as MediaStream), reject })
    })

  buildGraph = async (onBlock: (pcm: Uint8Array) => void): Promise<CaptureGraph> => {
    this.onBlock = onBlock
    return {
      attach: (stream) => {
        this.attached.push(stream as unknown as FakeStream)
        return () => (this.detached += 1)
      },
      resume: async () => undefined,
      suspend: async () => {
        this.suspended += 1
      }
    }
  }

  async grant(): Promise<FakeStream> {
    const stream = new FakeStream()
    this.streams.push(stream)
    await settle()
    this.pending.shift()?.resolve(stream)
    await settle()
    return stream
  }

  async refuse(error: unknown): Promise<void> {
    await settle()
    this.pending.shift()?.reject(error)
    await settle()
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

function microphone(): {
  devices: FakeDevices
  mic: Microphone
  heard: number[]
  failures: string[]
} {
  const devices = new FakeDevices()
  const heard: number[] = []
  const failures: string[] = []
  const mic = new Microphone(
    { audio: (pcm) => heard.push(pcm.byteLength), failed: (message) => failures.push(message) },
    devices
  )
  return { devices, mic, heard, failures }
}

describe('Microphone', () => {
  it('passes the audio on while open and lets the device go on close', async () => {
    const { devices, mic, heard } = microphone()
    mic.set(true)
    const stream = await devices.grant()
    expect(devices.attached).toEqual([stream])

    devices.onBlock?.(new Uint8Array(1024))
    mic.set(false)
    devices.onBlock?.(new Uint8Array(1024))
    await settle()

    expect(heard).toEqual([1024])
    expect(stream.stopped).toBe(true)
    expect(devices.detached).toBe(1)
    expect(devices.suspended).toBe(1)
  })

  it('lets the device go when it was closed while still opening', async () => {
    const { devices, mic } = microphone()
    mic.set(true)
    mic.set(false)
    const stream = await devices.grant()

    expect(stream.stopped).toBe(true)
    expect(devices.attached).toEqual([])
  })

  it('opens again after a quick close and open', async () => {
    const { devices, mic } = microphone()
    mic.set(true)
    mic.set(false)
    mic.set(true)
    const first = await devices.grant()
    const second = await devices.grant()

    expect(first.stopped).toBe(true)
    expect(second.stopped).toBe(false)
    expect(devices.attached).toEqual([second])
  })

  it('says in words why the microphone did not open', async () => {
    const { devices, mic, failures } = microphone()
    mic.set(true)
    await devices.refuse(new DOMException('Permission denied', 'NotAllowedError'))
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('privacy settings')

    // The next question tries again.
    mic.set(true)
    const stream = await devices.grant()
    expect(devices.attached).toEqual([stream])
  })
})

describe('microphoneError', () => {
  it('explains the common failures', () => {
    const named = (name: string): string => microphoneError(new DOMException('', name))
    expect(named('NotFoundError')).toContain('No microphone')
    expect(named('NotReadableError')).toContain('busy')
    expect(microphoneError('weird')).toContain('Could not open')
  })
})
