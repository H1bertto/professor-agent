import type { AvatarConfig } from '../../../shared/avatar'
import type { AvatarRenderer } from '../avatar/types'
import { VrmAvatar } from '../avatar/vrm/vrm-avatar'
import { startFrameLoop } from './frame-loop'

const FRAMES_PER_SECOND = 30
const stage = document.getElementById('stage') as HTMLDivElement

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

async function main(): Promise<void> {
  try {
    const avatar = await mountAvatar(await window.professor.overlay.getAvatar())
    new ResizeObserver(() => avatar.resize(stage.clientWidth, stage.clientHeight)).observe(stage)
    window.professor.overlay.onLookTarget((target) => avatar.lookAt(target))
    startFrameLoop(FRAMES_PER_SECOND, (deltaSeconds) => avatar.frame(deltaSeconds))
  } catch (error) {
    console.error(error)
    showError(error)
  }
  window.professor.overlay.ready()
}

void main()
