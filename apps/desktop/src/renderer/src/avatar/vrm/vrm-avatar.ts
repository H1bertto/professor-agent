import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRMUtils, type VRM, type VRMHumanBoneName } from '@pixiv/three-vrm'
import {
  EMOTIONS,
  type AvatarState,
  type Emotion,
  type LookTarget
} from '../../../../shared/avatar'
import {
  approach,
  breathing,
  clamp,
  createBlinker,
  LISTENING_FOCUS,
  LISTENING_GAZE,
  mix,
  THINKING_GAZE
} from '../motion'
import type { AvatarRenderer } from '../types'

const MAX_PIXEL_RATIO = 1.5
/** A pixel with more alpha than this belongs to the avatar. */
const HIT_ALPHA = 24
/** Vertical field of view of the bust shot, in degrees. */
const FIELD_OF_VIEW = 20
/** Camera distance and how far below the head joint the shot is centered, in meters. */
const CAMERA_DISTANCE = 2.2
const FOCUS_BELOW_HEAD = 0.06
/** Upper arms rotated down from the T-pose into a relaxed pose, in radians. */
const ARMS_DOWN = 1.2

/** A 3D avatar in the VRM format, drawn with three.js and three-vrm. */
export class VrmAvatar implements AvatarRenderer {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(FIELD_OF_VIEW, 3 / 4, 0.1, 20)
  private readonly gazeTarget = new THREE.Object3D()
  private readonly blink = createBlinker()
  private readonly pixel = new Uint8Array(4)
  private readonly emotionWeights = new Map<Emotion, number>()
  private vrm: VRM | null = null
  private time = 0
  private emotion: Emotion = 'neutral'
  private state: AvatarState = 'idle'
  private mouth = 0
  private mouthTarget = 0
  private look: LookTarget = { x: 0, y: 0 }
  private lookGoal: LookTarget = { x: 0, y: 0 }
  /** How much of each pose shows, from 0 to 1, so changes are smooth. */
  private thinking = 0
  private listening = 0
  private speaking = 0

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace

    const keyLight = new THREE.DirectionalLight(0xffffff, Math.PI)
    keyLight.position.set(0.6, 1.2, 1.5)
    this.scene.add(keyLight, new THREE.AmbientLight(0xffffff, 0.3 * Math.PI))
  }

  async load(url: string): Promise<void> {
    const loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))
    const gltf = await loader.loadAsync(url)
    const vrm = gltf.userData.vrm as VRM | undefined
    if (!vrm) throw new Error('This file is not a VRM model.')

    VRMUtils.removeUnnecessaryVertices(gltf.scene)
    VRMUtils.combineSkeletons(gltf.scene)
    VRMUtils.rotateVRM0(vrm)
    // Skinned meshes move away from their bounding boxes, so culling can hide them by mistake.
    vrm.scene.traverse((object) => (object.frustumCulled = false))
    if (vrm.lookAt) vrm.lookAt.target = this.gazeTarget

    this.scene.add(vrm.scene)
    this.vrm = vrm
    this.bone('leftUpperArm')?.rotation.set(0, 0, -ARMS_DOWN)
    this.bone('rightUpperArm')?.rotation.set(0, 0, ARMS_DOWN)
    vrm.update(0)
    this.frameBustShot()
  }

  frame(deltaSeconds: number): void {
    if (this.vrm) {
      this.time += deltaSeconds
      this.animateBody(deltaSeconds)
      this.animateFace(deltaSeconds)
      this.vrm.update(deltaSeconds)
    }
    this.renderer.render(this.scene, this.camera)
  }

  setEmotion(emotion: Emotion): void {
    this.emotion = emotion
  }

  setMouthOpen(amount: number): void {
    this.mouthTarget = clamp(amount, 0, 1)
  }

  lookAt(target: LookTarget | null): void {
    this.lookGoal = target ?? { x: 0, y: 0 }
  }

  setState(state: AvatarState): void {
    this.state = state
  }

  hitTest(x: number, y: number): boolean {
    const canvas = this.renderer.domElement
    const ratio = this.renderer.getPixelRatio()
    const pixelX = Math.floor(x * ratio)
    const pixelY = Math.floor(canvas.height - y * ratio)
    if (pixelX < 0 || pixelY < 0 || pixelX >= canvas.width || pixelY >= canvas.height) return false

    const gl = this.renderer.getContext()
    gl.readPixels(pixelX, pixelY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.pixel)
    return this.pixel[3] > HIT_ALPHA
  }

  resize(width: number, height: number): void {
    if (width === 0 || height === 0) return
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  dispose(): void {
    if (this.vrm) VRMUtils.deepDispose(this.vrm.scene)
    this.renderer.dispose()
  }

  get currentState(): AvatarState {
    return this.state
  }

  private bone(name: VRMHumanBoneName): THREE.Object3D | null {
    return this.vrm?.humanoid.getNormalizedBoneNode(name) ?? null
  }

  /** Frames the head and shoulders, like a sign language interpreter box. */
  private frameBustShot(): void {
    const head = this.bone('head')
    if (!head) return
    this.vrm?.scene.updateMatrixWorld(true)
    const focusY = head.getWorldPosition(new THREE.Vector3()).y - FOCUS_BELOW_HEAD
    this.camera.position.set(0, focusY + 0.03, CAMERA_DISTANCE)
    this.camera.lookAt(0, focusY, 0)
  }

  private animateBody(deltaSeconds: number): void {
    this.thinking = approach(this.thinking, this.state === 'thinking' ? 1 : 0, 5, deltaSeconds)
    this.listening = approach(this.listening, this.state === 'listening' ? 1 : 0, 5, deltaSeconds)
    this.speaking = approach(this.speaking, this.state === 'speaking' ? 1 : 0, 5, deltaSeconds)
    // While thinking, the avatar looks up and away from the cursor, then comes back. While
    // listening, it looks at the student.
    const focus = this.listening * LISTENING_FOCUS
    const goal = {
      x: mix(
        mix(clamp(this.lookGoal.x, -1.5, 1.5), THINKING_GAZE.x, this.thinking),
        LISTENING_GAZE.x,
        focus
      ),
      y: mix(
        mix(clamp(this.lookGoal.y, -1.5, 1.5), THINKING_GAZE.y, this.thinking),
        LISTENING_GAZE.y,
        focus
      )
    }
    this.look = {
      x: approach(this.look.x, goal.x, 4, deltaSeconds),
      y: approach(this.look.y, goal.y, 4, deltaSeconds)
    }
    const yaw = clamp(this.look.x, -1, 1) * 0.5
    const pitch = clamp(this.look.y, -1, 1) * 0.3
    const breath = breathing(this.time)
    const sway = Math.sin(this.time * 0.6) * 0.02
    // A listening avatar tilts its head the other way, and leans in a little.
    const tilt = this.thinking * 0.12 - this.listening * 0.08
    const leanIn = this.listening * 0.05
    // Small nods while the teacher talks, and slower ones while it listens.
    const nod =
      this.speaking * Math.sin(this.time * 4.2) * 0.025 +
      this.listening * Math.sin(this.time * 1.8) * 0.015

    this.bone('neck')?.rotation.set(pitch * 0.4, yaw * 0.4, tilt * 0.3)
    this.bone('head')?.rotation.set(pitch * 0.6 + nod, yaw * 0.6, sway + tilt)
    this.bone('chest')?.rotation.set(breath * 0.015 + leanIn, 0, 0)
    this.bone('spine')?.rotation.set(0, 0, sway * 0.5)
    this.bone('leftShoulder')?.rotation.set(0, 0, breath * 0.02)
    this.bone('rightShoulder')?.rotation.set(0, 0, -breath * 0.02)

    // The eyes aim at a point in front of the camera, shifted toward the cursor.
    this.gazeTarget.position.set(
      this.camera.position.x + this.look.x * 0.8,
      this.camera.position.y - this.look.y * 0.8,
      this.camera.position.z
    )
  }

  private animateFace(deltaSeconds: number): void {
    const expressions = this.vrm?.expressionManager
    if (!expressions) return

    for (const emotion of EMOTIONS) {
      if (emotion === 'neutral') continue
      const target = emotion === this.emotion ? 1 : 0
      const weight = approach(this.emotionWeights.get(emotion) ?? 0, target, 8, deltaSeconds)
      this.emotionWeights.set(emotion, weight)
      expressions.setValue(emotion, weight)
    }
    expressions.setValue('blink', this.blink(deltaSeconds))
    this.mouth = approach(this.mouth, this.mouthTarget, 20, deltaSeconds)
    expressions.setValue('aa', this.mouth)
  }
}
