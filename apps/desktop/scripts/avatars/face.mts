// The expressions every built-in 2D avatar draws, shared by all the characters.

export type EyeShape = 'open' | 'wide' | 'squint' | 'soft'
export type MouthShape = 'smile' | 'grin' | 'frown' | 'flat' | 'o'

export interface Face {
  /** Degrees. Positive raises the inner end of the brows. */
  browTilt: number
  browLift: number
  eyes: EyeShape
  blush: boolean
  mouth: MouthShape
}

export const FACES: Record<string, Face> = {
  neutral: { browTilt: 0, browLift: 0, eyes: 'open', blush: false, mouth: 'smile' },
  happy: { browTilt: -6, browLift: 4, eyes: 'squint', blush: true, mouth: 'grin' },
  sad: { browTilt: 18, browLift: 0, eyes: 'open', blush: false, mouth: 'frown' },
  angry: { browTilt: -22, browLift: -4, eyes: 'open', blush: false, mouth: 'flat' },
  surprised: { browTilt: 4, browLift: 10, eyes: 'wide', blush: false, mouth: 'o' },
  relaxed: { browTilt: 4, browLift: 2, eyes: 'soft', blush: true, mouth: 'smile' }
}

export interface DrawState {
  talking: boolean
  blinking: boolean
}

/** A built-in 2D avatar: one 300 by 400 SVG for each face and state. */
export interface Character2D {
  /** The folder under `resources/avatars`. */
  folder: string
  name: string
  draw(face: Face, state: DrawState): string
}

export const SVG_OPEN =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400" width="300" height="400">'

/**
 * A brow as a straight stroke, tilted by the face. The inner end sits next to the nose: the
 * right end of the left brow and the other way round.
 */
export function brow(
  centerX: number,
  isLeft: boolean,
  face: Face,
  style: { y: number; half: number; width: number; color: string }
): string {
  const { half } = style
  const tilt = (face.browTilt * Math.PI) / 180
  const y = style.y - face.browLift
  const innerDy = -Math.sin(tilt) * half
  const [x1, y1, x2, y2] = isLeft
    ? [centerX - half, y - innerDy, centerX + half, y + innerDy]
    : [centerX - half, y + innerDy, centerX + half, y - innerDy]
  return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${style.color}" stroke-width="${style.width}" stroke-linecap="round"/>`
}
