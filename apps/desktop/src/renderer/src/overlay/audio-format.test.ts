import { describe, expect, it } from 'vitest'

import { floatToPcm16, pcm16ToFloat, rootMeanSquare } from './audio-format'

describe('audio format', () => {
  it('writes 16-bit little-endian samples, clipping what is too loud', () => {
    const pcm = floatToPcm16(new Float32Array([0, 1, -1, 0.5, 2, -2]))
    const view = new DataView(pcm.buffer)
    expect([0, 1, 2, 3, 4, 5].map((i) => view.getInt16(i * 2, true))).toEqual([
      0, 32767, -32768, 16383, 32767, -32768
    ])
    expect([...pcm.subarray(2, 4)]).toEqual([0xff, 0x7f])
  })

  it('reads it back, even from a view that starts at an odd byte', () => {
    const pcm = floatToPcm16(new Float32Array([0.25, -0.5]))
    const shifted = new Uint8Array(pcm.length + 1)
    shifted.set(pcm, 1)
    const samples = pcm16ToFloat(shifted.subarray(1))
    expect(samples[0]).toBeCloseTo(0.25, 3)
    expect(samples[1]).toBeCloseTo(-0.5, 3)
  })

  it('measures loudness', () => {
    expect(rootMeanSquare(new Float32Array([]))).toBe(0)
    expect(rootMeanSquare(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5)
  })
})
