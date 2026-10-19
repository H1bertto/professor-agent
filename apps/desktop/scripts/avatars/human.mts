// The face of the human teachers: brows, eyes, mouth, and blush that follow the expression.
// Each teacher brings its own hair, head, clothes, and accessories as SVG layers.

import {
  brow,
  SVG_OPEN,
  type DrawState,
  type EyeShape,
  type Face,
  type MouthShape
} from './face.mts'

export interface HumanLook {
  eyes: { left: number; right: number; y: number }
  mouth: { x: number; y: number }
  brow: { y: number; half: number; width: number; color: string }
  colors: { ink: string; mouth: string; tongue: string; blush: string }
  /** Where the cheeks blush, left and right. */
  cheeks: [{ x: number; y: number }, { x: number; y: number }]
  /** Draws lashes at the outer corner of each eye in this color. */
  lashes?: string
  /** Behind everything else, such as long hair. */
  back?(): string
  body(): string
  /** Ears, face, hair, nose, and anything the eyes and mouth go over, such as a beard. */
  head(): string
  glasses?(): string
  /** Over the mouth, such as a moustache. */
  front?(): string
}

export function drawHuman(look: HumanLook, face: Face, state: DrawState): string {
  const { talking, blinking } = state
  const { eyes } = look
  return `${SVG_OPEN}${look.back?.() ?? ''}${look.body()}${look.head()}
  ${brow(eyes.left, true, face, look.brow)}
  ${brow(eyes.right, false, face, look.brow)}
  ${eye(look, eyes.left, true, face, blinking)}
  ${eye(look, eyes.right, false, face, blinking)}${look.glasses?.() ?? ''}
  ${mouth(look, face, talking)}${blush(look, face)}${look.front?.() ?? ''}
</svg>
`
}

const EYE_SIZES: Record<EyeShape, { rx: number; ry: number }> = {
  open: { rx: 5, ry: 7 },
  wide: { rx: 6.5, ry: 9 },
  squint: { rx: 5.5, ry: 4.5 },
  soft: { rx: 5, ry: 4 }
}

function eye(
  look: HumanLook,
  centerX: number,
  isLeft: boolean,
  face: Face,
  blinking: boolean
): string {
  const { y } = look.eyes
  const { ink } = look.colors
  const lashes = look.lashes ? lash(look.lashes, centerX, y, isLeft, blinking) : ''
  if (blinking) {
    return `<path d="M${centerX - 10} ${y} Q ${centerX} ${y + 6} ${centerX + 10} ${y}" stroke="${ink}" stroke-width="3.5" fill="none" stroke-linecap="round"/>${lashes}`
  }
  const shape = EYE_SIZES[face.eyes]
  const lid =
    face.eyes === 'soft'
      ? `<path d="M${centerX - 9} ${y - 3} L${centerX + 9} ${y - 3}" stroke="${ink}" stroke-width="2.5" stroke-linecap="round"/>`
      : ''
  return `<ellipse cx="${centerX}" cy="${y}" rx="${shape.rx}" ry="${shape.ry}" fill="${ink}"/>
  <circle cx="${centerX + 1.8}" cy="${y - 2.2}" r="1.6" fill="#ffffff"/>${lid}${lashes}`
}

/** Two short lashes at the outer corner, which is the left side of the left eye. */
function lash(
  color: string,
  centerX: number,
  y: number,
  isLeft: boolean,
  blinking: boolean
): string {
  const side = isLeft ? -1 : 1
  const startX = centerX + side * (blinking ? 10 : 6)
  const startY = blinking ? y : y - 5
  const stroke = `stroke="${color}" stroke-width="2.5" stroke-linecap="round"`
  return `<path d="M${startX} ${startY} l${side * 6} -4" ${stroke}/><path d="M${startX - side * 2} ${startY - 2} l${side * 3} -6" ${stroke}/>`
}

function mouth(look: HumanLook, face: Face, talking: boolean): string {
  const { x, y } = look.mouth
  const color = look.colors.mouth
  const stroke = `stroke="${color}" stroke-width="4" fill="none" stroke-linecap="round"`
  if (talking) {
    const open: Record<MouthShape, string> = {
      smile: `<path d="M${x - 16} ${y - 3} Q ${x} ${y + 22} ${x + 16} ${y - 3} Q ${x} ${y + 2} ${x - 16} ${y - 3} Z" fill="${color}"/>`,
      grin: `<path d="M${x - 22} ${y - 6} Q ${x} ${y + 26} ${x + 22} ${y - 6} Z" fill="${color}"/><path d="M${x - 10} ${y + 8} Q ${x} ${y + 16} ${x + 10} ${y + 8}" fill="${look.colors.tongue}"/>`,
      frown: `<ellipse cx="${x}" cy="${y + 4}" rx="10" ry="8" fill="${color}"/>`,
      flat: `<path d="M${x - 16} ${y - 2} Q ${x} ${y - 6} ${x + 16} ${y - 2} Q ${x} ${y + 16} ${x - 16} ${y - 2} Z" fill="${color}"/>`,
      o: `<ellipse cx="${x}" cy="${y + 2}" rx="11" ry="14" fill="${color}"/>`
    }
    return open[face.mouth]
  }
  const closed: Record<MouthShape, string> = {
    smile: `<path d="M${x - 16} ${y - 2} Q ${x} ${y + 8} ${x + 16} ${y - 2}" ${stroke}/>`,
    grin: `<path d="M${x - 22} ${y - 6} Q ${x} ${y + 18} ${x + 22} ${y - 6}" ${stroke}/>`,
    frown: `<path d="M${x - 14} ${y + 6} Q ${x} ${y - 4} ${x + 14} ${y + 6}" ${stroke}/>`,
    flat: `<path d="M${x - 14} ${y + 2} L ${x + 14} ${y + 2}" ${stroke}/>`,
    o: `<ellipse cx="${x}" cy="${y + 2}" rx="7" ry="9" fill="${color}"/>`
  }
  return closed[face.mouth]
}

function blush(look: HumanLook, face: Face): string {
  if (!face.blush) return ''
  const [left, right] = look.cheeks
  const color = look.colors.blush
  return `
  <ellipse cx="${left.x}" cy="${left.y}" rx="12" ry="6" fill="${color}" opacity="0.55"/>
  <ellipse cx="${right.x}" cy="${right.y}" rx="12" ry="6" fill="${color}" opacity="0.55"/>`
}
