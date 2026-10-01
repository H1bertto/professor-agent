import { ipcMain, session, type BrowserWindow, type IpcMainEvent, type WebContents } from 'electron'
import { IpcChannel, type SpeechReport } from '../shared/api'
import { MAX_AUDIO_FRAME_BYTES } from '../shared/core-protocol'

export interface VoiceChannelHandlers {
  microphoneAudio(pcm: Uint8Array): void
  microphoneFailed(message: string): void
  speechReport(report: SpeechReport): void
}

const MAX_FAILURE_LENGTH = 300

/** Microphone audio and speech reports come from the overlay, and only from it. */
export function registerVoiceChannels(
  overlay: BrowserWindow,
  handlers: VoiceChannelHandlers
): void {
  const fromOverlay = (event: IpcMainEvent): boolean =>
    !overlay.isDestroyed() && event.sender.id === overlay.webContents.id

  ipcMain.on(IpcChannel.overlayMicrophoneAudio, (event, pcm: unknown) => {
    const audio = fromOverlay(event) ? microphoneAudio(pcm) : null
    if (audio) handlers.microphoneAudio(audio)
  })
  ipcMain.on(IpcChannel.overlayMicrophoneFailed, (event, message: unknown) => {
    const text = fromOverlay(event) ? failureMessage(message) : null
    if (text) handlers.microphoneFailed(text)
  })
  ipcMain.on(IpcChannel.overlaySpeechReport, (event, report: unknown) => {
    const parsed = fromOverlay(event) ? speechReport(report) : null
    if (parsed) handlers.speechReport(parsed)
  })
}

/** Audio the core accepts: whole 16-bit samples that fit in one frame with its kind byte. */
export function microphoneAudio(value: unknown): Uint8Array | null {
  if (!(value instanceof Uint8Array)) return null
  const size = value.byteLength
  return size > 0 && size % 2 === 0 && size < MAX_AUDIO_FRAME_BYTES ? value : null
}

export function failureMessage(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text ? text.slice(0, MAX_FAILURE_LENGTH) : null
}

export function speechReport(value: unknown): SpeechReport | null {
  if (typeof value !== 'object' || value === null) return null
  const report = value as Record<string, unknown>
  if (report.type === 'finished') return { type: 'finished' }
  const index = report.index
  if (report.type === 'segment' && typeof index === 'number' && Number.isInteger(index)) {
    return index >= 0 ? { type: 'segment', index } : null
  }
  return null
}

export interface PermissionAsk {
  fromOverlay: boolean
  permission: string
  /** For `media`, what the page wants: `audio`, `video`, or both. */
  mediaTypes: readonly string[]
}

/**
 * The overlay may use the microphone, and that is all. No window gets the camera, and every
 * other permission is refused, since the app needs none.
 */
export function allowPermission({ fromOverlay, permission, mediaTypes }: PermissionAsk): boolean {
  return (
    fromOverlay &&
    permission === 'media' &&
    mediaTypes.length > 0 &&
    mediaTypes.every((type) => type === 'audio')
  )
}

export function guardPermissions(overlay: BrowserWindow): void {
  const isOverlay = (contents: WebContents | null): boolean =>
    contents !== null && !overlay.isDestroyed() && contents.id === overlay.webContents.id

  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const mediaTypes = 'mediaTypes' in details ? (details.mediaTypes ?? []) : []
    callback(allowPermission({ fromOverlay: isOverlay(contents), permission, mediaTypes }))
  })
  session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) =>
    allowPermission({
      fromOverlay: isOverlay(contents),
      permission,
      mediaTypes: details.mediaType ? [details.mediaType] : []
    })
  )
}
