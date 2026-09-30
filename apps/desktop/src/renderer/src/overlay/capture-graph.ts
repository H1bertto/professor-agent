import { MICROPHONE_SAMPLE_RATE } from '../../../shared/core-protocol'
import { CAPTURE_PROCESSOR } from './audio-format'
import captureWorkletUrl from './capture-worklet?worker&url'
import type { CaptureGraph } from './microphone'

/**
 * An audio context at 16 kHz, the rate the core hears, with the capture worklet. Chromium
 * resamples the microphone to it, so the worklet only cuts blocks and converts them.
 */
export async function buildCaptureGraph(onBlock: (pcm: Uint8Array) => void): Promise<CaptureGraph> {
  const context = new AudioContext({ sampleRate: MICROPHONE_SAMPLE_RATE })
  try {
    await context.audioWorklet.addModule(captureWorkletUrl)
  } catch (error) {
    void context.close()
    throw error
  }
  const node = new AudioWorkletNode(context, CAPTURE_PROCESSOR)
  node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => onBlock(new Uint8Array(event.data))
  // The graph only runs toward an output. The worklet writes silence, so nothing is heard.
  node.connect(context.destination)
  return {
    attach: (stream) => {
      const source = context.createMediaStreamSource(stream)
      source.connect(node)
      return () => source.disconnect()
    },
    resume: () => context.resume(),
    suspend: () => context.suspend()
  }
}
