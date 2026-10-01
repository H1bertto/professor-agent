import WebSocket, { type RawData } from 'ws'
import type { CoreConnectionStatus } from '../shared/api'
import {
  AudioKind,
  decodeAudioFrame,
  encodeAudioFrame,
  parseCoreMessage,
  PROTOCOL_VERSION,
  type ClientMessage,
  type CoreMessage
} from '../shared/core-protocol'

export const DEFAULT_CORE_PORT = 8765

export interface CoreClientOptions {
  url: string
  /** The launch token of the core, or `null` when it runs without one. */
  token: string | null
  clientName: string
  /** Waits between reconnection attempts, in milliseconds. The last one repeats. */
  retryDelaysMs?: number[]
}

type ConfigureMessage = Extract<ClientMessage, { type: 'configure' }>

const DEFAULT_RETRY_DELAYS_MS = [500, 1000, 2000, 5000]

/** The core always listens on localhost. Only the port can change. */
export function coreSocketUrl(env: NodeJS.ProcessEnv = process.env): string {
  const port = env.PROFESSOR_CORE_PORT
  const validPort = port && /^\d{1,5}$/.test(port) ? port : String(DEFAULT_CORE_PORT)
  return `ws://127.0.0.1:${validPort}/ws`
}

export function coreToken(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.PROFESSOR_CORE_TOKEN || null
}

/**
 * Keeps one WebSocket open to the core. It says hello, waits for ready, reconnects with growing
 * waits, and sends the last configuration again after every reconnection.
 *
 * It uses the `ws` library because it sends no Origin header, and the core refuses connections
 * that have one (see docs/protocol.md).
 */
export class CoreClient {
  private socket: WebSocket | null = null
  private status: CoreConnectionStatus = 'offline'
  private version: string | null = null
  private attempt = 0
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private stopped = true
  private lastConfigure: ConfigureMessage | null = null
  private readonly messageListeners = new Set<(message: CoreMessage) => void>()
  private readonly audioListeners = new Set<(pcm: Uint8Array) => void>()
  private readonly statusListeners = new Set<(status: CoreConnectionStatus) => void>()

  constructor(private readonly options: CoreClientOptions) {}

  get currentStatus(): CoreConnectionStatus {
    return this.status
  }

  /** The core version from its last `ready`, or `null` before the first connection. */
  get coreVersion(): string | null {
    return this.version
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true
    clearTimeout(this.retryTimer)
    const socket = this.socket
    this.socket = null
    socket?.close()
    this.setStatus('offline')
  }

  /**
   * Sends a message if the session is open, and returns `false` when it is not. A `configure`
   * is remembered either way and sent as soon as the session opens.
   */
  send(message: ClientMessage): boolean {
    if (message.type === 'configure') this.lastConfigure = message
    if (this.status !== 'online' || !this.socket) return false
    this.socket.send(JSON.stringify(message))
    return true
  }

  /** Sends microphone audio, 16-bit mono PCM at 16 kHz. Returns `false` when offline. */
  sendAudio(pcm: Uint8Array): boolean {
    if (this.status !== 'online' || !this.socket) return false
    this.socket.send(encodeAudioFrame(AudioKind.microphone, pcm), { binary: true })
    return true
  }

  onMessage(listener: (message: CoreMessage) => void): () => void {
    this.messageListeners.add(listener)
    return () => this.messageListeners.delete(listener)
  }

  /** Speech from the core, as 16-bit mono PCM at the rate of the last `speech.start`. */
  onAudio(listener: (pcm: Uint8Array) => void): () => void {
    this.audioListeners.add(listener)
    return () => this.audioListeners.delete(listener)
  }

  onStatus(listener: (status: CoreConnectionStatus) => void): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  private connect(): void {
    this.setStatus('connecting')
    const socket = new WebSocket(this.options.url, { handshakeTimeout: 5000 })
    this.socket = socket
    socket.on('open', () => {
      const hello: ClientMessage = {
        type: 'hello',
        protocol: PROTOCOL_VERSION,
        client: this.options.clientName,
        token: this.options.token
      }
      socket.send(JSON.stringify(hello))
    })
    socket.on('message', (data, isBinary) => {
      if (isBinary) this.receiveAudio(socket, data)
      else this.receive(socket, data.toString())
    })
    socket.on('close', () => this.handleClose(socket))
    // A failed connection emits 'error' and then 'close', and 'close' schedules the retry.
    socket.on('error', () => undefined)
  }

  private receiveAudio(socket: WebSocket, data: RawData): void {
    if (this.socket !== socket || this.status !== 'online') return
    const bytes = Array.isArray(data)
      ? Buffer.concat(data)
      : data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : data
    const frame = decodeAudioFrame(bytes)
    // Only speech comes this way. Anything else is dropped.
    if (!frame || frame.kind !== AudioKind.speech) return
    // A copy of just this frame, since ws may share one buffer between messages.
    const pcm = new Uint8Array(frame.pcm)
    for (const listener of this.audioListeners) listener(pcm)
  }

  private receive(socket: WebSocket, raw: string): void {
    if (this.socket !== socket) return
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }
    const message = parseCoreMessage(parsed)
    if (!message) return
    if (message.type === 'ready') {
      if (message.protocol !== PROTOCOL_VERSION) {
        socket.close()
        return
      }
      this.attempt = 0
      this.version = message.core
      this.setStatus('online')
      if (this.lastConfigure) socket.send(JSON.stringify(this.lastConfigure))
      return
    }
    for (const listener of this.messageListeners) listener(message)
  }

  private handleClose(socket: WebSocket): void {
    if (this.socket !== socket) return
    this.socket = null
    this.setStatus('offline')
    if (this.stopped) return
    const delays = this.options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS
    const delay = delays[Math.min(this.attempt, delays.length - 1)]
    this.attempt += 1
    this.retryTimer = setTimeout(() => this.connect(), delay)
  }

  private setStatus(status: CoreConnectionStatus): void {
    if (status === this.status) return
    this.status = status
    for (const listener of this.statusListeners) listener(status)
  }
}
