// Hoot, the project mascot: an owl teacher with round glasses and a graduation cap.

import { brow, SVG_OPEN, type Character2D, type Face, type MouthShape } from './face.mts'

const COLORS = {
  feathers: '#8b5e3c',
  feathersShade: '#6f4a2f',
  belly: '#ecd9b8',
  bellyMarks: '#c9a77c',
  disc: '#f3e6cc',
  discRim: '#d9c09a',
  iris: '#f2b632',
  irisRim: '#3a2a1c',
  ink: '#2b2b2b',
  beak: '#f0a43a',
  beakShade: '#d4862a',
  mouth: '#5a2a1e',
  blush: '#f08a8a',
  lens: 'rgba(255, 255, 255, 0.16)',
  cap: '#2a3142',
  capShade: '#1f2430',
  tassel: '#f2c14e'
}

const EYES = { left: 114, right: 186, y: 180 }
const BEAK = { x: 150, y: 204 }

function body(): string {
  const c = COLORS
  const wing = (x: number, tilt: number): string => `
  <ellipse cx="${x}" cy="318" rx="36" ry="80" fill="${c.feathersShade}" transform="rotate(${tilt} ${x} 318)"/>`
  const marks = [
    [150, 296],
    [128, 318],
    [172, 318],
    [150, 340],
    [116, 346],
    [184, 346],
    [134, 366],
    [166, 366]
  ]
    .map(
      ([x, y]) =>
        `<path d="M${x - 7} ${y} l7 7 l7 -7" stroke="${c.bellyMarks}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
    )
    .join('')
  return `${wing(54, 14)}${wing(246, -14)}
  <ellipse cx="150" cy="318" rx="112" ry="104" fill="${c.feathers}"/>
  <ellipse cx="150" cy="332" rx="70" ry="72" fill="${c.belly}"/>
  ${marks}
  <path d="M66 132 L 48 70 L 106 110 Z" fill="${c.feathersShade}"/>
  <path d="M234 132 L 252 70 L 194 110 Z" fill="${c.feathersShade}"/>
  <ellipse cx="150" cy="176" rx="100" ry="88" fill="${c.feathers}"/>
  <circle cx="${EYES.left}" cy="${EYES.y}" r="50" fill="${c.discRim}"/>
  <circle cx="${EYES.right}" cy="${EYES.y}" r="50" fill="${c.discRim}"/>
  <ellipse cx="150" cy="214" rx="44" ry="32" fill="${c.discRim}"/>
  <circle cx="${EYES.left}" cy="${EYES.y}" r="46" fill="${c.disc}"/>
  <circle cx="${EYES.right}" cy="${EYES.y}" r="46" fill="${c.disc}"/>
  <ellipse cx="150" cy="212" rx="40" ry="28" fill="${c.disc}"/>`
}

function eye(centerX: number, face: Face, blinking: boolean): string {
  const c = COLORS
  const y = EYES.y
  if (blinking) {
    return `<path d="M${centerX - 20} ${y} Q ${centerX} ${y + 10} ${centerX + 20} ${y}" stroke="${c.ink}" stroke-width="5" fill="none" stroke-linecap="round"/>`
  }
  if (face.eyes === 'squint') {
    return `<path d="M${centerX - 20} ${y + 6} Q ${centerX} ${y - 16} ${centerX + 20} ${y + 6}" stroke="${c.ink}" stroke-width="6" fill="none" stroke-linecap="round"/>`
  }
  const wide = face.eyes === 'wide'
  const iris = wide ? 27 : 24
  const pupil = wide ? 8 : 12
  const open = `<circle cx="${centerX}" cy="${y}" r="${iris}" fill="${c.iris}" stroke="${c.irisRim}" stroke-width="3"/>
  <circle cx="${centerX}" cy="${y}" r="${pupil}" fill="${c.ink}"/>
  <circle cx="${centerX + 7}" cy="${y - 8}" r="5" fill="#ffffff"/>
  <circle cx="${centerX - 6}" cy="${y + 7}" r="2.5" fill="#ffffff"/>`
  if (face.eyes !== 'soft') return open
  // Relaxed: the upper lid comes down over half of the eye.
  return `${open}
  <path d="M${centerX - 26} ${y - 1} A 26 26 0 0 1 ${centerX + 26} ${y - 1} Z" fill="${c.disc}"/>
  <path d="M${centerX - 25} ${y - 1} L ${centerX + 25} ${y - 1}" stroke="${c.ink}" stroke-width="4" stroke-linecap="round"/>`
}

function glasses(): string {
  const c = COLORS
  const ring = (x: number): string =>
    `<circle cx="${x}" cy="${EYES.y}" r="33" fill="${c.lens}" stroke="${c.ink}" stroke-width="5"/>`
  return `
  ${ring(EYES.left)}
  ${ring(EYES.right)}
  <path d="M146 176 Q 150 170 154 176" stroke="${c.ink}" stroke-width="5" fill="none"/>
  <path d="M81 174 L 58 166" stroke="${c.ink}" stroke-width="5" stroke-linecap="round"/>
  <path d="M219 174 L 242 166" stroke="${c.ink}" stroke-width="5" stroke-linecap="round"/>`
}

/** How far the beak opens, in pixels, for each mouth shape. */
const BEAK_OPEN: Record<MouthShape, { idle: number; talking: number }> = {
  smile: { idle: 0, talking: 10 },
  grin: { idle: 0, talking: 14 },
  frown: { idle: 0, talking: 8 },
  flat: { idle: 0, talking: 8 },
  o: { idle: 6, talking: 14 }
}

function beak(face: Face, talking: boolean): string {
  const c = COLORS
  const { x, y } = BEAK
  const open = BEAK_OPEN[face.mouth][talking ? 'talking' : 'idle']
  const upper = `<path d="M${x - 14} ${y} Q ${x} ${y - 8} ${x + 14} ${y} L ${x} ${y + 32} Z" fill="${c.beak}"/>
  <path d="M${x} ${y - 4} L ${x + 14} ${y} L ${x} ${y + 32} Z" fill="${c.beakShade}"/>`
  if (open === 0) return upper
  return `<path d="M${x - 12} ${y + 6} L ${x + 12} ${y + 6} L ${x} ${y + 30 + open} Z" fill="${c.mouth}"/>
  <path d="M${x - 10} ${y + 10 + open} L ${x + 10} ${y + 10 + open} L ${x} ${y + 34 + open} Z" fill="${c.beakShade}"/>
  ${upper}`
}

function blush(face: Face): string {
  if (!face.blush) return ''
  return `
  <ellipse cx="98" cy="224" rx="13" ry="7" fill="${COLORS.blush}" opacity="0.6"/>
  <ellipse cx="202" cy="224" rx="13" ry="7" fill="${COLORS.blush}" opacity="0.6"/>`
}

function cap(): string {
  const c = COLORS
  const fringe = [226, 230, 234]
    .map(
      (x) =>
        `<path d="M${x} 154 L ${x} 164" stroke="${c.tassel}" stroke-width="3" stroke-linecap="round"/>`
    )
    .join('')
  return `
  <path d="M96 108 Q 150 84 204 108 L 200 124 Q 150 104 100 124 Z" fill="${c.capShade}"/>
  <path d="M150 58 L 240 84 L 150 110 L 60 84 Z" fill="${c.cap}"/>
  <path d="M60 84 L 150 110 L 240 84 L 240 89 L 150 115 L 60 89 Z" fill="${c.capShade}"/>
  <path d="M150 84 L 226 94 L 230 140" stroke="${c.tassel}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="150" cy="84" r="5" fill="${c.tassel}"/>
  <rect x="223" y="136" width="14" height="20" rx="5" fill="${c.tassel}"/>${fringe}`
}

function drawHoot(face: Face, talking: boolean, blinking: boolean): string {
  const tuft = { y: 137, half: 22, width: 8, color: COLORS.feathersShade }
  return `${SVG_OPEN}${body()}
  ${brow(EYES.left, true, face, tuft)}
  ${brow(EYES.right, false, face, tuft)}
  ${eye(EYES.left, face, blinking)}
  ${eye(EYES.right, face, blinking)}${glasses()}
  ${beak(face, talking)}${blush(face)}${cap()}
</svg>
`
}

export const HOOT: Character2D = {
  folder: 'hoot',
  name: 'Hoot',
  draw: (face, { talking, blinking }) => drawHoot(face, talking, blinking)
}
