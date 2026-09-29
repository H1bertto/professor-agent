export interface Point {
  x: number
  y: number
}

export interface Rect extends Point {
  width: number
  height: number
}

export function containsPoint(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x < rect.x + rect.width &&
    point.y >= rect.y &&
    point.y < rect.y + rect.height
  )
}

/** Where a dragged window goes: its start position plus how far the cursor moved. */
export function dragBounds(start: Rect, cursorAtStart: Point, cursorNow: Point): Rect {
  return {
    ...start,
    x: Math.round(start.x + cursorNow.x - cursorAtStart.x),
    y: Math.round(start.y + cursorNow.y - cursorAtStart.y)
  }
}

/** Width divided by height. A bust shot, like a sign language interpreter box. */
export const OVERLAY_ASPECT = 3 / 4
export const OVERLAY_MIN_HEIGHT = 200
export const OVERLAY_MAX_HEIGHT = 900
export const OVERLAY_DEFAULT_HEIGHT = 420
const SCREEN_MARGIN = 24
const RESIZE_FACTOR = 1.1

export function overlaySize(height: number): { width: number; height: number } {
  const clamped = Math.round(Math.min(OVERLAY_MAX_HEIGHT, Math.max(OVERLAY_MIN_HEIGHT, height)))
  return { width: Math.round(clamped * OVERLAY_ASPECT), height: clamped }
}

/** The bottom-right corner of the work area, where interpreter boxes usually sit. */
export function defaultOverlayBounds(workArea: Rect, height = OVERLAY_DEFAULT_HEIGHT): Rect {
  const size = overlaySize(Math.min(height, workArea.height - 2 * SCREEN_MARGIN))
  return {
    x: workArea.x + workArea.width - size.width - SCREEN_MARGIN,
    y: workArea.y + workArea.height - size.height - SCREEN_MARGIN,
    ...size
  }
}

/** Moves the bounds so the whole window stays inside the work area. */
export function clampToWorkArea(bounds: Rect, workArea: Rect): Rect {
  const width = Math.min(bounds.width, workArea.width)
  const height = Math.min(bounds.height, workArea.height)
  const x = Math.min(Math.max(bounds.x, workArea.x), workArea.x + workArea.width - width)
  const y = Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - height)
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  }
}

export const BUBBLE_WIDTH = 340
export const BUBBLE_MIN_HEIGHT = 60
export const BUBBLE_MAX_HEIGHT = 360
/** Room for the text field and one line of hints or errors below it. */
export const ASK_SIZE = { width: 380, height: 88 }
const COMPANION_GAP = 12

/**
 * Where the answer bubble and the question box go: beside the avatar, on the side with more
 * room, near its bottom. The bubble sits above the question box, or below it when the avatar is
 * close to the top of the screen, so the two never cover each other.
 */
export function companionBounds(
  overlay: Rect,
  workArea: Rect,
  bubbleHeight: number
): { bubble: Rect; ask: Rect } {
  const width = Math.max(BUBBLE_WIDTH, ASK_SIZE.width)
  const roomLeft = overlay.x - workArea.x
  const roomRight = workArea.x + workArea.width - (overlay.x + overlay.width)
  const onLeft = roomLeft >= width + COMPANION_GAP || roomLeft >= roomRight
  const besideX = (windowWidth: number): number =>
    onLeft ? overlay.x - COMPANION_GAP - windowWidth : overlay.x + overlay.width + COMPANION_GAP

  const ask = clampToWorkArea(
    { x: besideX(ASK_SIZE.width), y: overlay.y + overlay.height - ASK_SIZE.height, ...ASK_SIZE },
    workArea
  )
  const height = Math.min(BUBBLE_MAX_HEIGHT, Math.max(BUBBLE_MIN_HEIGHT, Math.round(bubbleHeight)))
  const above = ask.y - COMPANION_GAP - height
  const y = above >= workArea.y ? above : ask.y + ask.height + COMPANION_GAP
  const bubble = clampToWorkArea(
    { x: besideX(BUBBLE_WIDTH), y, width: BUBBLE_WIDTH, height },
    workArea
  )
  return { bubble, ask }
}

/** Grows (positive steps) or shrinks the window, keeping the bottom center in place. */
export function resizeKeepingBase(bounds: Rect, steps: number): Rect {
  const size = overlaySize(bounds.height * RESIZE_FACTOR ** steps)
  const centerX = bounds.x + bounds.width / 2
  const bottom = bounds.y + bounds.height
  return { x: Math.round(centerX - size.width / 2), y: Math.round(bottom - size.height), ...size }
}
