// The human teachers: Chalk, Lia, and Theo.

import type { Character2D } from './face.mts'
import { drawHuman, type HumanLook } from './human.mts'

const INK = '#2b2b2b'

// Chalk: a friendly teacher with round glasses and a piece of chalk in the pocket.

const CHALK_COLORS = {
  skin: '#f3cda8',
  skinShade: '#e0b08a',
  hair: '#4a3426',
  jacket: '#2f4a6d',
  jacketShade: '#243a57',
  shirt: '#f5f1e8',
  lens: 'rgba(255, 255, 255, 0.18)',
  chalk: '#fdfdf8'
}

const CHALK_LOOK: HumanLook = {
  eyes: { left: 122, right: 178, y: 180 },
  mouth: { x: 150, y: 234 },
  brow: { y: 146, half: 17, width: 6, color: CHALK_COLORS.hair },
  colors: { ink: INK, mouth: '#7a2e2e', tongue: '#d9706a', blush: '#f19c8f' },
  cheeks: [
    { x: 104, y: 214 },
    { x: 196, y: 214 }
  ],
  body: () => {
    const c = CHALK_COLORS
    return `
  <path d="M34 400 C 40 322, 92 292, 150 290 C 208 292, 260 322, 266 400 Z" fill="${c.jacket}"/>
  <path d="M118 294 L150 352 L182 294 Z" fill="${c.shirt}"/>
  <path d="M118 294 L150 352 L128 318 L108 300 Z" fill="${c.jacketShade}"/>
  <path d="M182 294 L150 352 L172 318 L192 300 Z" fill="${c.jacketShade}"/>
  <rect x="190" y="336" width="34" height="8" rx="3" fill="${c.jacketShade}"/>
  <rect x="198" y="322" width="7" height="18" rx="2" fill="${c.chalk}" transform="rotate(12 201 331)"/>
  <rect x="133" y="244" width="34" height="54" rx="12" fill="${c.skinShade}"/>`
  },
  head: () => {
    const c = CHALK_COLORS
    return `
  <circle cx="79" cy="192" r="12" fill="${c.skin}"/>
  <circle cx="221" cy="192" r="12" fill="${c.skin}"/>
  <ellipse cx="150" cy="186" rx="72" ry="82" fill="${c.skin}"/>
  <path d="M76 184 C 68 112, 108 86, 150 86 C 200 84, 236 116, 226 186 C 216 152, 198 132, 172 124 C 150 140, 112 144, 92 150 C 83 160, 78 172, 76 184 Z" fill="${c.hair}"/>
  <path d="M150 192 Q 145 207 153 210" stroke="${c.skinShade}" stroke-width="3" fill="none" stroke-linecap="round"/>`
  },
  glasses: () => `
  <circle cx="122" cy="180" r="22" fill="${CHALK_COLORS.lens}" stroke="${INK}" stroke-width="4"/>
  <circle cx="178" cy="180" r="22" fill="${CHALK_COLORS.lens}" stroke="${INK}" stroke-width="4"/>
  <path d="M144 178 Q 150 172 156 178" stroke="${INK}" stroke-width="4" fill="none"/>
  <path d="M100 176 L 84 172" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
  <path d="M200 176 L 216 172" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`
}

export const CHALK: Character2D = {
  folder: 'chalk',
  name: 'Chalk',
  draw: (face, state) => drawHuman(CHALK_LOOK, face, state)
}

// Lia: a teacher with big curly hair, gold hoops, and a pencil tucked in her curls.

const LIA_COLORS = {
  skin: '#c68863',
  skinShade: '#a86d4b',
  hair: '#2b1b17',
  curl: '#4a3029',
  cardigan: '#d9a441',
  cardiganShade: '#b8862e',
  top: '#2f6f73',
  gold: '#e8b84a',
  pencil: '#f2c230',
  pencilShade: '#d9a520',
  eraser: '#e88a9a',
  wood: '#f1d3a6'
}

/** The curls around Lia's head, as circles on an oval, from her right shoulder to her left. */
function liaCurls(): { x: number; y: number; r: number }[] {
  const curls: { x: number; y: number; r: number }[] = []
  for (let step = 0; step <= 12; step++) {
    const angle = ((-28 + step * 19.6) * Math.PI) / 180
    curls.push({
      x: Math.round(150 + 98 * Math.cos(angle)),
      y: Math.round(184 - 104 * Math.sin(angle)),
      r: step % 2 === 0 ? 30 : 27
    })
  }
  curls.push(
    { x: 60, y: 266, r: 26 },
    { x: 240, y: 266, r: 26 },
    { x: 70, y: 302, r: 22 },
    { x: 230, y: 302, r: 22 }
  )
  return curls
}

const LIA_LOOK: HumanLook = {
  eyes: { left: 123, right: 177, y: 184 },
  mouth: { x: 150, y: 238 },
  brow: { y: 152, half: 15, width: 5, color: LIA_COLORS.hair },
  colors: { ink: INK, mouth: '#8a3138', tongue: '#d9706a', blush: '#e0705f' },
  cheeks: [
    { x: 103, y: 216 },
    { x: 197, y: 216 }
  ],
  lashes: INK,
  back: () => {
    const c = LIA_COLORS
    const curls = liaCurls()
    const pencil = `
  <g transform="rotate(38 232 104)">
    <rect x="200" y="98" width="62" height="12" rx="2" fill="${c.pencil}"/>
    <rect x="200" y="104" width="62" height="6" fill="${c.pencilShade}"/>
    <rect x="262" y="98" width="10" height="12" rx="3" fill="${c.eraser}"/>
    <path d="M200 98 L186 104 L200 110 Z" fill="${c.wood}"/>
    <path d="M190 102 L186 104 L190 106 Z" fill="${INK}"/>
  </g>`
    return `
  <ellipse cx="150" cy="190" rx="100" ry="110" fill="${c.hair}"/>
  ${curls.map(({ x, y, r }) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c.hair}"/>`).join('')}
  ${curls
    .map(
      ({ x, y }) =>
        `<path d="M${x - 9} ${y + 3} q 9 -14 18 0" stroke="${c.curl}" stroke-width="3" fill="none" stroke-linecap="round"/>`
    )
    .join('')}${pencil}`
  },
  body: () => {
    const c = LIA_COLORS
    return `
  <path d="M38 400 C 44 326, 94 296, 150 294 C 206 296, 256 326, 262 400 Z" fill="${c.cardigan}"/>
  <path d="M112 298 C 122 330, 178 330, 188 298 L 176 400 L 124 400 Z" fill="${c.top}"/>
  <path d="M112 298 L 130 400 L 118 400 L 100 304 Z" fill="${c.cardiganShade}"/>
  <path d="M188 298 L 170 400 L 182 400 L 200 304 Z" fill="${c.cardiganShade}"/>
  <circle cx="132" cy="360" r="4" fill="${c.cardiganShade}"/>
  <circle cx="168" cy="360" r="4" fill="${c.cardiganShade}"/>
  <rect x="134" y="248" width="32" height="56" rx="12" fill="${c.skinShade}"/>
  <path d="M128 304 Q 150 322 172 304" stroke="${c.gold}" stroke-width="3" fill="none"/>
  <circle cx="150" cy="316" r="5" fill="${c.gold}"/>`
  },
  head: () => {
    const c = LIA_COLORS
    const fringe = [
      { x: 98, y: 128, r: 20 },
      { x: 124, y: 116, r: 21 },
      { x: 152, y: 112, r: 22 },
      { x: 180, y: 116, r: 21 },
      { x: 204, y: 130, r: 19 }
    ]
    return `
  <circle cx="80" cy="196" r="11" fill="${c.skin}"/>
  <circle cx="220" cy="196" r="11" fill="${c.skin}"/>
  <circle cx="80" cy="214" r="7" fill="none" stroke="${c.gold}" stroke-width="3"/>
  <circle cx="220" cy="214" r="7" fill="none" stroke="${c.gold}" stroke-width="3"/>
  <ellipse cx="150" cy="190" rx="70" ry="80" fill="${c.skin}"/>
  ${fringe.map(({ x, y, r }) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c.hair}"/>`).join('')}
  ${fringe
    .map(
      ({ x, y }) =>
        `<path d="M${x - 7} ${y + 4} q 7 -11 14 0" stroke="${c.curl}" stroke-width="3" fill="none" stroke-linecap="round"/>`
    )
    .join('')}
  <path d="M150 196 Q 145 210 153 213" stroke="${c.skinShade}" stroke-width="3" fill="none" stroke-linecap="round"/>`
  }
}

export const LIA: Character2D = {
  folder: 'lia',
  name: 'Lia',
  draw: (face, state) => drawHuman(LIA_LOOK, face, state)
}

// Theo: a teacher with a red beard, a knit sweater, and a shirt collar.

const THEO_COLORS = {
  skin: '#f0c19c',
  skinShade: '#d9a27c',
  hair: '#8a4b2a',
  hairShade: '#6e3a20',
  sweater: '#3d6b4f',
  sweaterShade: '#2f5640',
  collar: '#f5f1e8',
  lip: '#e3a98a'
}

const THEO_LOOK: HumanLook = {
  eyes: { left: 122, right: 178, y: 182 },
  mouth: { x: 150, y: 240 },
  brow: { y: 152, half: 17, width: 7, color: THEO_COLORS.hairShade },
  colors: { ink: INK, mouth: '#6b2626', tongue: '#d9706a', blush: '#f19c8f' },
  cheeks: [
    { x: 102, y: 208 },
    { x: 198, y: 208 }
  ],
  body: () => {
    const c = THEO_COLORS
    const knit = [318, 342, 366, 390]
      .map(
        (y) =>
          `<path d="M60 ${y + 6} Q 150 ${y - 8} 240 ${y + 6}" stroke="${c.sweaterShade}" stroke-width="3" fill="none" opacity="0.6"/>`
      )
      .join('')
    return `
  <path d="M30 400 C 36 322, 90 290, 150 288 C 210 290, 264 322, 270 400 Z" fill="${c.sweater}"/>${knit}
  <rect x="132" y="250" width="36" height="52" rx="12" fill="${c.skinShade}"/>
  <path d="M116 292 Q 150 318 184 292 L 184 302 Q 150 330 116 302 Z" fill="${c.sweaterShade}"/>
  <path d="M126 290 L 150 306 L 136 318 Z" fill="${c.collar}"/>
  <path d="M174 290 L 150 306 L 164 318 Z" fill="${c.collar}"/>`
  },
  head: () => {
    const c = THEO_COLORS
    return `
  <circle cx="78" cy="190" r="12" fill="${c.skin}"/>
  <circle cx="222" cy="190" r="12" fill="${c.skin}"/>
  <ellipse cx="150" cy="186" rx="72" ry="82" fill="${c.skin}"/>
  <path d="M78 176 C 76 206, 86 252, 112 270 C 128 282, 172 282, 188 270 C 214 252, 224 206, 222 176 C 214 196, 206 212, 192 218 C 178 210, 122 210, 108 218 C 94 212, 86 196, 78 176 Z" fill="${c.hair}"/>
  <ellipse cx="150" cy="242" rx="24" ry="14" fill="${c.lip}"/>
  <path d="M78 176 C 70 116, 104 90, 150 92 C 196 90, 232 116, 222 176 C 216 150, 210 136, 196 126 C 170 136, 132 124, 112 114 C 96 126, 86 146, 78 176 Z" fill="${c.hair}"/>
  <path d="M112 114 C 128 118, 150 112, 162 104" stroke="${c.hairShade}" stroke-width="3" fill="none" stroke-linecap="round"/>
  <path d="M150 190 Q 144 206 153 209" stroke="${c.skinShade}" stroke-width="3" fill="none" stroke-linecap="round"/>`
  },
  front: () => {
    const c = THEO_COLORS
    return `
  <path d="M150 228 C 140 220, 120 222, 112 236 C 124 232, 138 234, 150 236 C 162 234, 176 232, 188 236 C 180 222, 160 220, 150 228 Z" fill="${c.hair}"/>`
  }
}

export const THEO: Character2D = {
  folder: 'theo',
  name: 'Theo',
  draw: (face, state) => drawHuman(THEO_LOOK, face, state)
}
