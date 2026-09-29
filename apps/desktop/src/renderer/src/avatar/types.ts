import type { AvatarState, Emotion, LookTarget } from '../../../shared/avatar'

/**
 * Draws an avatar on the overlay canvas. The VRM (3D) and PNGTuber (2D) renderers implement it,
 * so the rest of the app never needs to know which one is in use.
 */
export interface AvatarRenderer {
  load(url: string): Promise<void>
  /** Advances the animation and draws one frame. */
  frame(deltaSeconds: number): void
  setEmotion(emotion: Emotion): void
  /** 0 is closed and 1 is fully open. Lip sync drives it from phase 3 on. */
  setMouthOpen(amount: number): void
  lookAt(target: LookTarget | null): void
  setState(state: AvatarState): void
  /** Whether the avatar covers this point, in CSS pixels. Reads the last frame, so call it after `frame`. */
  hitTest(x: number, y: number): boolean
  resize(width: number, height: number): void
  dispose(): void
}
