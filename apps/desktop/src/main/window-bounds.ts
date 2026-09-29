export interface Rect {
  x: number
  y: number
  width: number
  height: number
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

/** Grows (positive steps) or shrinks the window, keeping the bottom center in place. */
export function resizeKeepingBase(bounds: Rect, steps: number): Rect {
  const size = overlaySize(bounds.height * RESIZE_FACTOR ** steps)
  const centerX = bounds.x + bounds.width / 2
  const bottom = bounds.y + bounds.height
  return { x: Math.round(centerX - size.width / 2), y: Math.round(bottom - size.height), ...size }
}
