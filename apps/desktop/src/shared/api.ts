// Types and channel names shared by the main, preload, and renderer processes.

import type { AvatarConfig, AvatarState, Emotion, LookTarget } from './avatar'
import type { PersonaConfig, Segment } from './core-protocol'
import type { ProviderPresetId } from './providers'

export type CoreConnectionStatus = 'connecting' | 'online' | 'offline'

export interface CoreStatus {
  connection: CoreConnectionStatus
  /** The core version, known once the connection is open. */
  version: string | null
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

export type AnswerStatus = 'waiting' | 'streaming' | 'complete' | 'cancelled' | 'error'

/** One question and the teacher's answer so far. */
export interface Answer {
  id: string
  question: string
  segments: Segment[]
  status: AnswerStatus
  /** Why the answer failed, in words for the student. */
  error: string | null
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
}

/** API that the preload script exposes to the renderer as `window.professor`. */
export interface ProfessorApi {
  settings: SettingsApi
  overlay: OverlayApi
  ask: AskApi
  bubble: BubbleApi
}
