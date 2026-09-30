// Conversions between Web Audio samples and the 16-bit little-endian PCM of the core protocol.

/** The name the capture worklet registers its processor under. */
export const CAPTURE_PROCESSOR = 'professor-capture'

/** Float samples between -1 and 1 as 16-bit little-endian PCM. */
export function floatToPcm16(samples: Float32Array): Uint8Array {
  const pcm = new Uint8Array(samples.length * 2)
  const view = new DataView(pcm.buffer)
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }
  return pcm
}

/** 16-bit little-endian PCM as float samples between -1 and 1. */
export function pcm16ToFloat(pcm: Uint8Array): Float32Array<ArrayBuffer> {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  const samples = new Float32Array(Math.floor(pcm.byteLength / 2))
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 0x8000
  return samples
}

/** How loud a block of samples is, as the root mean square. */
export function rootMeanSquare(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (const sample of samples) sum += sample * sample
  return Math.sqrt(sum / samples.length)
}
