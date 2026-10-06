// What the settings form holds, and how it turns into the requests the main process checks.

import type {
  ProviderForm,
  SettingsForm,
  SettingsView,
  TalkSettings,
  VoiceStatusView
} from '../../shared/api'
import type { NativeVoice, TeacherVoice, VoiceConfig } from '../../shared/core-protocol'
import type { KeyPress } from '../../shared/hotkeys'
import {
  findPreset,
  PROVIDER_PRESETS,
  providerBaseUrl,
  type ProviderPreset,
  type ProviderPresetId
} from '../../shared/providers'

export interface FormState {
  preset: ProviderPresetId
  /** Only used by the `custom` preset. */
  baseUrl: string
  model: string
  /** Empty keeps the saved key, when it still applies. */
  apiKey: string
  name: string
  instructions: string
  voice: VoiceConfig
  talk: TalkSettings
}

export const TEACHER_VOICE_NAMES: Record<TeacherVoice, string> = {
  dora: 'Dora (female)',
  alex: 'Alex (male)'
}

export const NATIVE_VOICE_NAMES: Record<NativeVoice, string> = {
  heart: 'Heart (female)',
  bella: 'Bella (female)',
  michael: 'Michael (male)',
  fenrir: 'Fenrir (male)',
  puck: 'Puck (male)',
  adam: 'Adam (male)'
}

export function presetById(id: ProviderPresetId): ProviderPreset {
  return findPreset(id) ?? PROVIDER_PRESETS[0]
}

export function initialForm(view: SettingsView): FormState {
  const preset = view.provider?.preset ?? PROVIDER_PRESETS[0].id
  return {
    preset,
    baseUrl: view.provider?.baseUrl ?? '',
    model: view.provider?.model ?? presetById(preset).defaultModel,
    apiKey: '',
    name: view.persona.name,
    instructions: view.persona.instructions,
    voice: { ...view.voice },
    talk: { ...view.talk }
  }
}

/** Choosing the saved provider again brings back its model and address. */
export function withPreset(
  form: FormState,
  preset: ProviderPresetId,
  view: SettingsView
): FormState {
  const saved = view.provider?.preset === preset ? view.provider : null
  return {
    ...form,
    preset,
    baseUrl: saved?.baseUrl ?? '',
    model: saved?.model ?? presetById(preset).defaultModel,
    apiKey: ''
  }
}

export function toProviderForm(form: FormState): ProviderForm {
  return {
    preset: form.preset,
    baseUrl: form.preset === 'custom' ? form.baseUrl.trim() : null,
    model: form.model.trim(),
    apiKey: form.apiKey.trim() || null
  }
}

export function toSettingsForm(form: FormState): SettingsForm {
  return {
    provider: toProviderForm(form),
    persona: { name: form.name, instructions: form.instructions },
    voice: form.voice,
    talk: form.talk
  }
}

/**
 * Whether an empty key field keeps the saved key. The main process applies the same rule: the
 * saved key is used only for the same kind of provider at the same address.
 */
export function savedKeyApplies(form: FormState, view: SettingsView): boolean {
  const saved = view.provider
  if (!saved?.keyHint) return false
  const savedPreset = presetById(saved.preset)
  const formPreset = presetById(form.preset)
  return (
    savedPreset.kind === formPreset.kind &&
    providerBaseUrl(savedPreset, saved.baseUrl) === providerBaseUrl(formPreset, form.baseUrl.trim())
  )
}

/** A hint when the tested key cannot use the chosen model. */
export function modelWarning(model: string, models: readonly string[]): string | null {
  const chosen = model.trim()
  if (!chosen || models.length === 0 || models.includes(chosen)) return null
  return 'This key does not list this model. Pick one from the list, or check the name.'
}

/** The line under the voice settings, or `null` while voice is not chosen. */
export function voiceStatusLine(
  status: VoiceStatusView,
  { coreOnline, saved, chosen }: { coreOnline: boolean; saved: boolean; chosen: boolean }
): { text: string; kind: 'ok' | 'info' | 'error' } | null {
  if (!chosen) return null
  if (!saved) return { text: 'Save to turn voice on.', kind: 'info' }
  if (!coreOnline) return { text: 'Voice starts when the core is running.', kind: 'info' }
  switch (status.state) {
    case 'off':
      return { text: 'Starting voice...', kind: 'info' }
    case 'downloading': {
      const done = status.progress === null ? '' : ` (${Math.round(status.progress * 100)}%)`
      return { text: `Downloading the speech models${done}...`, kind: 'info' }
    }
    case 'loading':
      return { text: 'Loading the speech models...', kind: 'info' }
    case 'ready':
      return { text: 'Voice is ready.', kind: 'ok' }
    default:
      return { text: status.message ?? 'Voice is not available on this computer.', kind: 'error' }
  }
}

/** How a recorded shortcut looks on the student's keyboard, such as Ctrl + '. */
export function hotkeyLabel(press: KeyPress & { key: string }): string {
  const key =
    press.key === ' ' ? 'Space' : press.key.length === 1 ? press.key.toUpperCase() : press.key
  return [
    press.ctrlKey && 'Ctrl',
    press.altKey && 'Alt',
    press.shiftKey && 'Shift',
    press.metaKey && 'Win',
    key
  ]
    .filter(Boolean)
    .join(' + ')
}
