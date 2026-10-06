import { useEffect, useState } from 'react'
import type {
  ProviderTestResult,
  SettingsForm as SettingsRequest,
  SettingsView,
  VoiceStatusView
} from '../../shared/api'
import {
  NATIVE_VOICES,
  TEACHER_VOICES,
  type NativeVoice,
  type TeacherVoice,
  type VoiceConfig
} from '../../shared/core-protocol'
import { acceleratorFor } from '../../shared/hotkeys'
import { LIMITS, PROVIDER_PRESETS, type ProviderPresetId } from '../../shared/providers'
import {
  hotkeyLabel,
  initialForm,
  modelWarning,
  NATIVE_VOICE_NAMES,
  TEACHER_VOICE_NAMES,
  presetById,
  savedKeyApplies,
  toProviderForm,
  toSettingsForm,
  voiceStatusLine,
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
  voiceStatus: VoiceStatusView
  coreOnline: boolean
  onSaved(view: SettingsView): void
}

export function SettingsForm({
  view,
  voiceStatus,
  coreOnline,
  onSaved
}: SettingsFormProps): React.JSX.Element {
  const [form, setForm] = useState<FormState>(() => initialForm(view))
  const [models, setModels] = useState<string[]>([])
  const [test, setTest] = useState<TestState>({ status: 'idle' })
  const [save, setSave] = useState<SaveState>({ status: 'idle' })

  const preset = presetById(form.preset)
  const keepsSavedKey = savedKeyApplies(form, view)
  const warning = modelWarning(form.model, models)
  const voiceLine = voiceStatusLine(voiceStatus, {
    coreOnline,
    saved: view.voice.enabled,
    chosen: form.voice.enabled
  })
  const downloading = voiceLine !== null && voiceStatus.state === 'downloading'

  const change = (changes: Partial<FormState>): void => {
    setForm((current) => ({ ...current, ...changes }))
    setSave({ status: 'idle' })
  }

  const changeVoice = (changes: Partial<VoiceConfig>): void => {
    setForm((current) => ({ ...current, voice: { ...current.voice, ...changes } }))
    setSave({ status: 'idle' })
  }

  const changeTalk = (changes: Partial<FormState['talk']>): void => {
    setForm((current) => ({ ...current, talk: { ...current.talk, ...changes } }))
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
      {
        provider: null,
        persona: { name: form.name, instructions: form.instructions },
        voice: form.voice,
        talk: form.talk
      },
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

      <section>
        <h2>Voice</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={form.voice.enabled}
            onChange={(event) => changeVoice({ enabled: event.target.checked })}
          />
          <span>Talk with the teacher</span>
        </label>
        <p className="hint">
          Press Ctrl+Shift with the key below Esc to ask out loud, and press it again to stop.
          Speech runs on this computer, and only the text of your question goes to the AI provider.
          The first time, voice downloads about 2 GB of speech models.
        </p>

        {form.voice.enabled && (
          <>
            <label className="check">
              <input
                type="checkbox"
                checked={form.voice.speakAnswers}
                onChange={(event) => changeVoice({ speakAnswers: event.target.checked })}
              />
              <span>Speak the answers</span>
            </label>
            <label className="field">
              <span>Language you speak</span>
              <select
                value={form.voice.spokenLanguage}
                onChange={(event) =>
                  changeVoice({
                    spokenLanguage: event.target.value as VoiceConfig['spokenLanguage']
                  })
                }
              >
                <option value="auto">Portuguese or English, detected</option>
                <option value="pt">Portuguese</option>
                <option value="en">English</option>
              </select>
            </label>
            <label className="field">
              <span>Teacher&apos;s voice</span>
              <select
                value={form.voice.teacherVoice}
                disabled={!form.voice.speakAnswers}
                onChange={(event) =>
                  changeVoice({ teacherVoice: event.target.value as TeacherVoice })
                }
              >
                {TEACHER_VOICES.map((voice) => (
                  <option key={voice} value={voice}>
                    {TEACHER_VOICE_NAMES[voice]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>English words in the answers</span>
              <select
                value={form.voice.englishVoice}
                disabled={!form.voice.speakAnswers}
                onChange={(event) =>
                  changeVoice({ englishVoice: event.target.value as VoiceConfig['englishVoice'] })
                }
              >
                <option value="teacher">In the teacher&apos;s voice</option>
                <option value="native">In a native English voice</option>
              </select>
              <small>
                The native voice switches to an American speaker for English phrases and sentences.
                Single English words stay in the teacher&apos;s voice, so the Portuguese around them
                keeps its pace.
              </small>
            </label>
            {form.voice.englishVoice === 'native' && (
              <label className="field">
                <span>Native English voice</span>
                <select
                  value={form.voice.nativeVoice}
                  disabled={!form.voice.speakAnswers}
                  onChange={(event) =>
                    changeVoice({ nativeVoice: event.target.value as NativeVoice })
                  }
                >
                  {NATIVE_VOICES.map((voice) => (
                    <option key={voice} value={voice}>
                      {NATIVE_VOICE_NAMES[voice]}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}

        {voiceLine && (
          <p className={`notice notice-${voiceLine.kind}`} role="status">
            {voiceLine.text}
          </p>
        )}
        {downloading && (
          <progress
            className="download"
            value={voiceStatus.progress ?? undefined}
            max={1}
            aria-label="Speech model download"
          />
        )}
      </section>

      {form.voice.enabled && (
        <section>
          <h2>How you talk</h2>
          <label className="check">
            <input
              type="radio"
              name="talk-mode"
              checked={form.talk.mode === 'hotkey'}
              onChange={() => changeTalk({ mode: 'hotkey' })}
            />
            <span>Press the hotkey for each question</span>
          </label>
          <label className="check">
            <input
              type="radio"
              name="talk-mode"
              checked={form.talk.mode === 'conversation'}
              onChange={() => changeTalk({ mode: 'conversation' })}
            />
            <span>Conversation: the microphone stays on</span>
          </label>
          <p className="hint">
            {form.talk.mode === 'conversation'
              ? 'Just talk, and talk over the teacher to interrupt. Use headphones, so the teacher does not hear its own voice. The hotkey pauses and resumes the listening.'
              : 'Press the hotkey, ask out loud, and stop talking or press it again.'}
          </p>

          <div className="field">
            <span>Hotkey</span>
            <HotkeyField
              label={form.talk.hotkeyLabel}
              onChange={(hotkey, label) => changeTalk({ hotkey, hotkeyLabel: label })}
            />
          </div>

          {form.talk.mode === 'conversation' && (
            <label className="field">
              <span>Pause listening after this many minutes without speech</span>
              <input
                type="number"
                min={0}
                max={60}
                value={form.talk.autoPauseMinutes}
                onChange={(event) =>
                  changeTalk({
                    autoPauseMinutes: Math.max(
                      0,
                      Math.min(60, Math.round(Number(event.target.value) || 0))
                    )
                  })
                }
              />
              <small>0 never pauses.</small>
            </label>
          )}
        </section>
      )}

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

interface HotkeyFieldProps {
  label: string
  onChange(hotkey: string, label: string): void
}

/** Shows the hotkey, and records a new one from the next keys the student presses. */
function HotkeyField({ label, onChange }: HotkeyFieldProps): React.JSX.Element {
  const [recording, setRecording] = useState(false)
  const [hint, setHint] = useState<string | null>(null)

  useEffect(() => {
    if (!recording) return
    const record = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setRecording(false)
        setHint(null)
        return
      }
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return
      const accelerator = acceleratorFor(event)
      if (!accelerator) {
        setHint('Hold Ctrl, Alt, or the Windows key with another key, or use a function key.')
        return
      }
      onChange(accelerator, hotkeyLabel(event))
      setRecording(false)
      setHint(null)
    }
    window.addEventListener('keydown', record, true)
    return () => window.removeEventListener('keydown', record, true)
  }, [recording, onChange])

  return (
    <>
      <div className="row">
        <kbd className="hotkey">{recording ? 'Press the new shortcut...' : label}</kbd>
        <button type="button" onClick={() => setRecording((now) => !now)}>
          {recording ? 'Cancel' : 'Change'}
        </button>
      </div>
      {hint && <small className="warning">{hint}</small>}
      <small>The new shortcut works once you save.</small>
    </>
  )
}
