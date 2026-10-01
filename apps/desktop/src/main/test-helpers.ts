// Fakes shared by the main process tests.

import type { CoreConnectionStatus } from '../shared/api'
import type { ClientMessage, CoreMessage } from '../shared/core-protocol'
import type { Cipher } from './key-vault'
import type { TutorCore } from './tutor'

/** Reverses and tags the text, so tests can tell sealed keys from plain ones. */
export function fakeCipher({ available = true } = {}): Cipher {
  return {
    isAvailable: () => available,
    encrypt: (plain) => Buffer.from(`sealed:${[...plain].reverse().join('')}`),
    decrypt: (encrypted) => {
      const text = encrypted.toString()
      if (!text.startsWith('sealed:')) throw new Error('Not sealed by this cipher')
      return [...text.slice('sealed:'.length)].reverse().join('')
    }
  }
}

/** Records what the main process sends to the core, and lets tests answer. */
export class FakeCoreConnection implements TutorCore {
  currentStatus: CoreConnectionStatus = 'online'
  readonly sent: ClientMessage[] = []
  readonly sentAudio: Uint8Array[] = []
  private readonly listeners = new Set<(message: CoreMessage) => void>()
  private readonly statusListeners = new Set<(status: CoreConnectionStatus) => void>()
  private readonly audioListeners = new Set<(pcm: Uint8Array) => void>()
  /** Called for each sent message, to answer it. */
  reply: ((message: ClientMessage) => CoreMessage | null) | null = null

  send(message: ClientMessage): boolean {
    if (this.currentStatus !== 'online') return false
    this.sent.push(message)
    const answer = this.reply?.(message)
    if (answer) queueMicrotask(() => this.emit(answer))
    return true
  }

  sendAudio(pcm: Uint8Array): boolean {
    if (this.currentStatus !== 'online') return false
    this.sentAudio.push(pcm)
    return true
  }

  onAudio(listener: (pcm: Uint8Array) => void): () => void {
    this.audioListeners.add(listener)
    return () => this.audioListeners.delete(listener)
  }

  emitAudio(pcm: Uint8Array): void {
    for (const listener of this.audioListeners) listener(pcm)
  }

  onMessage(listener: (message: CoreMessage) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get listenerCount(): number {
    return this.listeners.size
  }

  emit(message: CoreMessage): void {
    for (const listener of this.listeners) listener(message)
  }

  onStatus(listener: (status: CoreConnectionStatus) => void): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  setStatus(status: CoreConnectionStatus): void {
    this.currentStatus = status
    for (const listener of this.statusListeners) listener(status)
  }
}
