import { randomUUID } from 'crypto'
import type {
  CoreConnectionStatus,
  ProviderForm,
  ProviderTestResult,
  SaveResult,
  SettingsView
} from '../shared/api'
import type { ClientMessage, CoreMessage, ProviderConfig } from '../shared/core-protocol'
import { findPreset, providerBaseUrl, type ProviderPreset } from '../shared/providers'
import type { KeyVault } from './key-vault'
import { checkProviderForm, checkSettingsForm, keyHint } from './provider-settings'
import type { StoredProvider } from './settings'
import type { SettingsStore } from './settings-store'

/** The part of CoreClient that the settings need. */
export interface CoreConnection {
  readonly currentStatus: CoreConnectionStatus
  send(message: ClientMessage): boolean
  onMessage(listener: (message: CoreMessage) => void): () => void
}

type ConfigureMessage = Extract<ClientMessage, { type: 'configure' }>

// Listing models needs only the address and the key, but the protocol asks for a model name.
const MODEL_FOR_TESTS = 'connection-test'
const TEST_TIMEOUT_MS = 20_000

export const CORE_OFFLINE_MESSAGE = 'The core is not running. Start it and try again.'

/**
 * Owns the provider settings and the API key. The key is decrypted once, kept in memory, and sent
 * only to the core, which passes it to the provider.
 */
export class TutorSettings {
  private apiKey: string | null

  constructor(
    private readonly store: SettingsStore,
    private readonly vault: KeyVault,
    private readonly core: CoreConnection,
    private readonly testTimeoutMs = TEST_TIMEOUT_MS
  ) {
    const provider = store.get().provider
    this.apiKey = provider ? vault.open(provider.encryptedKey) : null
  }

  view(): SettingsView {
    const { provider, persona } = this.store.get()
    return {
      provider: provider && {
        preset: provider.preset,
        baseUrl: provider.baseUrl,
        model: provider.model,
        keyHint: this.apiKey ? keyHint(this.apiKey) : null
      },
      persona,
      keyStorageAvailable: this.vault.available
    }
  }

  /** The provider stays `null` until a model and a key that can be decrypted are saved. */
  configureMessage(): ConfigureMessage {
    const { provider, persona } = this.store.get()
    const preset = provider && findPreset(provider.preset)
    const ready = provider && preset && this.apiKey && provider.model
    return {
      type: 'configure',
      provider: ready ? providerConfig(preset, provider, this.apiKey as string) : null,
      persona
    }
  }

  save(raw: unknown): SaveResult {
    const form = checkSettingsForm(raw)
    if (!form.ok) return form
    const { provider, persona } = form.value

    let stored: StoredProvider | null = null
    let apiKey: string | null = null
    if (provider) {
      const saved = this.savedKeyFor(provider)
      if (provider.apiKey) {
        if (!this.vault.available) {
          return {
            ok: false,
            message:
              'This computer has no safe place to keep the API key, so it was not saved. On Linux, install and unlock a keyring such as GNOME Keyring.'
          }
        }
        apiKey = provider.apiKey
        stored = { ...withoutKey(provider), encryptedKey: this.vault.seal(apiKey) }
      } else if (saved) {
        apiKey = saved.key
        stored = { ...withoutKey(provider), encryptedKey: saved.encryptedKey }
      } else {
        return { ok: false, message: `Paste the API key for ${presetOf(provider).label}.` }
      }
    }

    this.store.update({ provider: stored, persona })
    this.apiKey = apiKey
    this.core.send(this.configureMessage())
    return { ok: true, settings: this.view() }
  }

  /** Lists the provider's models through the core, without saving anything. */
  testProvider(raw: unknown): Promise<ProviderTestResult> {
    const form = checkProviderForm(raw, { requireModel: false })
    if (!form.ok) return Promise.resolve(failed(form.message))
    const provider = form.value
    const apiKey = provider.apiKey ?? this.savedKeyFor(provider)?.key
    if (!apiKey) {
      return Promise.resolve(failed(`Paste the API key for ${presetOf(provider).label}.`))
    }

    const requestId = randomUUID()
    return new Promise((resolve) => {
      const finish = (result: ProviderTestResult): void => {
        clearTimeout(timer)
        stopListening()
        resolve(result)
      }
      const timer = setTimeout(
        () => finish(failed('The core did not answer in time. Try again.')),
        this.testTimeoutMs
      )
      const stopListening = this.core.onMessage((message) => {
        if (message.type === 'provider.test.result' && message.requestId === requestId) {
          finish({ ok: message.ok, models: message.models, message: message.message })
        }
      })
      const config = providerConfig(
        presetOf(provider),
        { ...provider, model: provider.model || MODEL_FOR_TESTS },
        apiKey
      )
      if (!this.core.send({ type: 'provider.test', requestId, provider: config })) {
        finish(failed(CORE_OFFLINE_MESSAGE))
      }
    })
  }

  /**
   * The saved key, but only for the same kind of provider at the same address. A changed address
   * needs the key again, so the saved key never goes to a server the student did not save it for.
   */
  private savedKeyFor(form: ProviderForm): { key: string; encryptedKey: string } | null {
    const saved = this.store.get().provider
    const savedPreset = saved && findPreset(saved.preset)
    if (!saved || !savedPreset || !this.apiKey) return null
    const formPreset = presetOf(form)
    const sameEndpoint =
      savedPreset.kind === formPreset.kind &&
      providerBaseUrl(savedPreset, saved.baseUrl) === providerBaseUrl(formPreset, form.baseUrl)
    return sameEndpoint ? { key: this.apiKey, encryptedKey: saved.encryptedKey } : null
  }
}

function providerConfig(
  preset: ProviderPreset,
  provider: { baseUrl: string | null; model: string },
  apiKey: string
): ProviderConfig {
  return {
    kind: preset.kind,
    baseUrl: providerBaseUrl(preset, provider.baseUrl),
    model: provider.model,
    apiKey
  }
}

function presetOf(form: ProviderForm): ProviderPreset {
  // checkProviderForm only accepts known presets.
  return findPreset(form.preset) as ProviderPreset
}

function withoutKey(form: ProviderForm): Omit<StoredProvider, 'encryptedKey'> {
  return { preset: form.preset, baseUrl: form.baseUrl, model: form.model }
}

function failed(message: string): ProviderTestResult {
  return { ok: false, models: [], message }
}
