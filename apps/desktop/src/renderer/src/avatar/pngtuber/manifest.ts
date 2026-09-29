import { EMOTIONS, type Emotion } from '../../../../shared/avatar'

export const PNGTUBER_FORMAT = 'professor-agent/pngtuber'

/** Image files for one emotion, relative to avatar.json. */
export interface PngTuberFrames {
  idle: string
  /** Shown while the mouth is open. */
  talking: string
  /** Shown while the eyes are closed. */
  blinking: string
}

export interface PngTuberManifest {
  name: string
  /** Every emotion is filled in. Missing ones reuse the neutral images. */
  emotions: Record<Emotion, PngTuberFrames>
}

/** A relative image path inside the avatar folder. No parent folders, drives, or backslashes. */
const IMAGE_PATH = /^(?![\\/])(?!.*\.\.)(?!.*[\\:])[\w\-. /]+\.(png|jpe?g|webp|gif|svg)$/i

/**
 * Reads an avatar.json file. Missing images fall back to others, but invalid paths or a missing
 * neutral image are errors, so authors find mistakes early.
 */
export function parsePngTuberManifest(raw: unknown): PngTuberManifest {
  if (!isRecord(raw) || raw.format !== PNGTUBER_FORMAT || raw.version !== 1) {
    throw new Error(`avatar.json must have "format": "${PNGTUBER_FORMAT}" and "version": 1.`)
  }
  if (!isRecord(raw.emotions)) throw new Error('avatar.json needs an "emotions" object.')

  const neutralIdle = imagePath(raw.emotions, 'neutral', 'idle')
  if (!neutralIdle) throw new Error('avatar.json needs an idle image for the neutral emotion.')
  const neutral: PngTuberFrames = {
    idle: neutralIdle,
    talking: imagePath(raw.emotions, 'neutral', 'talking') ?? neutralIdle,
    blinking: imagePath(raw.emotions, 'neutral', 'blinking') ?? neutralIdle
  }

  const emotions = {} as Record<Emotion, PngTuberFrames>
  for (const emotion of EMOTIONS) {
    const idle = imagePath(raw.emotions, emotion, 'idle')
    emotions[emotion] = idle
      ? {
          idle,
          talking: imagePath(raw.emotions, emotion, 'talking') ?? idle,
          blinking: imagePath(raw.emotions, emotion, 'blinking') ?? idle
        }
      : neutral
  }

  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 64) : ''
  return { name: name || 'PNGTuber', emotions }
}

function imagePath(
  emotions: Record<string, unknown>,
  emotion: Emotion,
  frame: keyof PngTuberFrames
): string | null {
  const entry = emotions[emotion]
  if (!isRecord(entry) || entry[frame] === undefined) return null
  const value = entry[frame]
  if (typeof value !== 'string' || !IMAGE_PATH.test(value)) {
    throw new Error(`avatar.json has an invalid image path for ${emotion}.${frame}.`)
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
