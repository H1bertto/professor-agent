// Types and channel names shared by the main, preload, and renderer processes.

import type { AvatarConfig, AvatarState, Emotion, LookTarget } from './avatar'
import type { PersonaConfig, Segment, VoiceConfig, VoiceState } from './core-protocol'
import type { ProviderPresetId } from './providers'

export type CoreConnectionStatus = 'connecting' | 'online' | 'offline'

export interface CoreStatus {
  connection: CoreConnectionStatus
  /** The core version, known once the connection is open. */
  version: string | null
}

/** Where the speech models are, as the core last reported. */
export interface VoiceStatusView {
  state: VoiceState
  /** The download progress, from 0 to 1, while downloading. */
  progress: number | null
  /** Why voice is unavailable, in words for the student. */
  message: string | null
}

/** Where the mouse cursor is, sent to the overlay while it moves. */
export interface CursorUpdate {
  /** Where the avatar should look to face the cursor. */
  look: LookTarget
  /** Whether the cursor is inside the overlay window. */
  overWindow: boolean
}

/** What the avatar shows. The tutor drives it while it answers, and the tray menu can try it. */
export interface AvatarPose {
  state: AvatarState
  emotion: Emotion
  /** Moves the mouth like speech. The text streaming drives it until phase 3 adds voice. */
  talking: boolean
}

export type AnswerStatus =
  | 'listening'
  | 'waiting'
  | 'streaming'
  | 'complete'
  | 'cancelled'
  | 'error'
  /** Not an answer: a note for the student, such as conversation mode pausing by itself. */
  | 'notice'

/** One question and the teacher's answer so far. */
export interface Answer {
  id: string
  /** Empty while the student is still speaking. */
  question: string
  segments: Segment[]
  status: AnswerStatus
  /** Why the answer failed, in words for the student. */
  error: string | null
  /** `playing` while the answer is heard, which can last after the text is complete. */
  speech: 'none' | 'playing' | 'done'
  /** The parts of the answer as the teacher says them, for subtitles. */
  speechParts: string[]
  /** The part the student hears now, or `null`. */
  speakingIndex: number | null
}

/** What the main process asks the overlay to play. */
export type SpeechCommand =
  | { type: 'start'; sampleRate: number }
  | { type: 'segment'; index: number }
  | { type: 'audio'; pcm: Uint8Array }
  /** No more audio is coming. The overlay reports `finished` once the last of it has played. */
  | { type: 'end' }
  /** Stop at once and drop what is queued, for example when the student interrupts. */
  | { type: 'stop' }
  /** Hold the speech where it is, while the student may be starting to speak. */
  | { type: 'pause' }
  /** Go on from where `pause` held it. */
  | { type: 'resume' }

/** What the overlay tells the main process about the speech it plays. */
export type SpeechReport = { type: 'segment'; index: number } | { type: 'finished' }

/** Conversation mode as the tray and the overlay show it. */
export interface ConversationView {
  /** The student chose conversation mode in the settings. */
  on: boolean
  /** The student, or a long silence, paused the listening. */
  paused: boolean
  /** The microphone is open and the core is listening. */
  listening: boolean
}

/** What the answer bubble shows. */
export interface AnswerView {
  teacherName: string
  answer: Answer
}

export type AskResult = { ok: true } | { ok: false; message: string }

/** The saved provider as the settings window sees it. The API key never leaves the main process. */
export interface ProviderView {
  preset: ProviderPresetId
  /** Only for the `custom` preset. */
  baseUrl: string | null
  model: string
  /** The last characters of the saved key, such as `...a1b2`, or `null` when there is none. */
  keyHint: string | null
}

export interface SettingsView {
  provider: ProviderView | null
  persona: PersonaConfig
  voice: VoiceConfig
  /** Whether the system can encrypt API keys. Without it, keys cannot be saved. */
  keyStorageAvailable: boolean
}

/** A provider as the student filled it in. */
export interface ProviderForm {
  preset: ProviderPresetId
  /** Only for the `custom` preset. The others always use their own address. */
  baseUrl: string | null
  model: string
  /** A new key, or `null` to keep the saved one. */
  apiKey: string | null
}

export interface SettingsForm {
  /** `null` removes the provider and its key. */
  provider: ProviderForm | null
  persona: PersonaConfig
  /** Leave it out to keep the saved voice settings. */
  voice?: VoiceConfig
}

export type SaveResult = { ok: true; settings: SettingsView } | { ok: false; message: string }

export interface ProviderTestResult {
  ok: boolean
  models: string[]
  /** Why the test failed, in words the student can act on. */
  message: string | null
}

export const IpcChannel = {
  coreStatus: 'core:status',
  coreStatusChanged: 'core:status-changed',
  voiceStatus: 'voice:status',
  voiceStatusChanged: 'voice:status-changed',
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  settingsTestProvider: 'settings:test-provider',
  avatarGet: 'avatar:get',
  avatarChanged: 'avatar:changed',
  overlayReady: 'overlay:ready',
  overlayCursor: 'overlay:cursor',
  overlayPose: 'overlay:pose',
  overlaySetInteractive: 'overlay:set-interactive',
  overlayDragStart: 'overlay:drag-start',
  overlayDragEnd: 'overlay:drag-end',
  overlayResize: 'overlay:resize',
  overlayClick: 'overlay:click',
  overlayMicrophone: 'overlay:microphone',
  overlayMicrophoneAudio: 'overlay:microphone-audio',
  overlayMicrophoneFailed: 'overlay:microphone-failed',
  overlaySpeech: 'overlay:speech',
  overlaySpeechReport: 'overlay:speech-report',
  askOpened: 'ask:opened',
  askSubmit: 'ask:submit',
  askClose: 'ask:close',
  bubbleAnswer: 'bubble:answer',
  bubbleResize: 'bubble:resize',
  bubbleCancel: 'bubble:cancel',
  bubbleDismiss: 'bubble:dismiss'
} as const

/** Calls available to the overlay window, which shows the avatar. */
export interface OverlayApi {
  getAvatar(): Promise<AvatarConfig>
  /** The avatar finished loading, so the window can be shown. */
  ready(): void
  /** Each `on...` call returns a function that stops listening. */
  onAvatarChanged(listener: (avatar: AvatarConfig) => void): () => void
  onCursor(listener: (update: CursorUpdate) => void): () => void
  onPose(listener: (pose: AvatarPose) => void): () => void
  /** `true` makes the window catch the mouse. `false` lets clicks pass through to other apps. */
  setInteractive(interactive: boolean): void
  /** The window follows the cursor from `startDrag` until `endDrag`. */
  startDrag(): void
  endDrag(): void
  /** Positive steps grow the avatar and negative steps shrink it. */
  resize(steps: number): void
  /** The student clicked the avatar without dragging it, which opens the question box. */
  click(): void
  /** `true` opens the microphone for a spoken question, and `false` closes it. */
  onMicrophone(listener: (on: boolean) => void): () => void
  /** 16-bit mono PCM at 16 kHz from the microphone. */
  sendMicrophoneAudio(pcm: Uint8Array): void
  /** The microphone could not open, for example because access was denied. */
  microphoneFailed(message: string): void
  onSpeech(listener: (command: SpeechCommand) => void): () => void
  reportSpeech(report: SpeechReport): void
}

/** Calls available to the question box. */
export interface AskApi {
  ask(text: string): Promise<AskResult>
  close(): void
  /** The box opened. It tells which teacher the student is talking to. */
  onOpened(listener: (info: { teacherName: string }) => void): () => void
}

/** Calls available to the answer bubble. */
export interface BubbleApi {
  onAnswer(listener: (view: AnswerView) => void): () => void
  /** Stops the answer that is streaming. */
  cancel(): void
  dismiss(): void
  /** The bubble fits its content, so the window takes only the space it needs. */
  resize(height: number): void
}

/** Calls available to the settings window. */
export interface SettingsApi {
  get(): Promise<SettingsView>
  save(form: SettingsForm): Promise<SaveResult>
  /** Checks the provider without saving it, by listing its models. */
  testProvider(provider: ProviderForm): Promise<ProviderTestResult>
  getCoreStatus(): Promise<CoreStatus>
  onCoreStatus(listener: (status: CoreStatus) => void): () => void
  getVoiceStatus(): Promise<VoiceStatusView>
  onVoiceStatus(listener: (status: VoiceStatusView) => void): () => void
}

/** API that the preload script exposes to the renderer as `window.professor`. */
export interface ProfessorApi {
  settings: SettingsApi
  overlay: OverlayApi
  ask: AskApi
  bubble: BubbleApi
}
