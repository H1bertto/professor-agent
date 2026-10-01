import { app } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import type { SpeechCommand, SpeechReport } from '../shared/api'
import { MICROPHONE_SAMPLE_RATE, type VoiceConfig } from '../shared/core-protocol'

// Development helpers to check the voice path without speaking. Packaged builds ignore them.
//
// - PROFESSOR_DEV_VOICE=teacher or native turns voice on, with spoken answers, without changing
//   the saved settings.
// - PROFESSOR_DEV_MIC_FILE=<file.wav> plays a 16 kHz mono 16-bit WAV to the core in place of the
//   microphone, then silence, so the core ends the question by itself.
// - PROFESSOR_DEV_TALK=1 presses the talk hotkey once, when voice is ready.
// - PROFESSOR_CAPTURE_SPEECH=<file.wav> saves each spoken answer as the overlay receives it, and
//   logs when the overlay starts each part and finishes playing.

export function devVoiceOverride(env = process.env): VoiceConfig | null {
  const voice = env.PROFESSOR_DEV_VOICE
  if (app.isPackaged || !voice) return null
  return {
    enabled: true,
    speakAnswers: true,
    spokenLanguage: 'auto',
    englishVoice: voice === 'native' ? 'native' : 'teacher'
  }
}

export function devTalkRequested(env = process.env): boolean {
  return !app.isPackaged && env.PROFESSOR_DEV_TALK === '1'
}

/** 32 ms of 16-bit audio at 16 kHz, the blocks the overlay sends. */
const BLOCK_BYTES = 1024
const BLOCK_MS = 32
/** Silence after the file, long enough for the core to hear that the question ended. */
const TRAILING_SILENCE_MS = 3000

/** A microphone that plays a WAV file at the pace of real speech. */
export class FileMicrophone {
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(private readonly pcm: Uint8Array) {}

  static async load(env = process.env): Promise<FileMicrophone | null> {
    const file = env.PROFESSOR_DEV_MIC_FILE
    if (app.isPackaged || !file) return null
    const wav = readWav(await readFile(file))
    if (!wav || wav.sampleRate !== MICROPHONE_SAMPLE_RATE || wav.channels !== 1) {
      console.warn(
        'PROFESSOR_DEV_MIC_FILE must be a 16 kHz mono 16-bit WAV, so the app ignores it.'
      )
      return null
    }
    return new FileMicrophone(wav.pcm)
  }

  set(on: boolean, hear: (pcm: Uint8Array) => void): void {
    clearInterval(this.timer)
    if (!on) return
    const end = this.pcm.byteLength + (TRAILING_SILENCE_MS / BLOCK_MS) * BLOCK_BYTES
    let offset = 0
    this.timer = setInterval(() => {
      if (offset >= end) {
        clearInterval(this.timer)
        return
      }
      const block = new Uint8Array(BLOCK_BYTES)
      if (offset < this.pcm.byteLength) block.set(this.pcm.subarray(offset, offset + BLOCK_BYTES))
      offset += BLOCK_BYTES
      hear(block)
    }, BLOCK_MS)
  }
}

/** Saves the speech of each answer to a WAV file, to check it without listening. */
export class SpeechRecorder {
  private chunks: Uint8Array[] = []
  private sampleRate = 24_000
  private saved = 0
  private startedAt = 0

  constructor(private readonly target: string) {}

  static fromEnv(env = process.env): SpeechRecorder | null {
    const target = env.PROFESSOR_CAPTURE_SPEECH
    return app.isPackaged || !target ? null : new SpeechRecorder(target)
  }

  handle(command: SpeechCommand): void {
    if (command.type === 'start') {
      this.chunks = []
      this.sampleRate = command.sampleRate
      this.startedAt = Date.now()
    } else if (command.type === 'audio') {
      this.chunks.push(command.pcm)
    } else if (command.type === 'end' || command.type === 'stop') {
      void this.save(command.type === 'end' ? 'complete' : 'stopped')
    }
  }

  /** What the overlay says it plays, to check the playback without listening. */
  report(report: SpeechReport): void {
    const after = ((Date.now() - this.startedAt) / 1000).toFixed(2)
    if (report.type === 'segment')
      console.log(`Overlay plays part ${report.index} after ${after} s`)
    else console.log(`Overlay finished playing after ${after} s`)
  }

  private async save(reason: string): Promise<void> {
    const pcm = Buffer.concat(this.chunks)
    this.chunks = []
    if (pcm.byteLength === 0) return
    this.saved += 1
    const target =
      this.saved === 1 ? this.target : this.target.replace(/(\.wav)?$/i, `-${this.saved}.wav`)
    await writeFile(target, wavFile(pcm, this.sampleRate))
    const seconds = pcm.byteLength / 2 / this.sampleRate
    console.log(`Speech captured (${reason}): ${seconds.toFixed(2)} s in ${target}`)
  }
}

export interface Wav {
  sampleRate: number
  channels: number
  pcm: Uint8Array
}

/** The 16-bit PCM in a WAV file, or `null` for anything else. */
export function readWav(data: Uint8Array): Wav | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const tag = (offset: number): string => String.fromCharCode(...data.subarray(offset, offset + 4))
  if (data.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null
  let format: { encoding: number; channels: number; sampleRate: number; bits: number } | null = null
  let offset = 12
  while (offset + 8 <= data.byteLength) {
    const id = tag(offset)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === 'fmt ' && size >= 16 && body + 16 <= data.byteLength) {
      format = {
        encoding: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true)
      }
    } else if (id === 'data') {
      if (!format || format.encoding !== 1 || format.bits !== 16) return null
      const pcm = data.subarray(body, Math.min(body + size, data.byteLength))
      return { sampleRate: format.sampleRate, channels: format.channels, pcm }
    }
    // Chunks are padded to an even size.
    offset = body + size + (size % 2)
  }
  return null
}

/** Mono 16-bit PCM as a WAV file. */
export function wavFile(pcm: Uint8Array, sampleRate: number): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + pcm.byteLength, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(pcm.byteLength, 40)
  return Buffer.concat([header, pcm])
}
