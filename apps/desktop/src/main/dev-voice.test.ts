import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

import { FileMicrophone, readWav, wavFile } from './dev-voice'

describe('WAV files', () => {
  it('reads back what it writes', () => {
    const pcm = new Uint8Array([1, 0, 2, 0, 0xff, 0x7f])
    const wav = readWav(wavFile(pcm, 16_000))
    expect(wav?.sampleRate).toBe(16_000)
    expect(wav?.channels).toBe(1)
    expect([...(wav?.pcm ?? [])]).toEqual([...pcm])
  })

  it('skips chunks it does not need, such as metadata', () => {
    const plain = wavFile(new Uint8Array([7, 0]), 16_000)
    // A LIST chunk of 3 bytes, padded to 4, between the format and the data.
    const extra = Buffer.concat([Buffer.from('LIST'), Buffer.from([3, 0, 0, 0]), Buffer.alloc(4)])
    const withExtra = Buffer.concat([plain.subarray(0, 36), extra, plain.subarray(36)])
    expect([...(readWav(withExtra)?.pcm ?? [])]).toEqual([7, 0])
  })

  it('refuses files that are not 16-bit PCM WAV', () => {
    expect(readWav(Buffer.from('not a wav file at all'))).toBeNull()
    const float = wavFile(new Uint8Array(4), 16_000)
    float.writeUInt16LE(3, 20)
    expect(readWav(float)).toBeNull()
  })
})

describe('FileMicrophone', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('plays the file in 32 ms blocks, then silence, and stops when closed', () => {
    const microphone = new FileMicrophone(new Uint8Array(1536).fill(9))
    const blocks: Uint8Array[] = []
    microphone.set(true, (pcm) => blocks.push(pcm))

    vi.advanceTimersByTime(32 * 3)
    expect(blocks.map((block) => block.byteLength)).toEqual([1024, 1024, 1024])
    expect(blocks[0].every((byte) => byte === 9)).toBe(true)
    expect(blocks[1].subarray(0, 512).every((byte) => byte === 9)).toBe(true)
    expect(blocks[1].subarray(512).every((byte) => byte === 0)).toBe(true)
    expect(blocks[2].every((byte) => byte === 0)).toBe(true)

    microphone.set(false, (pcm) => blocks.push(pcm))
    vi.advanceTimersByTime(1000)
    expect(blocks).toHaveLength(3)
  })

  it('stops by itself after the trailing silence', () => {
    const microphone = new FileMicrophone(new Uint8Array(1024))
    const blocks: Uint8Array[] = []
    microphone.set(true, (pcm) => blocks.push(pcm))
    vi.advanceTimersByTime(60_000)
    // The file, then about three seconds of silence.
    expect(blocks.length).toBeGreaterThan(90)
    expect(blocks.length).toBeLessThan(100)
  })
})
