// Fakes shared by the main process tests.

import type { ClientMessage, CoreMessage } from '../shared/core-protocol'
import type { Cipher } from './key-vault'
import type { CoreConnection } from './tutor-settings'

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
export class FakeCoreConnection implements CoreConnection {
  currentStatus: CoreConnection['currentStatus'] = 'online'
  readonly sent: ClientMessage[] = []
  private readonly listeners = new Set<(message: CoreMessage) => void>()
  /** Called for each sent message, to answer it. */
  reply: ((message: ClientMessage) => CoreMessage | null) | null = null

  send(message: ClientMessage): boolean {
    if (this.currentStatus !== 'online') return false
    this.sent.push(message)
    const answer = this.reply?.(message)
    if (answer) queueMicrotask(() => this.emit(answer))
    return true
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
}
