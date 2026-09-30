import { describe, expect, it } from 'vitest'

import {
  ASK_SIZE,
  BUBBLE_MAX_HEIGHT,
  BUBBLE_MIN_HEIGHT,
  BUBBLE_WIDTH,
  clampToWorkArea,
  companionBounds,
  containsPoint,
  defaultOverlayBounds,
  dragBounds,
  OVERLAY_MAX_HEIGHT,
  OVERLAY_MIN_HEIGHT,
  overlaySize,
  resizeKeepingBase
} from './window-bounds'

const FULL_HD = { x: 0, y: 0, width: 1920, height: 1040 }
const SECOND_MONITOR = { x: 1920, y: -200, width: 2560, height: 1400 }

describe('overlaySize', () => {
  it('keeps the 3:4 aspect ratio', () => {
    expect(overlaySize(400)).toEqual({ width: 300, height: 400 })
  })

  it('clamps to the minimum and maximum height', () => {
    expect(overlaySize(10).height).toBe(OVERLAY_MIN_HEIGHT)
    expect(overlaySize(5000).height).toBe(OVERLAY_MAX_HEIGHT)
  })
})

describe('defaultOverlayBounds', () => {
  it('sits in the bottom-right corner with a margin', () => {
    expect(defaultOverlayBounds(FULL_HD, 400)).toEqual({ x: 1596, y: 616, width: 300, height: 400 })
  })

  it('works on a monitor that does not start at the origin', () => {
    const bounds = defaultOverlayBounds(SECOND_MONITOR, 400)
    expect(bounds.x + bounds.width).toBe(1920 + 2560 - 24)
    expect(bounds.y + bounds.height).toBe(-200 + 1400 - 24)
  })

  it('never gets taller than the work area', () => {
    const small = { x: 0, y: 0, width: 800, height: 300 }
    expect(defaultOverlayBounds(small, 900).height).toBeLessThanOrEqual(300)
  })
})

describe('clampToWorkArea', () => {
  it('keeps bounds that already fit', () => {
    const bounds = { x: 100, y: 100, width: 300, height: 400 }
    expect(clampToWorkArea(bounds, FULL_HD)).toEqual(bounds)
  })

  it('pulls a window back from beyond the right and bottom edges', () => {
    const bounds = { x: 1800, y: 900, width: 300, height: 400 }
    expect(clampToWorkArea(bounds, FULL_HD)).toEqual({ x: 1620, y: 640, width: 300, height: 400 })
  })

  it('pulls a window back from beyond the left and top edges', () => {
    const bounds = { x: -50, y: -80, width: 300, height: 400 }
    expect(clampToWorkArea(bounds, FULL_HD)).toEqual({ x: 0, y: 0, width: 300, height: 400 })
  })
})

describe('containsPoint', () => {
  const rect = { x: 100, y: 100, width: 300, height: 400 }

  it('includes the top-left edge and excludes the bottom-right edge', () => {
    expect(containsPoint(rect, { x: 100, y: 100 })).toBe(true)
    expect(containsPoint(rect, { x: 399, y: 499 })).toBe(true)
    expect(containsPoint(rect, { x: 400, y: 300 })).toBe(false)
    expect(containsPoint(rect, { x: 200, y: 500 })).toBe(false)
  })
})

describe('dragBounds', () => {
  it('moves the window by how far the cursor moved, keeping its size', () => {
    const start = { x: 100, y: 100, width: 300, height: 400 }
    expect(dragBounds(start, { x: 150, y: 150 }, { x: 110, y: 400.6 })).toEqual({
      x: 60,
      y: 351,
      width: 300,
      height: 400
    })
  })
})

describe('resizeKeepingBase', () => {
  const bounds = { x: 1000, y: 500, width: 300, height: 400 }

  it('grows around the bottom center', () => {
    const grown = resizeKeepingBase(bounds, 1)
    expect(grown.height).toBe(440)
    expect(grown.y + grown.height).toBe(900)
    expect(grown.x + grown.width / 2).toBe(1150)
  })

  it('shrinks with negative steps and stops at the minimum', () => {
    expect(resizeKeepingBase(bounds, -1).height).toBe(364)
    expect(resizeKeepingBase(bounds, -50).height).toBe(OVERLAY_MIN_HEIGHT)
  })
})

describe('companionBounds', () => {
  const corner = { x: 1596, y: 616, width: 300, height: 400 }

  it('puts the question box beside the bottom of the avatar and the bubble above it', () => {
    const { ask, bubble } = companionBounds(corner, FULL_HD, 200)
    expect(ask).toEqual({ x: 1204, y: 928, ...ASK_SIZE })
    expect(bubble).toEqual({ x: 1244, y: 716, width: BUBBLE_WIDTH, height: 200 })
  })

  it('uses the right side when the avatar is at the left edge', () => {
    const { ask, bubble } = companionBounds({ ...corner, x: 24 }, FULL_HD, 200)
    expect(ask.x).toBe(336)
    expect(bubble.x).toBe(336)
  })

  it('puts the bubble below the question box when there is no room above', () => {
    const { ask, bubble } = companionBounds({ ...corner, y: 0 }, FULL_HD, 360)
    expect(ask.y).toBe(312)
    expect(bubble.y).toBe(412)
  })

  it('keeps the bubble height within limits', () => {
    expect(companionBounds(corner, FULL_HD, 5000).bubble.height).toBe(BUBBLE_MAX_HEIGHT)
    expect(companionBounds(corner, FULL_HD, 1).bubble.height).toBe(BUBBLE_MIN_HEIGHT)
  })
})
