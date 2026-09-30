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
import { parsePngTuberManifest, type PngTuberFrames } from '../../../../shared/pngtuber-manifest'

const MAX_PIXEL_RATIO = 2
/** A pixel with more alpha than this belongs to the avatar. */
const HIT_ALPHA = 24
const MOUTH_OPEN = 0.3
const EYES_CLOSED = 0.5

type LoadedFrames = Record<keyof PngTuberFrames, HTMLImageElement>

/** A 2D avatar made of still images: one per emotion, with mouth and eye variations. */
export class PngTuberAvatar implements AvatarRenderer {
  private readonly context: CanvasRenderingContext2D
  private readonly frames = new Map<Emotion, LoadedFrames>()
  private readonly blink = createBlinker()
  private width = 0
  private height = 0
  private pixelRatio = 1
  private time = 0
  private emotion: Emotion = 'neutral'
  private state: AvatarState = 'idle'
  private mouth = 0
  private mouthTarget = 0
  /** A small jump when the emotion changes, like PNGTuber models do. */
  private hop = 0
  private look: LookTarget = { x: 0, y: 0 }
  private lookGoal: LookTarget = { x: 0, y: 0 }
  /** How much of the thinking and listening poses shows, from 0 to 1, so changes are smooth. */
  private thinking = 0
  private listening = 0

  constructor(private readonly canvas: HTMLCanvasElement) {
    // The hit test reads a pixel every frame, which is faster on a CPU-backed canvas.
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('This computer cannot draw 2D graphics.')
    this.context = context
  }

  async load(url: string): Promise<void> {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Could not read avatar.json (HTTP ${response.status}).`)
    const manifest = parsePngTuberManifest(await response.json())

    const cache = new Map<string, Promise<HTMLImageElement>>()
    const image = (file: string): Promise<HTMLImageElement> => {
      const imageUrl = new URL(file, url).href
      if (!cache.has(imageUrl)) cache.set(imageUrl, loadImage(imageUrl))
      return cache.get(imageUrl)!
    }
    for (const emotion of EMOTIONS) {
      const files = manifest.emotions[emotion]
      const [idle, talking, blinking] = await Promise.all([
        image(files.idle),
        image(files.talking),
        image(files.blinking)
      ])
      this.frames.set(emotion, { idle, talking, blinking })
    }
  }

  frame(deltaSeconds: number): void {
    this.time += deltaSeconds
    this.thinking = approach(this.thinking, this.state === 'thinking' ? 1 : 0, 5, deltaSeconds)
    this.listening = approach(this.listening, this.state === 'listening' ? 1 : 0, 5, deltaSeconds)
    // While thinking, the avatar leans toward the side it looks at, away from the cursor. While
    // listening, it faces the student.
    const focus = this.listening * LISTENING_FOCUS
    const goalX = mix(
      mix(clamp(this.lookGoal.x, -1.5, 1.5), THINKING_GAZE.x, this.thinking),
      LISTENING_GAZE.x,
      focus
    )
    const goalY = mix(
      mix(clamp(this.lookGoal.y, -1.5, 1.5), THINKING_GAZE.y, this.thinking),
      LISTENING_GAZE.y,
      focus
    )
    this.look = {
      x: approach(this.look.x, goalX, 4, deltaSeconds),
      y: approach(this.look.y, goalY, 4, deltaSeconds)
    }
    this.mouth = approach(this.mouth, this.mouthTarget, 20, deltaSeconds)
    this.hop = approach(this.hop, 0, 8, deltaSeconds)
    const eyes = this.blink(deltaSeconds)

    const context = this.context
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.clearRect(0, 0, this.canvas.width, this.canvas.height)
    const frames = this.frames.get(this.emotion)
    if (!frames || this.width === 0) return

    const image =
      eyes > EYES_CLOSED ? frames.blinking : this.mouth > MOUTH_OPEN ? frames.talking : frames.idle
    const scale = Math.min(this.width / image.naturalWidth, this.height / image.naturalHeight)
    const width = image.naturalWidth * scale
    const height = image.naturalHeight * scale
    const lean = clamp(this.look.x, -1, 1)

    // Pivot at the bottom center, so breathing and leaning look anchored to the shoulders.
    context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0)
    context.translate(this.width / 2 + lean * this.width * 0.02, this.height)
    context.rotate(
      lean * 0.03 + this.thinking * 0.05 - this.listening * 0.04 + Math.sin(this.time * 0.6) * 0.01
    )
    // Listening, the avatar tilts the other way and comes a little closer.
    const closer = 1 + this.listening * 0.02
    context.scale(closer, closer * (1 + breathing(this.time) * 0.012))
    context.translate(0, -this.hop * this.height * 0.04)
    context.drawImage(image, -width / 2, -height, width, height)
  }

  setEmotion(emotion: Emotion): void {
    if (emotion !== this.emotion) this.hop = 1
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
    const pixelX = Math.floor(x * this.pixelRatio)
    const pixelY = Math.floor(y * this.pixelRatio)
    if (pixelX < 0 || pixelY < 0 || pixelX >= this.canvas.width || pixelY >= this.canvas.height) {
      return false
    }
    return this.context.getImageData(pixelX, pixelY, 1, 1).data[3] > HIT_ALPHA
  }

  resize(width: number, height: number): void {
    this.width = width
    this.height = height
    this.pixelRatio = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO)
    this.canvas.width = Math.round(width * this.pixelRatio)
    this.canvas.height = Math.round(height * this.pixelRatio)
  }

  dispose(): void {
    this.frames.clear()
  }

  get currentState(): AvatarState {
    return this.state
  }
}

/** Loads an image through a blob URL, so the canvas stays readable for the hit test. */
async function loadImage(url: string): Promise<HTMLImageElement> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not read ${url} (HTTP ${response.status}).`)
  const blobUrl = URL.createObjectURL(await response.blob())
  try {
    const image = new Image()
    image.src = blobUrl
    await image.decode()
    return image
  } finally {
    URL.revokeObjectURL(blobUrl)
  }
}
