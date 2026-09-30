import type { AvatarPose } from '../../../shared/api'
import type { AvatarConfig } from '../../../shared/avatar'
import { mouthFromLevel, talkingMouth } from '../avatar/motion'
import { PngTuberAvatar } from '../avatar/pngtuber/pngtuber-avatar'
import type { AvatarRenderer } from '../avatar/types'
import { VrmAvatar } from '../avatar/vrm/vrm-avatar'
import { buildCaptureGraph } from './capture-graph'
import { createClickThroughController, isClick, type PointerMark } from './click-through'
import { startFrameLoop } from './frame-loop'
import { Microphone, MICROPHONE_CONSTRAINTS } from './microphone'
import { SpeechPlayer } from './speech-player'

const FRAMES_PER_SECOND = 30
/** Trackpads send many wheel events per gesture. One resize step per interval is enough. */
const RESIZE_INTERVAL_MS = 80
const stage = document.getElementById('stage') as HTMLDivElement
const overlay = window.professor.overlay

let avatar: AvatarRenderer | null = null
let pose: AvatarPose = { state: 'idle', emotion: 'neutral', talking: false }
let talkingTime = 0
/** Whether the speech audio moved the mouth in the last frame. */
let lipSync = false

const speech = new SpeechPlayer({
  segment: (index) => overlay.reportSpeech({ type: 'segment', index }),
  finished: () => overlay.reportSpeech({ type: 'finished' })
})
const microphone = new Microphone(
  {
    audio: (pcm) => overlay.sendMicrophoneAudio(pcm),
    failed: (message) => overlay.microphoneFailed(message)
  },
  {
    requestStream: () => navigator.mediaDevices.getUserMedia(MICROPHONE_CONSTRAINTS),
    buildGraph: buildCaptureGraph
  }
)

/** Loads the new avatar off screen, then swaps it in, so switching never shows an empty window. */
async function showAvatar(config: AvatarConfig): Promise<void> {
  // Each renderer gets a fresh canvas, because a canvas keeps its first context type.
  const canvas = document.createElement('canvas')
  const next = config.kind === 'vrm' ? new VrmAvatar(canvas) : new PngTuberAvatar(canvas)
  try {
    next.resize(stage.clientWidth, stage.clientHeight)
    await next.load(config.url)
  } catch (error) {
    next.dispose()
    throw error
  }
  next.setEmotion(pose.emotion)
  next.setState(pose.state)
  stage.replaceChildren(canvas)
  avatar?.dispose()
  avatar = next
}

function showError(error: unknown): void {
  const message = document.createElement('p')
  message.className = 'error'
  message.textContent = `Could not load the avatar: ${error instanceof Error ? error.message : String(error)}`
  stage.replaceChildren(message)
}

/** Click-through, drag to move, and the mouse wheel to resize. */
function startInteraction(): void {
  let pointer: { x: number; y: number } | null = null
  const clickThrough = createClickThroughController({
    onChange: (interactive) => {
      document.body.classList.toggle('interactive', interactive)
      overlay.setInteractive(interactive)
    }
  })

  // While clicks pass through, the window still receives mouse moves (forwarded by Electron).
  window.addEventListener(
    'mousemove',
    (event) => (pointer = { x: event.clientX, y: event.clientY })
  )
  document.addEventListener('mouseleave', () => (pointer = null))
  overlay.onCursor(({ look, overWindow }) => {
    avatar?.lookAt(look)
    if (!overWindow) pointer = null
  })

  let dragging = false
  let press: PointerMark | null = null
  const mark = (event: PointerEvent): PointerMark => ({
    x: event.screenX,
    y: event.screenY,
    time: event.timeStamp
  })
  stage.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !clickThrough.interactive || dragging) return
    press = mark(event)
    dragging = true
    stage.setPointerCapture(event.pointerId)
    clickThrough.hold(true)
    document.body.classList.add('dragging')
    overlay.startDrag()
  })
  const endDrag = (event: PointerEvent): void => {
    if (!dragging) return
    dragging = false
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId)
    clickThrough.hold(false)
    document.body.classList.remove('dragging')
    overlay.endDrag()
  }
  stage.addEventListener('pointerup', (event) => {
    // A click without a drag opens the question box.
    if (press && isClick(press, mark(event))) overlay.click()
    press = null
    endDrag(event)
  })
  stage.addEventListener('pointercancel', endDrag)
  // Windows can take the pointer away mid-drag (Alt+Tab, for example) without a pointerup.
  stage.addEventListener('lostpointercapture', endDrag)

  let lastResize = 0
  stage.addEventListener(
    'wheel',
    (event) => {
      if (!clickThrough.interactive) return
      event.preventDefault()
      if (event.timeStamp - lastResize < RESIZE_INTERVAL_MS) return
      lastResize = event.timeStamp
      overlay.resize(event.deltaY < 0 ? 1 : -1)
    },
    { passive: false }
  )

  new ResizeObserver(() => avatar?.resize(stage.clientWidth, stage.clientHeight)).observe(stage)

  startFrameLoop(FRAMES_PER_SECOND, (deltaSeconds) => {
    if (!avatar) return
    if (speech.playing) {
      // Real speech moves the mouth with its own loudness.
      avatar.setMouthOpen(mouthFromLevel(speech.level()))
      lipSync = true
    } else if (pose.talking) {
      talkingTime += deltaSeconds
      avatar.setMouthOpen(talkingMouth(talkingTime))
    } else if (lipSync) {
      lipSync = false
      avatar.setMouthOpen(0)
    }
    avatar.frame(deltaSeconds)
    // The hit test reads the frame that was just drawn.
    clickThrough.update(pointer !== null && avatar.hitTest(pointer.x, pointer.y))
  })
}

async function main(): Promise<void> {
  startInteraction()
  overlay.onSpeech((command) => speech.handle(command))
  overlay.onMicrophone((on) => microphone.set(on))
  overlay.onAvatarChanged((config) => {
    showAvatar(config).catch((error) => console.error('Could not switch avatars', error))
  })
  overlay.onPose((next) => {
    pose = next
    avatar?.setEmotion(next.emotion)
    avatar?.setState(next.state)
    if (!next.talking && !speech.playing) avatar?.setMouthOpen(0)
  })

  try {
    await showAvatar(await overlay.getAvatar())
  } catch (error) {
    console.error(error)
    showError(error)
  }
  overlay.ready()
}

void main()
