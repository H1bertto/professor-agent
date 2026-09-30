import { describe, expect, it, vi } from 'vitest'

import { createClickThroughController, isClick } from './click-through'

describe('isClick', () => {
  const start = { x: 100, y: 100, time: 0 }

  it('accepts a short press that barely moves', () => {
    expect(isClick(start, { x: 102, y: 101, time: 120 })).toBe(true)
  })

  it('treats movement or a long press as something else', () => {
    expect(isClick(start, { x: 110, y: 100, time: 120 })).toBe(false)
    expect(isClick(start, { x: 100, y: 100, time: 600 })).toBe(false)
  })
})

function setup(): {
  controller: ReturnType<typeof createClickThroughController>
  onChange: ReturnType<typeof vi.fn>
  advance: (ms: number) => void
} {
  let time = 0
  const onChange = vi.fn()
  const controller = createClickThroughController({
    onChange,
    releaseDelayMs: 150,
    now: () => time
  })
  return { controller, onChange, advance: (ms) => (time += ms) }
}

describe('createClickThroughController', () => {
  it('starts with clicks passing through', () => {
    const { controller, onChange } = setup()
    controller.update(false)
    expect(controller.interactive).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('catches the mouse as soon as the cursor reaches the avatar', () => {
    const { controller, onChange } = setup()
    controller.update(true)
    expect(controller.interactive).toBe(true)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('waits before letting clicks pass through again', () => {
    const { controller, onChange, advance } = setup()
    controller.update(true)
    controller.update(false)
    advance(100)
    controller.update(false)
    expect(controller.interactive).toBe(true)

    advance(60)
    controller.update(false)
    expect(controller.interactive).toBe(false)
    expect(onChange).toHaveBeenLastCalledWith(false)
  })

  it('does not flicker when the cursor brushes the edge of the avatar', () => {
    const { controller, onChange, advance } = setup()
    for (let i = 0; i < 10; i++) {
      controller.update(i % 2 === 0)
      advance(30)
    }
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('stays interactive while held, even off the avatar', () => {
    const { controller, advance } = setup()
    controller.hold(true)
    advance(1000)
    controller.update(false)
    expect(controller.interactive).toBe(true)

    controller.hold(false)
    controller.update(false)
    advance(200)
    controller.update(false)
    expect(controller.interactive).toBe(false)
  })
})
