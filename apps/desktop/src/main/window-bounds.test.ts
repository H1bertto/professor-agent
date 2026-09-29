import { describe, expect, it } from 'vitest'

import {
  clampToWorkArea,
  defaultOverlayBounds,
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
