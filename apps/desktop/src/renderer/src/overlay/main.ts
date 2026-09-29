import type { AvatarConfig } from '../../../shared/avatar'
import type { AvatarRenderer } from '../avatar/types'
import { VrmAvatar } from '../avatar/vrm/vrm-avatar'
import { createClickThroughController } from './click-through'
import { startFrameLoop } from './frame-loop'

const FRAMES_PER_SECOND = 30
/** Trackpads send many wheel events per gesture. One resize step per interval is enough. */
const RESIZE_INTERVAL_MS = 80
const stage = document.getElementById('stage') as HTMLDivElement
const overlay = window.professor.overlay

async function mountAvatar(config: AvatarConfig): Promise<AvatarRenderer> {
  // Each renderer gets a fresh canvas, because a canvas keeps its first context type.
  const canvas = document.createElement('canvas')
  stage.replaceChildren(canvas)
  const avatar = new VrmAvatar(canvas)
  avatar.resize(stage.clientWidth, stage.clientHeight)
  await avatar.load(config.url)
  return avatar
}

function showError(error: unknown): void {
  const message = document.createElement('p')
  message.className = 'error'
  message.textContent = `Could not load the avatar: ${error instanceof Error ? error.message : String(error)}`
  stage.replaceChildren(message)
}

/** Lets the student drag the avatar and resize it with the mouse wheel. */
function enableMouseControls(avatar: AvatarRenderer): void {
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
    avatar.lookAt(look)
    if (!overWindow) pointer = null
  })

  stage.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !clickThrough.interactive) return
    stage.setPointerCapture(event.pointerId)
    clickThrough.hold(true)
    document.body.classList.add('dragging')
    overlay.startDrag()
  })
  const endDrag = (event: PointerEvent): void => {
    if (!stage.hasPointerCapture(event.pointerId)) return
    stage.releasePointerCapture(event.pointerId)
    clickThrough.hold(false)
    document.body.classList.remove('dragging')
    overlay.endDrag()
  }
  stage.addEventListener('pointerup', endDrag)
  stage.addEventListener('pointercancel', endDrag)

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

  startFrameLoop(FRAMES_PER_SECOND, (deltaSeconds) => {
    avatar.frame(deltaSeconds)
    // The hit test reads the frame that was just drawn.
    clickThrough.update(pointer !== null && avatar.hitTest(pointer.x, pointer.y))
  })
}

async function main(): Promise<void> {
  try {
    const avatar = await mountAvatar(await overlay.getAvatar())
    new ResizeObserver(() => avatar.resize(stage.clientWidth, stage.clientHeight)).observe(stage)
    enableMouseControls(avatar)
  } catch (error) {
    console.error(error)
    showError(error)
  }
  overlay.ready()
}

void main()
