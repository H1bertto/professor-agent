// Runs on the audio thread. It collects the microphone in blocks of 512 samples, 32 ms at
// 16 kHz and the window the core's voice detector reads, and posts each block as 16-bit PCM.

import { CAPTURE_PROCESSOR, floatToPcm16 } from './audio-format'

// Globals of the audio thread, which the DOM types leave out.
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void

const BLOCK_SAMPLES = 512

class CaptureProcessor extends AudioWorkletProcessor {
  private readonly block = new Float32Array(BLOCK_SAMPLES)
  private filled = 0

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0]
    if (!channel) return true
    let offset = 0
    while (offset < channel.length) {
      const count = Math.min(channel.length - offset, BLOCK_SAMPLES - this.filled)
      this.block.set(channel.subarray(offset, offset + count), this.filled)
      this.filled += count
      offset += count
      if (this.filled === BLOCK_SAMPLES) {
        const pcm = floatToPcm16(this.block)
        this.port.postMessage(pcm.buffer, [pcm.buffer])
        this.filled = 0
      }
    }
    return true
  }
}

registerProcessor(CAPTURE_PROCESSOR, CaptureProcessor)
