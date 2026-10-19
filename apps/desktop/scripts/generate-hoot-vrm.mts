// Generates Hoot 3D, the project mascot as a VRM 1.0 avatar built from simple shapes.
//
// The owl stands on a book, faces +Z, and is about 0.75 m tall, so the overlay's bust shot shows
// all of it. Each part follows one bone, without skinning. The wings are the arms and the feet
// are the legs. The eyes turn with the eye bones, and morph targets move the lids, the brows,
// the beak, and the blush for the expressions. The cap's tassel swings with spring bones.
//
// Run it with `npm run generate:avatars`. With `scripts/avatars/hoot-3d-thumbnail.png`, the
// file carries that picture as its thumbnail.

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { GltfBuilder, type Geometry } from './vrm/gltf-builder.mts'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUTPUT = join(HERE, '..', 'resources', 'avatars', 'hoot.vrm')
const THUMBNAIL = join(HERE, 'avatars', 'hoot-3d-thumbnail.png')

type Vec = [number, number, number]

// Proportions, in meters.
const HEAD: Vec = [0, 0.75, 0]
const HEAD_RADII: Vec = [0.165, 0.15, 0.15]
const EYE_X = 0.068
const EYE_Y = 0.77
const EYE_Z = 0.125
const EYE_R = 0.048
const LID_R = EYE_R * 1.07

// Colors, as in the 2D Hoot.
const COLORS = {
  feathers: ['#8b5e3c', '#6b4429'],
  feathersDark: ['#6f4a2f', '#523520'],
  belly: ['#ecd9b8', '#d4bc94'],
  bellyMarks: ['#c9a77c', '#b08d62'],
  disc: ['#f3e6cc', '#dfcca8'],
  lid: ['#e2c9a0', '#c9ad80'],
  iris: ['#f2b632', '#d99a1c'],
  pupil: ['#2b2b2b', '#1c1c1c'],
  highlight: ['#ffffff', '#ffffff'],
  beak: ['#f0a43a', '#d4862a'],
  mouth: ['#5a2a1e', '#3f1c14'],
  blush: ['#f4a3a0', '#e48c88'],
  glasses: ['#2b2b2b', '#1c1c1c'],
  cap: ['#2a3142', '#1c2230'],
  tassel: ['#f2c14e', '#d9a436'],
  bookCover: ['#b4463c', '#933329'],
  pages: ['#f5f1e8', '#ddd6c6']
} as const
type MaterialName = keyof typeof COLORS

const NO_OUTLINE: ReadonlySet<MaterialName> = new Set([
  'pupil',
  'highlight',
  'blush',
  'glasses',
  'bellyMarks',
  'mouth',
  'tassel'
])
const OUTLINE_WIDTH = 0.0035
const OUTLINE_COLOR = '#3a2a1c'

// The skeleton in its rest pose: a T-pose with every bone unrotated.

type BoneName =
  | 'hips'
  | 'spine'
  | 'chest'
  | 'neck'
  | 'head'
  | 'leftEye'
  | 'rightEye'
  | 'leftShoulder'
  | 'leftUpperArm'
  | 'leftLowerArm'
  | 'leftHand'
  | 'rightShoulder'
  | 'rightUpperArm'
  | 'rightLowerArm'
  | 'rightHand'
  | 'leftUpperLeg'
  | 'leftLowerLeg'
  | 'leftFoot'
  | 'rightUpperLeg'
  | 'rightLowerLeg'
  | 'rightFoot'

interface Joint {
  parent: string | null
  at: Vec
}

const SKELETON: Record<string, Joint> = {
  hips: { parent: null, at: [0, 0.38, 0] },
  spine: { parent: 'hips', at: [0, 0.46, 0] },
  chest: { parent: 'spine', at: [0, 0.56, 0] },
  neck: { parent: 'chest', at: [0, 0.63, 0] },
  head: { parent: 'neck', at: [0, 0.67, 0] },
  leftEye: { parent: 'head', at: [EYE_X, EYE_Y, EYE_Z] },
  rightEye: { parent: 'head', at: [-EYE_X, EYE_Y, EYE_Z] }
}
for (const [side, sign] of [
  ['left', 1],
  ['right', -1]
] as const) {
  SKELETON[`${side}Shoulder`] = { parent: 'chest', at: [sign * 0.07, 0.6, 0] }
  SKELETON[`${side}UpperArm`] = { parent: `${side}Shoulder`, at: [sign * 0.185, 0.6, 0] }
  SKELETON[`${side}LowerArm`] = { parent: `${side}UpperArm`, at: [sign * 0.31, 0.6, 0] }
  SKELETON[`${side}Hand`] = { parent: `${side}LowerArm`, at: [sign * 0.43, 0.6, 0] }
  SKELETON[`${side}UpperLeg`] = { parent: 'hips', at: [sign * 0.07, 0.36, 0] }
  SKELETON[`${side}LowerLeg`] = { parent: `${side}UpperLeg`, at: [sign * 0.07, 0.31, 0] }
  SKELETON[`${side}Foot`] = { parent: `${side}LowerLeg`, at: [sign * 0.07, 0.262, 0.012] }
}

// The cap sits tilted, front down and toward the tassel side, which is the owl's left (+X).
const CAP = new THREE.Matrix4().compose(
  new THREE.Vector3(0, 0.875, 0),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0, -0.08)),
  new THREE.Vector3(1, 1, 1)
)
const CAP_CORNER = 0.125 * Math.SQRT2
const TASSEL_ROOT = new THREE.Vector3(CAP_CORNER, 0.04, 0).applyMatrix4(CAP)
const TASSEL_DROPS = [0, 0.03, 0.06, 0.1]
for (const [index, drop] of TASSEL_DROPS.entries()) {
  SKELETON[`tassel${index}`] = {
    parent: index === 0 ? 'head' : `tassel${index - 1}`,
    at: [TASSEL_ROOT.x, TASSEL_ROOT.y - drop, TASSEL_ROOT.z]
  }
}

// Shapes, placed in model space.

function vector(at: Vec): THREE.Vector3 {
  return new THREE.Vector3(...at)
}

function place(
  geometry: THREE.BufferGeometry,
  at: Vec,
  options: { scale?: Vec; rotation?: THREE.Quaternion | THREE.Euler } = {}
): THREE.BufferGeometry {
  const rotation =
    options.rotation instanceof THREE.Quaternion
      ? options.rotation
      : new THREE.Quaternion().setFromEuler(options.rotation ?? new THREE.Euler())
  return geometry.applyMatrix4(
    new THREE.Matrix4().compose(vector(at), rotation, vector(options.scale ?? [1, 1, 1]))
  )
}

function ellipsoid(
  at: Vec,
  radii: Vec,
  rotation?: THREE.Quaternion | THREE.Euler,
  detail: [number, number] = [32, 20]
): THREE.BufferGeometry {
  return place(new THREE.SphereGeometry(1, ...detail), at, { scale: radii, rotation })
}

/** A cylinder, or a cone with `endRadius` 0, from `start` to `end`. */
function tube(
  start: Vec,
  end: Vec,
  startRadius: number,
  endRadius = startRadius
): THREE.BufferGeometry {
  const from = vector(start)
  const to = vector(end)
  const geometry = new THREE.CylinderGeometry(endRadius, startRadius, from.distanceTo(to), 20)
  const rotation = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    to.clone().sub(from).normalize()
  )
  const middle = from.clone().add(to).multiplyScalar(0.5)
  return place(geometry, [middle.x, middle.y, middle.z], { rotation })
}

/** A shape for the cap, placed in the cap's own tilted frame. */
function onCap(
  geometry: THREE.BufferGeometry,
  at: Vec,
  rotation?: THREE.Euler
): THREE.BufferGeometry {
  return place(geometry, at, { rotation }).applyMatrix4(CAP)
}

/** A point on an ellipsoid's front, and the way its surface faces there. */
function onSurface(
  center: Vec,
  radii: Vec,
  x: number,
  y: number
): { at: Vec; normal: THREE.Vector3 } {
  const dx = (x - center[0]) / radii[0]
  const dy = (y - center[1]) / radii[1]
  const dz = Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy))
  const z = center[2] + radii[2] * dz
  const normal = new THREE.Vector3(dx / radii[0], dy / radii[1], dz / radii[2]).normalize()
  return { at: [x, y, z], normal }
}

function facing(normal: THREE.Vector3): THREE.Quaternion {
  return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal)
}

/**
 * A patch of a sphere. `direction(u, v)` gives the unit direction from the center for each
 * grid point, with u and v from 0 to 1, so morph targets can share the same vertices.
 */
function spherePatch(
  center: Vec,
  radius: number,
  direction: (u: number, v: number) => THREE.Vector3,
  columns = 28,
  rows = 10
): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      const unit = direction(column / columns, row / rows)
      positions.push(
        center[0] + unit.x * radius,
        center[1] + unit.y * radius,
        center[2] + unit.z * radius
      )
      normals.push(unit.x, unit.y, unit.z)
    }
  }
  const indices: number[] = []
  const corner = (column: number, row: number): number => row * (columns + 1) + column
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const a = corner(column, row)
      const b = corner(column + 1, row)
      const c = corner(column, row + 1)
      const d = corner(column + 1, row + 1)
      indices.push(...outward(positions, normals, a, c, b), ...outward(positions, normals, b, c, d))
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setIndex(indices)
  return geometry
}

/** The triangle, wound so that it faces the way its vertex normals point. */
function outward(
  positions: number[],
  normals: number[],
  a: number,
  b: number,
  c: number
): number[] {
  const point = (index: number): THREE.Vector3 =>
    new THREE.Vector3(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2])
  const face = point(b)
    .sub(point(a))
    .cross(point(c).sub(point(a)))
  const normal = new THREE.Vector3(normals[a * 3], normals[a * 3 + 1], normals[a * 3 + 2])
  return face.dot(normal) < 0 ? [a, c, b] : [a, b, c]
}

const DEG = Math.PI / 180

/** Azimuth α around the vertical axis and elevation β, with +Z in front. */
function eyeDirection(alpha: number, beta: number): THREE.Vector3 {
  return new THREE.Vector3(
    Math.cos(beta) * Math.sin(alpha),
    Math.sin(beta),
    Math.cos(beta) * Math.cos(alpha)
  )
}

const LID_SPAN = 110 * DEG

/** Positive on the side of the eye toward the nose, from -1 to 1. */
type LidEdge = (inward: number) => number

function upperLid(center: Vec, inwardSign: number, edge: LidEdge): THREE.BufferGeometry {
  return spherePatch(center, LID_R, (u, v) => {
    const alpha = (u * 2 - 1) * LID_SPAN
    const top = 90 * DEG
    return eyeDirection(alpha, top - v * (top - edge((alpha / LID_SPAN) * inwardSign)))
  })
}

/** A dark arch over the closed lid, like the ^ of a smiling cartoon eye. */
function smileArch(center: Vec): THREE.BufferGeometry {
  const points = Array.from({ length: 13 }, (_, step) => {
    const across = step / 6 - 1
    const unit = eyeDirection(across * 38 * DEG, (2 + 20 * (1 - across * across)) * DEG)
    return vector(center).addScaledVector(unit, LID_R * 1.04)
  })
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 32, 0.0042, 8)
}

const UPPER_LID: Record<string, LidEdge> = {
  open: () => 36 * DEG,
  half: () => 6 * DEG,
  closed: () => -58 * DEG,
  wide: () => 54 * DEG,
  // Angry lids come down toward the nose, sad ones away from it.
  angry: (inward) => (20 - 16 * inward) * DEG,
  sad: (inward) => (18 + 18 * inward) * DEG
}

/** The pupil: a cap on the front of the eye, `polar` degrees from its middle to its edge. */
function pupil(center: Vec, polar: number): THREE.BufferGeometry {
  return spherePatch(
    center,
    EYE_R * 1.012,
    (u, v) => {
      const around = u * Math.PI * 2
      const away = v * polar * DEG
      return new THREE.Vector3(
        Math.sin(away) * Math.cos(around),
        Math.sin(away) * Math.sin(around),
        Math.cos(away)
      )
    },
    32,
    6
  )
}

function positionsOf(geometry: THREE.BufferGeometry): Float32Array {
  return Float32Array.from(geometry.getAttribute('position').array)
}

function moved(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4): Float32Array {
  return positionsOf(geometry.clone().applyMatrix4(matrix))
}

/** Turns by `angle` around an axis through `pivot`, then moves by `shift`. */
function turnAround(
  pivot: Vec,
  axis: THREE.Vector3,
  angle: number,
  shift: Vec = [0, 0, 0]
): THREE.Matrix4 {
  const toPivot = new THREE.Matrix4().makeTranslation(...pivot)
  const back = new THREE.Matrix4().makeTranslation(-pivot[0], -pivot[1], -pivot[2])
  const turn = new THREE.Matrix4().makeRotationAxis(axis, angle)
  return new THREE.Matrix4()
    .makeTranslation(...shift)
    .multiply(toPivot)
    .multiply(turn)
    .multiply(back)
}

function shrinkTo(center: Vec, scale: number): THREE.Matrix4 {
  return new THREE.Matrix4()
    .makeTranslation(...center)
    .multiply(new THREE.Matrix4().makeScale(scale, scale, scale))
    .multiply(new THREE.Matrix4().makeTranslation(-center[0], -center[1], -center[2]))
}

// The parts of the owl.

interface Part {
  /** Parts with the same mesh name go into one mesh, so they must follow the same bone. */
  mesh: string
  bone: string
  material: MaterialName
  geometry: THREE.BufferGeometry
  /** Vertex positions after each morph target, in model space. */
  targets?: Record<string, Float32Array>
}

const parts: Part[] = []
const add = (
  mesh: string,
  bone: string,
  material: MaterialName,
  geometry: THREE.BufferGeometry,
  targets?: Record<string, Float32Array>
): void => {
  parts.push({ mesh, bone, material, geometry, targets })
}

// Head, facial disc, and ear tufts.
add('Head', 'head', 'feathers', ellipsoid(HEAD, HEAD_RADII, undefined, [40, 28]))
for (const sign of [1, -1]) {
  add('Head', 'head', 'disc', ellipsoid([sign * EYE_X, 0.765, 0.11], [0.085, 0.085, 0.045]))
  add(
    'Head',
    'head',
    'feathersDark',
    tube([sign * 0.13, 0.82, 0], [sign * 0.215, 0.905, -0.02], 0.034, 0)
  )
}
add('Head', 'head', 'disc', ellipsoid([0, 0.71, 0.108], [0.072, 0.05, 0.042]))

// Eyes: the eyeball and the pupil follow the eye bones, the lids follow the head.
for (const [side, sign] of [
  ['Left', 1],
  ['Right', -1]
] as const) {
  const eye: Vec = [sign * EYE_X, EYE_Y, EYE_Z]
  const bone = `${side.toLowerCase()}Eye`
  add(`Eye${side}`, bone, 'iris', ellipsoid(eye, [EYE_R, EYE_R, EYE_R], undefined, [32, 24]))
  for (const [direction, size] of [
    [new THREE.Vector3(0.32, 0.38, 0.87), 0.0075],
    [new THREE.Vector3(-0.26, -0.3, 0.92), 0.004]
  ] as const) {
    const unit = direction.clone().normalize()
    const at = vector(eye).addScaledVector(unit, EYE_R * 1.02)
    add(
      `Eye${side}`,
      bone,
      'highlight',
      ellipsoid([at.x, at.y, at.z], [size, size, 0.002], facing(unit), [16, 10])
    )
  }
  const normal = pupil(eye, 25)
  add(`Pupil${side}`, bone, 'pupil', normal, { pupilSmall: positionsOf(pupil(eye, 15)) })

  // The left eye is at +X, so the nose is toward -X from it.
  const inward = -sign
  const lid = upperLid(eye, inward, UPPER_LID.open)
  const lidTargets: Record<string, Float32Array> = {}
  for (const name of ['half', 'wide', 'angry', 'sad']) {
    lidTargets[`lid${name[0].toUpperCase()}${name.slice(1)}`] = positionsOf(
      upperLid(eye, inward, UPPER_LID[name])
    )
  }
  const closed = positionsOf(upperLid(eye, inward, UPPER_LID.closed))
  lidTargets.lidClosedLeft = side === 'Left' ? closed : positionsOf(lid)
  lidTargets.lidClosedRight = side === 'Right' ? closed : positionsOf(lid)
  add('UpperLids', 'head', 'lid', lid, lidTargets)
  const arch = smileArch(eye)
  const archMiddle = vector(eye).addScaledVector(eyeDirection(0, 22 * DEG), LID_R * 1.04)
  const archFull = positionsOf(arch)
  add(
    'SmileArches',
    'head',
    'pupil',
    arch.applyMatrix4(shrinkTo([archMiddle.x, archMiddle.y, archMiddle.z], 0.001)),
    {
      archesOn: archFull
    }
  )

  // Brows: feather tufts above the eyes that tilt and lift.
  const browAt: Vec = [sign * EYE_X, 0.842, 0.134]
  const brow = ellipsoid(browAt, [0.042, 0.01, 0.012], new THREE.Euler(0, sign * 0.3, 0), [20, 10])
  const zAxis = new THREE.Vector3(0, 0, 1)
  add('Brows', 'head', 'feathersDark', brow, {
    browUp: moved(brow, new THREE.Matrix4().makeTranslation(0, 0.016, 0.002)),
    // The inner end rises for a sad face and drops for an angry one.
    browSad: moved(brow, turnAround(browAt, zAxis, -sign * 26 * DEG, [0, 0.008, 0])),
    browAngry: moved(brow, turnAround(browAt, zAxis, sign * 22 * DEG, [0, -0.006, 0]))
  })

  // Blush: hidden inside itself until an expression shows it.
  const cheek = onSurface([sign * EYE_X, 0.765, 0.11], [0.085, 0.085, 0.045], sign * 0.112, 0.706)
  const blush = ellipsoid(cheek.at, [0.022, 0.012, 0.003], facing(cheek.normal), [20, 10])
  const full = positionsOf(blush)
  add('Blush', 'head', 'blush', blush.applyMatrix4(shrinkTo(cheek.at, 0.001)), { blushOn: full })

  // Glasses: a ring around each eye and a temple back to the head.
  const ring = new THREE.TorusGeometry(0.056, 0.0055, 10, 48)
  add('Glasses', 'head', 'glasses', place(ring, [sign * EYE_X, EYE_Y, 0.158]))
  add(
    'Glasses',
    'head',
    'glasses',
    tube([sign * 0.124, 0.775, 0.152], [sign * 0.158, 0.792, 0.04], 0.004)
  )
}
add('Glasses', 'head', 'glasses', tube([0.012, 0.778, 0.162], [-0.012, 0.778, 0.162], 0.0045))

// Beak: the lower half swings open around a hinge at its back.
add('Head', 'head', 'beak', tube([0, 0.737, 0.146], [0, 0.692, 0.18], 0.021, 0))
add('Head', 'head', 'mouth', ellipsoid([0, 0.716, 0.136], [0.016, 0.016, 0.016]))
const lowerBeak = tube([0, 0.724, 0.14], [0, 0.7, 0.165], 0.014, 0)
add('Beak', 'head', 'beak', lowerBeak, {
  beakOpen: moved(lowerBeak, turnAround([0, 0.728, 0.128], new THREE.Vector3(1, 0, 0), 30 * DEG))
})

// Cap: a skull cap, the board, a button, and the cord to the corner the tassel hangs from.
add('Cap', 'head', 'cap', onCap(new THREE.CylinderGeometry(0.104, 0.112, 0.06, 36), [0, 0, 0]))
add(
  'Cap',
  'head',
  'cap',
  onCap(new THREE.BoxGeometry(0.25, 0.012, 0.25), [0, 0.034, 0], new THREE.Euler(0, Math.PI / 4, 0))
)
add(
  'Cap',
  'head',
  'tassel',
  onCap(new THREE.CylinderGeometry(0.012, 0.012, 0.008, 20), [0, 0.044, 0])
)
add(
  'Cap',
  'head',
  'tassel',
  onCap(
    new THREE.CylinderGeometry(0.0035, 0.0035, CAP_CORNER, 10),
    [CAP_CORNER / 2, 0.043, 0],
    new THREE.Euler(0, 0, Math.PI / 2)
  )
)
for (const index of [0, 1]) {
  const top = SKELETON[`tassel${index}`].at
  const bottom = SKELETON[`tassel${index + 1}`].at
  add(`Tassel${index}`, `tassel${index}`, 'tassel', tube(top, bottom, 0.0035))
}
{
  const top = SKELETON.tassel2.at
  const bottom = SKELETON.tassel3.at
  add('Tassel2', 'tassel2', 'tassel', ellipsoid(top, [0.008, 0.008, 0.008], undefined, [16, 10]))
  add('Tassel2', 'tassel2', 'tassel', tube(top, bottom, 0.008, 0.013))
}

// Body, belly with feather marks, wings, legs, and the book under the feet.
const BELLY: Vec = [0, 0.47, 0.055]
const BELLY_RADII: Vec = [0.14, 0.17, 0.125]
add('Body', 'spine', 'feathers', ellipsoid([0, 0.49, 0], [0.19, 0.22, 0.17], undefined, [40, 28]))
add('Body', 'spine', 'belly', ellipsoid(BELLY, BELLY_RADII, undefined, [36, 24]))
for (const [x, y] of [
  [0, 0.56],
  [-0.045, 0.53],
  [0.045, 0.53],
  [0, 0.495],
  [-0.075, 0.48],
  [0.075, 0.48],
  [-0.035, 0.445],
  [0.035, 0.445]
]) {
  const mark = onSurface(BELLY, BELLY_RADII, x, y)
  const turn = facing(mark.normal)
  for (const sign of [1, -1]) {
    const arm = new THREE.CapsuleGeometry(0.0035, 0.014, 4, 8)
    arm.rotateZ(sign * 50 * DEG)
    arm.translate(sign * 0.006, 0, 0)
    const lifted = vector(mark.at).addScaledVector(mark.normal, 0.002)
    add(
      'Body',
      'spine',
      'bellyMarks',
      place(arm, [lifted.x, lifted.y, lifted.z], { rotation: turn })
    )
  }
}
for (const [side, sign] of [
  ['left', 1],
  ['right', -1]
] as const) {
  // In the T-pose the wings droop a little, so they hang along the body once the arms are down.
  const shoulder = SKELETON[`${side}UpperArm`].at
  const droop = -0.3 * sign
  const along = new THREE.Vector3(Math.cos(droop) * sign, Math.sin(droop) * sign, 0)
  const center = vector(shoulder).addScaledVector(along, 0.13)
  const wing = ellipsoid(
    [center.x, center.y, center.z],
    [0.15, 0.026, 0.078],
    new THREE.Euler(0, 0, droop),
    [32, 16]
  )
  add(`Wing${side}`, `${side}UpperArm`, 'feathersDark', wing)
  for (const [spread, length] of [
    [-0.03, 0.06],
    [0, 0.075],
    [0.03, 0.06]
  ]) {
    const tip = vector(shoulder).addScaledVector(along, 0.26)
    const feather = ellipsoid(
      [tip.x + along.x * length * 0.4, tip.y + along.y * length * 0.4, tip.z + spread],
      [length, 0.012, 0.022],
      new THREE.Euler(0, -spread * 4 * sign, droop),
      [20, 10]
    )
    add(`Wing${side}`, `${side}UpperArm`, 'feathersDark', feather)
  }

  const lowerLeg = SKELETON[`${side}LowerLeg`].at
  const foot = SKELETON[`${side}Foot`].at
  add(`Leg${side}`, `${side}LowerLeg`, 'beak', tube(lowerLeg, foot, 0.016))
  for (const angle of [-32, 0, 32]) {
    const toe = new THREE.CapsuleGeometry(0.011, 0.034, 4, 10)
    toe.rotateX(Math.PI / 2)
    toe.translate(0, 0, 0.026)
    toe.rotateY(angle * DEG)
    add(`Foot${side}`, `${side}Foot`, 'beak', place(toe, [foot[0], 0.258, foot[2] + 0.012]))
  }
}
const book = new THREE.Euler(0, 0.12, 0)
const onBook = (geometry: THREE.BufferGeometry, at: Vec): THREE.BufferGeometry =>
  place(geometry, [0, 0, 0]).applyMatrix4(
    new THREE.Matrix4().compose(
      vector(at),
      new THREE.Quaternion().setFromEuler(book),
      vector([1, 1, 1])
    )
  )
add('Book', 'hips', 'bookCover', onBook(new THREE.BoxGeometry(0.34, 0.006, 0.24), [0, 0.209, 0.03]))
add('Book', 'hips', 'bookCover', onBook(new THREE.BoxGeometry(0.34, 0.006, 0.24), [0, 0.246, 0.03]))
add(
  'Book',
  'hips',
  'bookCover',
  onBook(new THREE.BoxGeometry(0.34, 0.043, 0.008), [0, 0.2275, -0.086])
)
add('Book', 'hips', 'pages', onBook(new THREE.BoxGeometry(0.33, 0.031, 0.228), [0, 0.2275, 0.034]))

// Expressions: morph targets for each one, and how it combines with blinking.

interface Expression {
  binds: [mesh: string, target: string, weight: number][]
  overrideBlink?: 'none' | 'block' | 'blend'
  overrideMouth?: 'none' | 'block' | 'blend'
}

const EXPRESSIONS: Record<string, Expression> = {
  happy: {
    binds: [
      ['UpperLids', 'lidClosedLeft', 1],
      ['UpperLids', 'lidClosedRight', 1],
      ['SmileArches', 'archesOn', 1],
      ['Brows', 'browUp', 0.5],
      ['Blush', 'blushOn', 1],
      ['Beak', 'beakOpen', 0.15]
    ],
    overrideBlink: 'block'
  },
  angry: {
    binds: [
      ['UpperLids', 'lidAngry', 1],
      ['Brows', 'browAngry', 1]
    ],
    overrideBlink: 'blend'
  },
  sad: {
    binds: [
      ['UpperLids', 'lidSad', 1],
      ['Brows', 'browSad', 1]
    ],
    overrideBlink: 'blend'
  },
  relaxed: {
    binds: [
      ['UpperLids', 'lidHalf', 0.8],
      ['Brows', 'browUp', 0.3],
      ['Blush', 'blushOn', 0.7]
    ],
    overrideBlink: 'blend'
  },
  surprised: {
    binds: [
      ['UpperLids', 'lidWide', 1],
      ['PupilLeft', 'pupilSmall', 1],
      ['PupilRight', 'pupilSmall', 1],
      ['Brows', 'browUp', 1],
      ['Beak', 'beakOpen', 0.5]
    ],
    overrideBlink: 'blend',
    overrideMouth: 'blend'
  },
  aa: { binds: [['Beak', 'beakOpen', 1]] },
  oh: { binds: [['Beak', 'beakOpen', 0.8]] },
  ou: { binds: [['Beak', 'beakOpen', 0.55]] },
  ih: { binds: [['Beak', 'beakOpen', 0.4]] },
  ee: { binds: [['Beak', 'beakOpen', 0.3]] },
  blink: {
    binds: [
      ['UpperLids', 'lidClosedLeft', 1],
      ['UpperLids', 'lidClosedRight', 1]
    ]
  },
  blinkLeft: { binds: [['UpperLids', 'lidClosedLeft', 1]] },
  blinkRight: { binds: [['UpperLids', 'lidClosedRight', 1]] },
  neutral: { binds: [] }
}

// Writing the file.

function srgbToLinear(hex: string): [number, number, number] {
  const channel = (offset: number): number => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return [channel(1), channel(3), channel(5)].map((value) => Number(value.toFixed(5))) as [
    number,
    number,
    number
  ]
}

function material(name: MaterialName): Record<string, unknown> {
  const [base, shade] = COLORS[name]
  const outline = !NO_OUTLINE.has(name)
  return {
    name,
    pbrMetallicRoughness: {
      baseColorFactor: [...srgbToLinear(base), 1],
      metallicFactor: 0,
      roughnessFactor: 1
    },
    doubleSided: name === 'lid',
    extensions: {
      VRMC_materials_mtoon: {
        specVersion: '1.0',
        transparentWithZWrite: false,
        renderQueueOffsetNumber: 0,
        shadeColorFactor: srgbToLinear(shade),
        shadingShiftFactor: -0.1,
        shadingToonyFactor: 0.9,
        giEqualizationFactor: 0.9,
        matcapFactor: [0, 0, 0],
        parametricRimColorFactor: [0, 0, 0],
        parametricRimFresnelPowerFactor: 5,
        parametricRimLiftFactor: 0,
        rimLightingMixFactor: 1,
        outlineWidthMode: outline ? 'worldCoordinates' : 'none',
        outlineWidthFactor: outline ? OUTLINE_WIDTH : 0,
        outlineColorFactor: srgbToLinear(OUTLINE_COLOR),
        outlineLightingMixFactor: 1
      }
    }
  }
}

function geometryOf(geometry: THREE.BufferGeometry, offset: THREE.Vector3): Geometry {
  const positions = positionsOf(geometry)
  for (let index = 0; index < positions.length; index += 3) {
    positions[index] -= offset.x
    positions[index + 1] -= offset.y
    positions[index + 2] -= offset.z
  }
  const index = geometry.getIndex()
  if (!index) throw new Error('Every shape must have indices.')
  return {
    positions,
    normals: Float32Array.from(geometry.getAttribute('normal').array),
    indices: Uint32Array.from(index.array)
  }
}

function relative(values: Float32Array, offset: THREE.Vector3): Float32Array {
  const copy = Float32Array.from(values)
  for (let index = 0; index < copy.length; index += 3) {
    copy[index] -= offset.x
    copy[index + 1] -= offset.y
    copy[index + 2] -= offset.z
  }
  return copy
}

/** Joins the parts that share a material into one primitive. */
function merge(
  group: Part[],
  targetNames: string[],
  offset: THREE.Vector3
): { geometry: Geometry; targets: Float32Array[] } {
  const pieces = group.map((part) => ({ part, geometry: geometryOf(part.geometry, offset) }))
  const vertexCount = pieces.reduce(
    (total, piece) => total + piece.geometry.positions.length / 3,
    0
  )
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const indices: number[] = []
  const targets = targetNames.map(() => new Float32Array(vertexCount * 3))
  let first = 0
  for (const { part, geometry } of pieces) {
    positions.set(geometry.positions, first * 3)
    normals.set(geometry.normals, first * 3)
    for (const index of geometry.indices) indices.push(index + first)
    targetNames.forEach((name, target) => {
      const moved = part.targets?.[name]
      targets[target].set(moved ? relative(moved, offset) : geometry.positions, first * 3)
    })
    first += geometry.positions.length / 3
  }
  return { geometry: { positions, normals, indices: Uint32Array.from(indices) }, targets }
}

async function thumbnail(): Promise<Buffer | null> {
  try {
    return await readFile(THUMBNAIL)
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  const builder = new GltfBuilder()
  const materials = new Map<MaterialName, number>()
  const materialIndex = (name: MaterialName): number => {
    if (!materials.has(name)) materials.set(name, builder.addMaterial(material(name)))
    return materials.get(name)!
  }

  // Bones, parents first, with their position relative to the parent.
  const boneNodes = new Map<string, number>()
  const children = new Map<number, number[]>()
  const worldOf = (name: string): THREE.Vector3 => vector(SKELETON[name].at)
  const addChild = (parent: number, child: number): void => {
    children.set(parent, [...(children.get(parent) ?? []), child])
  }
  const root = builder.addNode({ name: 'Root' })
  const pending = Object.keys(SKELETON)
  while (pending.length > 0) {
    const name = pending.shift()!
    const { parent, at } = SKELETON[name]
    if (parent && !boneNodes.has(parent)) {
      pending.push(name)
      continue
    }
    const base = parent ? worldOf(parent) : new THREE.Vector3()
    const node = builder.addNode({
      name: name[0].toUpperCase() + name.slice(1),
      translation: [at[0] - base.x, at[1] - base.y, at[2] - base.z].map((value) =>
        Number(value.toFixed(6))
      )
    })
    boneNodes.set(name, node)
    addChild(parent ? boneNodes.get(parent)! : root, node)
  }

  // Meshes, each in its own node under its bone.
  const meshes = new Map<string, { node: number; targetNames: string[] }>()
  for (const name of [...new Set(parts.map((part) => part.mesh))]) {
    const group = parts.filter((part) => part.mesh === name)
    const bone = group[0].bone
    if (group.some((part) => part.bone !== bone)) throw new Error(`${name} mixes bones.`)
    const targetNames = [...new Set(group.flatMap((part) => Object.keys(part.targets ?? {})))]
    const offset = worldOf(bone)
    const primitives = [...new Set(group.map((part) => part.material))].map((materialName) => {
      const merged = merge(
        group.filter((part) => part.material === materialName),
        targetNames,
        offset
      )
      return {
        geometry: merged.geometry,
        material: materialIndex(materialName),
        targets: merged.targets
      }
    })
    const mesh = builder.addMesh(name, primitives, targetNames)
    const node = builder.addNode({ name, mesh })
    addChild(boneNodes.get(bone)!, node)
    meshes.set(name, { node, targetNames })
  }
  for (const [parent, nodes] of children) builder.nodes[parent].children = nodes

  const expressions: Record<string, unknown> = {}
  for (const [name, expression] of Object.entries(EXPRESSIONS)) {
    expressions[name] = {
      morphTargetBinds: expression.binds.map(([mesh, target, weight]) => {
        const found = meshes.get(mesh)
        const index = found?.targetNames.indexOf(target) ?? -1
        if (!found || index < 0) throw new Error(`No morph target ${target} on ${mesh}.`)
        return { node: found.node, index, weight }
      }),
      isBinary: false,
      overrideBlink: expression.overrideBlink ?? 'none',
      overrideLookAt: 'none',
      overrideMouth: expression.overrideMouth ?? 'none'
    }
  }

  const picture = await thumbnail()
  const thumbnailImage = picture ? builder.addImage(picture, 'image/png', 'thumbnail') : undefined
  const humanBones: Record<string, { node: number }> = {}
  for (const [name, node] of boneNodes) {
    if (!name.startsWith('tassel')) humanBones[name as BoneName] = { node }
  }
  const head = worldOf('head')
  const tassel = [0, 1, 2, 3].map((index) => boneNodes.get(`tassel${index}`)!)

  const file = builder.glb({
    scene: 0,
    scenes: [{ nodes: [root] }],
    extensionsUsed: ['VRMC_vrm', 'VRMC_springBone', 'VRMC_materials_mtoon'],
    extensions: {
      VRMC_vrm: {
        specVersion: '1.0',
        meta: {
          name: 'Hoot',
          version: '1.0',
          authors: ['Professor Agent contributors'],
          copyrightInformation: 'Professor Agent contributors',
          contactInformation: 'https://github.com/H1bertto/professor-agent',
          references: ['https://github.com/H1bertto/professor-agent'],
          ...(thumbnailImage !== undefined && { thumbnailImage }),
          licenseUrl: 'https://vrm.dev/licenses/1.0/',
          avatarPermission: 'everyone',
          allowExcessivelyViolentUsage: false,
          allowExcessivelySexualUsage: false,
          commercialUsage: 'corporation',
          allowPoliticalOrReligiousUsage: false,
          allowAntisocialOrHateUsage: false,
          creditNotation: 'unnecessary',
          allowRedistribution: true,
          modification: 'allowModificationRedistribution',
          otherLicenseUrl: 'https://github.com/H1bertto/professor-agent/blob/main/LICENSE'
        },
        humanoid: { humanBones },
        lookAt: {
          type: 'bone',
          offsetFromHeadBone: [0, EYE_Y - head.y, EYE_Z],
          rangeMapHorizontalInner: { inputMaxValue: 90, outputScale: 25 },
          rangeMapHorizontalOuter: { inputMaxValue: 90, outputScale: 25 },
          rangeMapVerticalDown: { inputMaxValue: 90, outputScale: 18 },
          rangeMapVerticalUp: { inputMaxValue: 90, outputScale: 18 }
        },
        expressions: { preset: expressions }
      },
      VRMC_springBone: {
        specVersion: '1.0',
        colliders: [
          {
            node: boneNodes.get('head')!,
            shape: { sphere: { offset: [0, HEAD[1] - head.y, 0], radius: HEAD_RADII[0] } }
          }
        ],
        colliderGroups: [{ name: 'Head', colliders: [0] }],
        springs: [
          {
            name: 'Tassel',
            joints: tassel.map((node) => ({
              node,
              hitRadius: 0.01,
              stiffness: 0.6,
              gravityPower: 1,
              gravityDir: [0, -1, 0],
              dragForce: 0.35
            })),
            colliderGroups: [0]
          }
        ]
      }
    }
  })
  await writeFile(OUTPUT, file)
  const thumbnailNote = picture ? 'with' : 'without'
  console.log(
    `Wrote ${OUTPUT}, ${(file.length / 1024).toFixed(0)} KB, ${thumbnailNote} a thumbnail`
  )
}

await main()
