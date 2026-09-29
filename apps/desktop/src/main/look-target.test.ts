import { describe, expect, it } from 'vitest'

import { cursorToLookTarget } from './look-target'

const WINDOW = { x: 1000, y: 500, width: 300, height: 400 }
const EYES = { x: 1150, y: 620 }

describe('cursorToLookTarget', () => {
  it('looks straight ahead when the cursor is at the eyes', () => {
    expect(cursorToLookTarget(EYES, WINDOW)).toEqual({ x: 0, y: 0 })
  })

  it('measures distance in window heights', () => {
    expect(cursorToLookTarget({ x: EYES.x + 400, y: EYES.y }, WINDOW)).toEqual({ x: 1, y: 0 })
    expect(cursorToLookTarget({ x: EYES.x, y: EYES.y - 200 }, WINDOW)).toEqual({ x: 0, y: -0.5 })
  })

  it('works for a cursor far away on another monitor', () => {
    const target = cursorToLookTarget({ x: -1920, y: 0 }, WINDOW)
    expect(target.x).toBeLessThan(-7)
    expect(target.y).toBeLessThan(0)
  })
})
