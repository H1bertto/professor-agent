import { mkdtemp, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it } from 'vitest'

import type { ClientMessage } from '../shared/core-protocol'
import { KeyVault } from './key-vault'
import { DEFAULT_VOICE } from './settings'
import { SettingsStore } from './settings-store'
import { FakeCoreConnection, fakeCipher } from './test-helpers'
import { CORE_OFFLINE_MESSAGE, TutorSettings } from './tutor-settings'

const KEY = 'sk-ant-api03-secret-9876'
const PERSONA = { name: 'Professor', instructions: '' }
const ANTHROPIC = { preset: 'anthropic', baseUrl: null, model: 'claude-opus-5', apiKey: KEY }

let file: string
let store: SettingsStore
let core: FakeCoreConnection

beforeEach(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'professor-tutor-settings-'))
  file = join(directory, 'settings.json')
  store = await SettingsStore.load(file)
  core = new FakeCoreConnection()
})

function tutor({ available = true, timeoutMs = 1000 } = {}): TutorSettings {
  return new TutorSettings(store, new KeyVault(fakeCipher({ available })), core, timeoutMs)
}

function lastConfigure(): Extract<ClientMessage, { type: 'configure' }> {
  const configure = core.sent.filter((message) => message.type === 'configure').at(-1)
  if (!configure || configure.type !== 'configure') throw new Error('No configure was sent')
  return configure
}

describe('TutorSettings', () => {
  it('starts without a provider', () => {
    expect(tutor().view()).toEqual({
      provider: null,
      persona: PERSONA,
      voice: DEFAULT_VOICE,
      keyStorageAvailable: true
    })
    expect(tutor().configureMessage()).toEqual({
      type: 'configure',
      provider: null,
      persona: PERSONA,
      voice: DEFAULT_VOICE
    })
  })

  it('saves the key encrypted, shows only a hint, and configures the core', async () => {
    const settings = tutor()
    const result = settings.save({
      provider: ANTHROPIC,
      persona: { name: 'Ana', instructions: '' }
    })

    expect(result).toEqual({
      ok: true,
      settings: {
        provider: {
          preset: 'anthropic',
          baseUrl: null,
          model: 'claude-opus-5',
          keyHint: '...9876'
        },
        persona: { name: 'Ana', instructions: '' },
        voice: DEFAULT_VOICE,
        keyStorageAvailable: true
      }
    })
    expect(lastConfigure()).toEqual({
      type: 'configure',
      provider: { kind: 'anthropic', baseUrl: null, model: 'claude-opus-5', apiKey: KEY },
      persona: { name: 'Ana', instructions: '' },
      voice: DEFAULT_VOICE
    })

    await store.flush()
    const onDisk = await readFile(file, 'utf-8')
    expect(onDisk).not.toContain(KEY)
    expect(JSON.stringify(result)).not.toContain(KEY)
  })

  it('opens the saved key again after a restart', async () => {
    tutor().save({ provider: ANTHROPIC, persona: PERSONA })
    await store.flush()
    store = await SettingsStore.load(file)

    expect(tutor().configureMessage().provider?.apiKey).toBe(KEY)
  })

  it('keeps the saved key when the student changes only the model', () => {
    const settings = tutor()
    settings.save({ provider: ANTHROPIC, persona: PERSONA })
    const result = settings.save({
      provider: { ...ANTHROPIC, model: 'claude-haiku-4-5', apiKey: null },
      persona: PERSONA
    })

    expect(result.ok).toBe(true)
    expect(lastConfigure().provider).toMatchObject({ model: 'claude-haiku-4-5', apiKey: KEY })
  })

  it('asks for the key again when the provider or its address changes', () => {
    const settings = tutor()
    settings.save({
      provider: { ...ANTHROPIC, preset: 'custom', baseUrl: 'http://localhost:1234/v1' },
      persona: PERSONA
    })

    for (const provider of [
      { ...ANTHROPIC, apiKey: null },
      { ...ANTHROPIC, preset: 'openai', apiKey: null },
      { ...ANTHROPIC, preset: 'custom', baseUrl: 'https://attacker.example/v1', apiKey: null }
    ]) {
      const result = settings.save({ provider, persona: PERSONA })
      expect(result.ok, provider.preset).toBe(false)
    }
    expect(lastConfigure().provider?.baseUrl).toBe('http://localhost:1234/v1')
  })

  it('does not save a key the system cannot encrypt', () => {
    const result = tutor({ available: false }).save({ provider: ANTHROPIC, persona: PERSONA })
    expect(result.ok).toBe(false)
    expect(store.get().provider).toBeNull()
    expect(core.sent).toEqual([])
  })

  it('removes the provider and its key', () => {
    const settings = tutor()
    settings.save({ provider: ANTHROPIC, persona: PERSONA })
    expect(settings.save({ provider: null, persona: PERSONA }).ok).toBe(true)

    expect(store.get().provider).toBeNull()
    expect(lastConfigure().provider).toBeNull()
  })

  it('reports invalid forms without changing anything', () => {
    const settings = tutor()
    expect(settings.save({ provider: { ...ANTHROPIC, model: '' }, persona: PERSONA })).toEqual({
      ok: false,
      message: 'Choose a model.'
    })
    expect(core.sent).toEqual([])
  })

  it('saves the voice settings and sends them to the core', () => {
    const settings = tutor()
    const voice = { ...DEFAULT_VOICE, enabled: true, englishVoice: 'native' as const }
    expect(settings.save({ provider: null, persona: PERSONA, voice }).ok).toBe(true)

    expect(settings.view().voice).toEqual(voice)
    expect(lastConfigure().voice).toEqual(voice)

    // A form without voice settings, such as removing the provider, keeps them.
    settings.save({ provider: null, persona: PERSONA })
    expect(lastConfigure().voice).toEqual(voice)
    expect(settings.save({ provider: null, persona: PERSONA, voice: { enabled: 'yes' } })).toEqual({
      ok: false,
      message: 'The voice settings could not be read.'
    })
  })

  it('leaves the provider out when the saved key cannot be opened', async () => {
    tutor().save({ provider: ANTHROPIC, persona: PERSONA })
    await store.flush()
    store = await SettingsStore.load(file)

    const settings = tutor({ available: false })
    expect(settings.view().provider?.keyHint).toBeNull()
    expect(settings.configureMessage().provider).toBeNull()
  })
})

describe('TutorSettings.testProvider', () => {
  it('lists the models through the core without saving', async () => {
    core.reply = (message) =>
      message.type === 'provider.test'
        ? {
            type: 'provider.test.result',
            requestId: message.requestId,
            ok: true,
            models: ['claude-opus-5', 'claude-haiku-4-5'],
            code: null,
            message: null
          }
        : null

    const result = await tutor().testProvider({ ...ANTHROPIC, model: '' })

    expect(result).toEqual({
      ok: true,
      models: ['claude-opus-5', 'claude-haiku-4-5'],
      message: null
    })
    const [sent] = core.sent
    expect(sent).toMatchObject({
      type: 'provider.test',
      provider: { kind: 'anthropic', baseUrl: null, apiKey: KEY }
    })
    expect(store.get().provider).toBeNull()
    expect(core.listenerCount).toBe(0)
  })

  it('passes the provider error on', async () => {
    core.reply = (message) =>
      message.type === 'provider.test'
        ? {
            type: 'provider.test.result',
            requestId: message.requestId,
            ok: false,
            models: [],
            code: 'invalid_key',
            message: 'The provider refused the API key.'
          }
        : null

    expect(await tutor().testProvider(ANTHROPIC)).toEqual({
      ok: false,
      models: [],
      message: 'The provider refused the API key.'
    })
  })

  it('uses the saved key only for the same provider', async () => {
    const settings = tutor()
    settings.save({ provider: ANTHROPIC, persona: PERSONA })
    core.sent.length = 0

    const other = await settings.testProvider({ ...ANTHROPIC, preset: 'openai', apiKey: null })
    expect(other.ok).toBe(false)
    expect(core.sent).toEqual([])
  })

  it('says when the core is offline or silent', async () => {
    core.currentStatus = 'offline'
    expect((await tutor().testProvider(ANTHROPIC)).message).toBe(CORE_OFFLINE_MESSAGE)

    core.currentStatus = 'online'
    const silent = await tutor({ timeoutMs: 20 }).testProvider(ANTHROPIC)
    expect(silent).toMatchObject({ ok: false, models: [] })
    expect(core.listenerCount).toBe(0)
  })
})
