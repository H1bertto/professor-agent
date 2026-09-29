import { describe, expect, it } from 'vitest'

import { parsePngTuberManifest, PNGTUBER_FORMAT } from './manifest'

const BASE = {
  format: PNGTUBER_FORMAT,
  version: 1,
  name: 'Chalk',
  emotions: {
    neutral: { idle: 'neutral.png', talking: 'neutral-talking.png', blinking: 'neutral-blink.png' },
    happy: { idle: 'faces/happy.webp' }
  }
}

describe('parsePngTuberManifest', () => {
  it('reads the name and the images of each emotion', () => {
    const manifest = parsePngTuberManifest(BASE)
    expect(manifest.name).toBe('Chalk')
    expect(manifest.emotions.neutral).toEqual(BASE.emotions.neutral)
  })

  it('uses the idle image when an emotion has no talking or blinking image', () => {
    const { happy } = parsePngTuberManifest(BASE).emotions
    expect(happy).toEqual({
      idle: 'faces/happy.webp',
      talking: 'faces/happy.webp',
      blinking: 'faces/happy.webp'
    })
  })

  it('uses the neutral images for emotions that are missing', () => {
    expect(parsePngTuberManifest(BASE).emotions.surprised).toEqual(BASE.emotions.neutral)
  })

  it('gives a default name', () => {
    expect(parsePngTuberManifest({ ...BASE, name: '  ' }).name).toBe('PNGTuber')
  })

  it('requires the format, the version, and a neutral idle image', () => {
    expect(() => parsePngTuberManifest({ ...BASE, format: 'other' })).toThrow(/format/)
    expect(() => parsePngTuberManifest({ ...BASE, version: 2 })).toThrow(/version/)
    expect(() =>
      parsePngTuberManifest({ ...BASE, emotions: { happy: { idle: 'a.png' } } })
    ).toThrow(/neutral/)
  })

  it('refuses paths that leave the avatar folder or are not images', () => {
    const invalid = [
      '../secret.png',
      '/etc/avatar.png',
      'C:\\avatar.png',
      'dir\\a.png',
      'run.exe',
      42
    ]
    for (const idle of invalid) {
      expect(() => parsePngTuberManifest({ ...BASE, emotions: { neutral: { idle } } })).toThrow(
        /invalid image path/
      )
    }
  })
})
