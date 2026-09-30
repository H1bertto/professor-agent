import type { AddressInfo } from 'net'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer, type WebSocket } from 'ws'

import type { CoreConnectionStatus } from '../shared/api'
import { VOICE_OFF, type ClientMessage, type CoreMessage } from '../shared/core-protocol'
import { CoreClient, coreSocketUrl, coreToken } from './core-client'

/** A tiny stand-in for the Python core. */
class FakeCore {
  readonly received: ClientMessage[] = []
  readonly origins: (string | undefined)[] = []
  private readonly server: WebSocketServer
  private sockets: WebSocket[] = []

  constructor() {
    this.server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    this.server.on('connection', (socket, request) => {
      this.sockets.push(socket)
      this.origins.push(request.headers.origin)
      socket.on('message', (data) => {
        const message = JSON.parse(data.toString()) as ClientMessage
        this.received.push(message)
        if (message.type === 'hello') {
          socket.send(JSON.stringify({ type: 'ready', protocol: 2, core: '0.1.0' }))
        }
      })
    })
  }

  get url(): string {
    return socketUrl(this.server)
  }

  listening(): Promise<void> {
    return listening(this.server)
  }

  count(type: ClientMessage['type']): number {
    return this.received.filter((message) => message.type === type).length
  }

  send(message: CoreMessage | string): void {
    for (const socket of this.sockets) {
      socket.send(typeof message === 'string' ? message : JSON.stringify(message))
    }
  }

  dropConnections(): void {
    for (const socket of this.sockets) socket.terminate()
    this.sockets = []
  }

  close(): Promise<void> {
    this.dropConnections()
    return new Promise((resolve) => this.server.close(() => resolve()))
  }
}

function listening(server: WebSocketServer): Promise<void> {
  return server.address()
    ? Promise.resolve()
    : new Promise((resolve) => server.once('listening', resolve))
}

function socketUrl(server: WebSocketServer): string {
  return `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`
}

// Nothing listens on the discard port, so connections there fail at once.
const CLOSED_URL = 'ws://127.0.0.1:9/ws'

async function until(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

const cleanup: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step()
})

async function fakeCore(): Promise<FakeCore> {
  const core = new FakeCore()
  cleanup.push(() => core.close())
  await core.listening()
  return core
}

function client(url: string, token: string | null = null): CoreClient {
  const coreClient = new CoreClient({ url, token, clientName: 'test', retryDelaysMs: [10] })
  cleanup.push(() => coreClient.stop())
  return coreClient
}

const CONFIGURE: ClientMessage = {
  type: 'configure',
  provider: null,
  persona: { name: 'Professor', instructions: '' },
  voice: VOICE_OFF
}

describe('CoreClient', () => {
  it('says hello with the token and goes online after ready', async () => {
    const core = await fakeCore()
    const coreClient = client(core.url, 'secret')
    const statuses: CoreConnectionStatus[] = []
    coreClient.onStatus((status) => statuses.push(status))
    coreClient.start()

    expect(coreClient.coreVersion).toBeNull()
    await until(() => coreClient.currentStatus === 'online')
    expect(coreClient.coreVersion).toBe('0.1.0')
    expect(core.received[0]).toEqual({
      type: 'hello',
      protocol: 2,
      client: 'test',
      token: 'secret'
    })
    expect(statuses).toEqual(['connecting', 'online'])
  })

  it('never sends an Origin header, which the core would refuse', async () => {
    const core = await fakeCore()
    const coreClient = client(core.url)
    coreClient.start()
    await until(() => coreClient.currentStatus === 'online')
    expect(core.origins).toEqual([undefined])
  })

  it('passes valid core messages on and ignores the rest', async () => {
    const core = await fakeCore()
    const coreClient = client(core.url)
    const messages: CoreMessage[] = []
    coreClient.onMessage((message) => messages.push(message))
    coreClient.start()
    await until(() => coreClient.currentStatus === 'online')

    core.send('not json')
    core.send(JSON.stringify({ type: 'shutdown' }))
    core.send({ type: 'response.start', id: 'q1' })

    await until(() => messages.length === 1)
    expect(messages).toEqual([{ type: 'response.start', id: 'q1' }])
  })

  it('does not send before the session is open, but keeps the configuration for later', async () => {
    const core = await fakeCore()
    const coreClient = client(core.url)
    expect(coreClient.send({ type: 'user.text', id: 'q1', text: 'hi' })).toBe(false)
    expect(coreClient.send(CONFIGURE)).toBe(false)

    coreClient.start()
    await until(() => core.count('configure') === 1)
    expect(core.received.map((message) => message.type)).toEqual(['hello', 'configure'])
  })

  it('reconnects and sends the last configuration again', async () => {
    const core = await fakeCore()
    const coreClient = client(core.url)
    coreClient.start()
    await until(() => coreClient.currentStatus === 'online')
    expect(coreClient.send(CONFIGURE)).toBe(true)
    await until(() => core.count('configure') === 1)

    core.dropConnections()
    await until(() => core.count('hello') === 2 && core.count('configure') === 2)
    expect(coreClient.currentStatus).toBe('online')
  })

  it('closes when the core speaks another protocol version', async () => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
    let connections = 0
    server.on('connection', (socket) => {
      connections += 1
      socket.on('message', () =>
        socket.send(JSON.stringify({ type: 'ready', protocol: 3, core: '9' }))
      )
    })
    await listening(server)
    const coreClient = client(socketUrl(server))
    const statuses: CoreConnectionStatus[] = []
    coreClient.onStatus((status) => statuses.push(status))
    coreClient.start()

    await until(() => connections >= 2)
    expect(statuses).not.toContain('online')
  })

  it('keeps retrying while the core is down, and stops when asked', async () => {
    const coreClient = client(CLOSED_URL)
    const statuses: CoreConnectionStatus[] = []
    coreClient.onStatus((status) => statuses.push(status))
    coreClient.start()
    await until(() => statuses.filter((status) => status === 'connecting').length >= 3)

    coreClient.stop()
    const seen = statuses.length
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(statuses.length).toBe(seen)
    expect(coreClient.currentStatus).toBe('offline')
  })
})

describe('core address', () => {
  it('uses the port and token from the environment', () => {
    expect(coreSocketUrl({})).toBe('ws://127.0.0.1:8765/ws')
    expect(coreSocketUrl({ PROFESSOR_CORE_PORT: '9000' })).toBe('ws://127.0.0.1:9000/ws')
    expect(coreSocketUrl({ PROFESSOR_CORE_PORT: '80@evil.example' })).toBe('ws://127.0.0.1:8765/ws')
    expect(coreToken({})).toBeNull()
    expect(coreToken({ PROFESSOR_CORE_TOKEN: '' })).toBeNull()
    expect(coreToken({ PROFESSOR_CORE_TOKEN: 'abc' })).toBe('abc')
  })
})
