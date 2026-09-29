// Generates "Chalk", the built-in PNGTuber avatar: a friendly teacher drawn as SVG.
// It writes one image per emotion and mouth/eye state, plus the avatar.json manifest.
// Run it with `npm run generate:chalk` after changing the drawing.

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

type EyeShape = 'open' | 'wide' | 'squint' | 'soft'
type MouthShape = 'smile' | 'grin' | 'frown' | 'flat' | 'o'

interface Face {
  /** Degrees. Positive raises the inner end of the brows. */
  browTilt: number
  browLift: number
  eyes: EyeShape
  blush: boolean
  mouth: MouthShape
}

const OUTPUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'avatars', 'chalk')

const COLORS = {
  skin: '#f3cda8',
  skinShade: '#e0b08a',
  hair: '#4a3426',
  jacket: '#2f4a6d',
  jacketShade: '#243a57',
  shirt: '#f5f1e8',
  ink: '#2b2b2b',
  mouth: '#7a2e2e',
  tongue: '#d9706a',
  blush: '#f19c8f',
  lens: 'rgba(255, 255, 255, 0.18)',
  chalk: '#fdfdf8'
}

const EYES = { left: 122, right: 178, y: 180 }
const MOUTH = { x: 150, y: 234 }

const EMOTIONS: Record<string, Face> = {
  neutral: { browTilt: 0, browLift: 0, eyes: 'open', blush: false, mouth: 'smile' },
  happy: { browTilt: -6, browLift: 4, eyes: 'squint', blush: true, mouth: 'grin' },
  sad: { browTilt: 18, browLift: 0, eyes: 'open', blush: false, mouth: 'frown' },
  angry: { browTilt: -22, browLift: -4, eyes: 'open', blush: false, mouth: 'flat' },
  surprised: { browTilt: 4, browLift: 10, eyes: 'wide', blush: false, mouth: 'o' },
  relaxed: { browTilt: 4, browLift: 2, eyes: 'soft', blush: true, mouth: 'smile' }
}

function body(): string {
  return `
  <path d="M34 400 C 40 322, 92 292, 150 290 C 208 292, 260 322, 266 400 Z" fill="${COLORS.jacket}"/>
  <path d="M118 294 L150 352 L182 294 Z" fill="${COLORS.shirt}"/>
  <path d="M118 294 L150 352 L128 318 L108 300 Z" fill="${COLORS.jacketShade}"/>
  <path d="M182 294 L150 352 L172 318 L192 300 Z" fill="${COLORS.jacketShade}"/>
  <rect x="190" y="336" width="34" height="8" rx="3" fill="${COLORS.jacketShade}"/>
  <rect x="198" y="322" width="7" height="18" rx="2" fill="${COLORS.chalk}" transform="rotate(12 201 331)"/>
  <rect x="133" y="244" width="34" height="54" rx="12" fill="${COLORS.skinShade}"/>`
}

function head(): string {
  return `
  <circle cx="79" cy="192" r="12" fill="${COLORS.skin}"/>
  <circle cx="221" cy="192" r="12" fill="${COLORS.skin}"/>
  <ellipse cx="150" cy="186" rx="72" ry="82" fill="${COLORS.skin}"/>
  <path d="M76 184 C 68 112, 108 86, 150 86 C 200 84, 236 116, 226 186 C 216 152, 198 132, 172 124 C 150 140, 112 144, 92 150 C 83 160, 78 172, 76 184 Z" fill="${COLORS.hair}"/>
  <path d="M150 192 Q 145 207 153 210" stroke="${COLORS.skinShade}" stroke-width="3" fill="none" stroke-linecap="round"/>`
}

function brow(centerX: number, isLeft: boolean, face: Face): string {
  const half = 17
  const tilt = (face.browTilt * Math.PI) / 180
  const y = 146 - face.browLift
  // The inner end sits next to the nose: the right end of the left brow and the other way round.
  const innerDy = -Math.sin(tilt) * half
  const [x1, y1, x2, y2] = isLeft
    ? [centerX - half, y - innerDy, centerX + half, y + innerDy]
    : [centerX - half, y + innerDy, centerX + half, y - innerDy]
  return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${COLORS.hair}" stroke-width="6" stroke-linecap="round"/>`
}

function eye(centerX: number, face: Face, blinking: boolean): string {
  const y = EYES.y
  if (blinking) {
    return `<path d="M${centerX - 10} ${y} Q ${centerX} ${y + 6} ${centerX + 10} ${y}" stroke="${COLORS.ink}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`
  }
  const shapes: Record<EyeShape, { rx: number; ry: number }> = {
    open: { rx: 5, ry: 7 },
    wide: { rx: 6.5, ry: 9 },
    squint: { rx: 5.5, ry: 4.5 },
    soft: { rx: 5, ry: 4 }
  }
  const shape = shapes[face.eyes]
  const lid =
    face.eyes === 'soft'
      ? `<path d="M${centerX - 9} ${y - 3} L${centerX + 9} ${y - 3}" stroke="${COLORS.ink}" stroke-width="2.5" stroke-linecap="round"/>`
      : ''
  return `<ellipse cx="${centerX}" cy="${y}" rx="${shape.rx}" ry="${shape.ry}" fill="${COLORS.ink}"/>
  <circle cx="${centerX + 1.8}" cy="${y - 2.2}" r="1.6" fill="#ffffff"/>${lid}`
}

function glasses(): string {
  return `
  <circle cx="${EYES.left}" cy="${EYES.y}" r="22" fill="${COLORS.lens}" stroke="${COLORS.ink}" stroke-width="4"/>
  <circle cx="${EYES.right}" cy="${EYES.y}" r="22" fill="${COLORS.lens}" stroke="${COLORS.ink}" stroke-width="4"/>
  <path d="M144 178 Q 150 172 156 178" stroke="${COLORS.ink}" stroke-width="4" fill="none"/>
  <path d="M100 176 L 84 172" stroke="${COLORS.ink}" stroke-width="4" stroke-linecap="round"/>
  <path d="M200 176 L 216 172" stroke="${COLORS.ink}" stroke-width="4" stroke-linecap="round"/>`
}

function mouth(face: Face, talking: boolean): string {
  const { x, y } = MOUTH
  const stroke = `stroke="${COLORS.mouth}" stroke-width="4" fill="none" stroke-linecap="round"`
  if (talking) {
    const open: Record<MouthShape, string> = {
      smile: `<path d="M${x - 16} ${y - 3} Q ${x} ${y + 22} ${x + 16} ${y - 3} Q ${x} ${y + 2} ${x - 16} ${y - 3} Z" fill="${COLORS.mouth}"/>`,
      grin: `<path d="M${x - 22} ${y - 6} Q ${x} ${y + 26} ${x + 22} ${y - 6} Z" fill="${COLORS.mouth}"/><path d="M${x - 10} ${y + 8} Q ${x} ${y + 16} ${x + 10} ${y + 8}" fill="${COLORS.tongue}"/>`,
      frown: `<ellipse cx="${x}" cy="${y + 4}" rx="10" ry="8" fill="${COLORS.mouth}"/>`,
      flat: `<path d="M${x - 16} ${y - 2} Q ${x} ${y - 6} ${x + 16} ${y - 2} Q ${x} ${y + 16} ${x - 16} ${y - 2} Z" fill="${COLORS.mouth}"/>`,
      o: `<ellipse cx="${x}" cy="${y + 2}" rx="11" ry="14" fill="${COLORS.mouth}"/>`
    }
    return open[face.mouth]
  }
  const closed: Record<MouthShape, string> = {
    smile: `<path d="M${x - 16} ${y - 2} Q ${x} ${y + 8} ${x + 16} ${y - 2}" ${stroke}/>`,
    grin: `<path d="M${x - 22} ${y - 6} Q ${x} ${y + 18} ${x + 22} ${y - 6}" ${stroke}/>`,
    frown: `<path d="M${x - 14} ${y + 6} Q ${x} ${y - 4} ${x + 14} ${y + 6}" ${stroke}/>`,
    flat: `<path d="M${x - 14} ${y + 2} L ${x + 14} ${y + 2}" ${stroke}/>`,
    o: `<ellipse cx="${x}" cy="${y + 2}" rx="7" ry="9" fill="${COLORS.mouth}"/>`
  }
  return closed[face.mouth]
}

function blush(face: Face): string {
  if (!face.blush) return ''
  return `
  <ellipse cx="104" cy="214" rx="12" ry="6" fill="${COLORS.blush}" opacity="0.55"/>
  <ellipse cx="196" cy="214" rx="12" ry="6" fill="${COLORS.blush}" opacity="0.55"/>`
}

function drawing(face: Face, options: { talking?: boolean; blinking?: boolean } = {}): string {
  const { talking = false, blinking = false } = options
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400" width="300" height="400">${body()}${head()}
  ${brow(EYES.left, true, face)}
  ${brow(EYES.right, false, face)}
  ${eye(EYES.left, face, blinking)}
  ${eye(EYES.right, face, blinking)}${glasses()}
  ${mouth(face, talking)}${blush(face)}
</svg>
`
}

async function main(): Promise<void> {
  await mkdir(OUTPUT, { recursive: true })
  const emotions: Record<string, { idle: string; talking: string; blinking: string }> = {}
  for (const [emotion, face] of Object.entries(EMOTIONS)) {
    const files = {
      idle: `${emotion}.svg`,
      talking: `${emotion}-talking.svg`,
      blinking: `${emotion}-blinking.svg`
    }
    await writeFile(join(OUTPUT, files.idle), drawing(face))
    await writeFile(join(OUTPUT, files.talking), drawing(face, { talking: true }))
    await writeFile(join(OUTPUT, files.blinking), drawing(face, { blinking: true }))
    emotions[emotion] = files
  }
  const manifest = { format: 'professor-agent/pngtuber', version: 1, name: 'Chalk', emotions }
  await writeFile(join(OUTPUT, 'avatar.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Wrote ${Object.keys(emotions).length * 3} images and avatar.json to ${OUTPUT}`)
}

await main()
