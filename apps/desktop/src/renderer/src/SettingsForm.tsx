import { useState } from 'react'
import type {
  ProviderTestResult,
  SettingsForm as SettingsRequest,
  SettingsView
} from '../../shared/api'
import { LIMITS, PROVIDER_PRESETS, type ProviderPresetId } from '../../shared/providers'
import {
  initialForm,
  modelWarning,
  presetById,
  savedKeyApplies,
  toProviderForm,
  toSettingsForm,
  withPreset,
  type FormState
} from './settings-form'

type TestState =
  { status: 'idle' } | { status: 'testing' } | ({ status: 'done' } & ProviderTestResult)

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; message: string }
  | { status: 'error'; message: string }

interface SettingsFormProps {
  view: SettingsView
  onSaved(view: SettingsView): void
}

export function SettingsForm({ view, onSaved }: SettingsFormProps): React.JSX.Element {
  const [form, setForm] = useState<FormState>(() => initialForm(view))
  const [models, setModels] = useState<string[]>([])
  const [test, setTest] = useState<TestState>({ status: 'idle' })
  const [save, setSave] = useState<SaveState>({ status: 'idle' })

  const preset = presetById(form.preset)
  const keepsSavedKey = savedKeyApplies(form, view)
  const warning = modelWarning(form.model, models)

  const change = (changes: Partial<FormState>): void => {
    setForm((current) => ({ ...current, ...changes }))
    setSave({ status: 'idle' })
  }

  const choosePreset = (id: ProviderPresetId): void => {
    setForm((current) => withPreset(current, id, view))
    setModels([])
    setTest({ status: 'idle' })
    setSave({ status: 'idle' })
  }

  const testConnection = async (): Promise<void> => {
    setTest({ status: 'testing' })
    const result = await window.professor.settings.testProvider(toProviderForm(form))
    setTest({ status: 'done', ...result })
    if (!result.ok) return
    setModels(result.models)
    // Without a model yet, the first one the key can use is a good start.
    setForm((current) =>
      current.model.trim() || result.models.length === 0
        ? current
        : { ...current, model: result.models[0] }
    )
  }

  const store = async (request: SettingsRequest, done: string): Promise<void> => {
    setSave({ status: 'saving' })
    const result = await window.professor.settings.save(request)
    if (!result.ok) {
      setSave({ status: 'error', message: result.message })
      return
    }
    setForm((current) => ({ ...current, apiKey: '' }))
    setSave({ status: 'saved', message: done })
    onSaved(result.settings)
  }

  const submit = (event: React.FormEvent): void => {
    event.preventDefault()
    void store(toSettingsForm(form), 'Saved.')
  }

  const removeProvider = (): void => {
    const saved = view.provider && presetById(view.provider.preset)
    if (!saved || !window.confirm(`Remove ${saved.label} and its API key from this computer?`)) {
      return
    }
    void store(
      { provider: null, persona: { name: form.name, instructions: form.instructions } },
      'The provider and its key were removed.'
    )
  }

  return (
    <form className="settings" onSubmit={submit}>
      <section>
        <h2>AI provider</h2>

        <label className="field">
          <span>Provider</span>
          <select
            value={form.preset}
            onChange={(event) => choosePreset(event.target.value as ProviderPresetId)}
          >
            {PROVIDER_PRESETS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {form.preset === 'custom' && (
          <label className="field">
            <span>API address</span>
            <input
              type="url"
              value={form.baseUrl}
              maxLength={LIMITS.baseUrl}
              placeholder="https://example.com/v1"
              spellCheck={false}
              onChange={(event) => change({ baseUrl: event.target.value })}
            />
            <small>
              Any OpenAI-compatible API. Use https, or http://localhost for a server on this
              computer.
            </small>
          </label>
        )}

        <label className="field">
          <span>API key</span>
          <input
            type="password"
            value={form.apiKey}
            maxLength={LIMITS.apiKey}
            autoComplete="off"
            spellCheck={false}
            placeholder={
              keepsSavedKey
                ? `Saved key ${view.provider?.keyHint}. Leave empty to keep it.`
                : 'Paste your API key'
            }
            onChange={(event) => change({ apiKey: event.target.value })}
          />
          <small>
            {preset.keyUrl && (
              <>
                <a href={preset.keyUrl} target="_blank" rel="noreferrer">
                  Get a key from {preset.label}
                </a>
                .{' '}
              </>
            )}
            Your system encrypts the key. It stays on this computer and goes only to the provider
            you chose.
          </small>
        </label>
        {!view.keyStorageAvailable && (
          <p className="notice notice-error">
            This system cannot encrypt API keys, so Professor Agent cannot save them.
          </p>
        )}

        <label className="field">
          <span>Model</span>
          <input
            list="models"
            value={form.model}
            maxLength={LIMITS.model}
            spellCheck={false}
            placeholder="Test the connection to list the models"
            onChange={(event) => change({ model: event.target.value })}
          />
          <datalist id="models">
            {models.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
          {warning && <small className="warning">{warning}</small>}
        </label>

        <div className="row">
          <button type="button" onClick={testConnection} disabled={test.status === 'testing'}>
            {test.status === 'testing' ? 'Testing...' : 'Test connection'}
          </button>
          {test.status === 'done' && (
            <p className={test.ok ? 'notice notice-ok' : 'notice notice-error'} role="status">
              {test.ok
                ? `Connected. ${test.models.length} models available.`
                : (test.message ?? 'The test failed.')}
            </p>
          )}
        </div>
      </section>

      <section>
        <h2>Teacher</h2>
        <label className="field">
          <span>Name</span>
          <input
            value={form.name}
            maxLength={LIMITS.personaName}
            onChange={(event) => change({ name: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Extra instructions</span>
          <textarea
            rows={4}
            value={form.instructions}
            maxLength={LIMITS.instructions}
            placeholder="For example: I have a job interview in English next month. Correct my grammar."
            onChange={(event) => change({ instructions: event.target.value })}
          />
        </label>
      </section>

      <div className="row actions">
        <button type="submit" className="primary" disabled={save.status === 'saving'}>
          Save
        </button>
        {view.provider && (
          <button type="button" className="danger" onClick={removeProvider}>
            Remove provider
          </button>
        )}
        {(save.status === 'saved' || save.status === 'error') && (
          <p
            className={save.status === 'saved' ? 'notice notice-ok' : 'notice notice-error'}
            role="status"
          >
            {save.message}
          </p>
        )}
      </div>
    </form>
  )
}
