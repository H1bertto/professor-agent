import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: {}, session: {} }))

import { MAX_AUDIO_FRAME_BYTES } from '../shared/core-protocol'
import { allowPermission, failureMessage, microphoneAudio, speechReport } from './voice-channels'

describe('allowPermission', () => {
  it('lets only the overlay use the microphone', () => {
    const ask = { fromOverlay: true, permission: 'media', mediaTypes: ['audio'] }
    expect(allowPermission(ask)).toBe(true)
    expect(allowPermission({ ...ask, fromOverlay: false })).toBe(false)
  })

  it('never gives the camera, even with the microphone', () => {
    const ask = { fromOverlay: true, permission: 'media' }
    expect(allowPermission({ ...ask, mediaTypes: ['video'] })).toBe(false)
    expect(allowPermission({ ...ask, mediaTypes: ['audio', 'video'] })).toBe(false)
    expect(allowPermission({ ...ask, mediaTypes: [] })).toBe(false)
  })

  it('refuses every other permission', () => {
    for (const permission of [
      'notifications',
      'geolocation',
      'clipboard-read',
      'display-capture'
    ]) {
      expect(allowPermission({ fromOverlay: true, permission, mediaTypes: [] })).toBe(false)
    }
  })
})

describe('overlay messages', () => {
  it('takes microphone audio made of whole samples that fit in one frame', () => {
    const pcm = new Uint8Array(640)
    expect(microphoneAudio(pcm)).toBe(pcm)
    expect(microphoneAudio(new Uint8Array(3))).toBeNull()
    expect(microphoneAudio(new Uint8Array(0))).toBeNull()
    expect(microphoneAudio(new Uint8Array(MAX_AUDIO_FRAME_BYTES))).toBeNull()
    expect(microphoneAudio([1, 2])).toBeNull()
    expect(microphoneAudio('audio')).toBeNull()
  })

  it('reads speech reports and drops anything else', () => {
    expect(speechReport({ type: 'finished' })).toEqual({ type: 'finished' })
    expect(speechReport({ type: 'segment', index: 2, extra: true })).toEqual({
      type: 'segment',
      index: 2
    })
    expect(speechReport({ type: 'segment', index: -1 })).toBeNull()
    expect(speechReport({ type: 'segment', index: 1.5 })).toBeNull()
    expect(speechReport({ type: 'play' })).toBeNull()
    expect(speechReport(null)).toBeNull()
  })

  it('keeps microphone failures short', () => {
    expect(failureMessage('  Access denied.  ')).toBe('Access denied.')
    expect(failureMessage('x'.repeat(1000))).toHaveLength(300)
    expect(failureMessage('   ')).toBeNull()
    expect(failureMessage(42)).toBeNull()
  })
})
