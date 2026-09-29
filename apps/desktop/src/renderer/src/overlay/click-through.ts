export interface ClickThroughOptions {
  /** Called when the overlay should start or stop catching the mouse. */
  onChange(interactive: boolean): void
  /** How long the cursor must stay off the avatar before clicks pass through again. */
  releaseDelayMs?: number
  now?: () => number
}

export interface ClickThroughController {
  /** Report, once per frame, whether the cursor is over the avatar. */
  update(overAvatar: boolean): void
  /** Keeps the overlay interactive, for example during a drag. */
  hold(held: boolean): void
  readonly interactive: boolean
}

/** Where and when a pointer was pressed or released, in screen pixels and milliseconds. */
export interface PointerMark {
  x: number
  y: number
  time: number
}

/**
 * A press that ends close to where it started, and quickly, is a click rather than a drag. It
 * uses screen positions, because the window moves with the cursor during a drag.
 */
export function isClick(
  start: PointerMark,
  end: PointerMark,
  { maxDistance = 4, maxDurationMs = 300 } = {}
): boolean {
  return (
    Math.hypot(end.x - start.x, end.y - start.y) < maxDistance &&
    end.time - start.time < maxDurationMs
  )
}

/**
 * Decides when the overlay catches the mouse. It turns on at once when the cursor reaches the
 * avatar, and turns off only after the cursor has been away for a moment, so edges and fast
 * movements do not make it flicker.
 */
export function createClickThroughController(options: ClickThroughOptions): ClickThroughController {
  const { onChange, releaseDelayMs = 150, now = () => performance.now() } = options
  let interactive = false
  let held = false
  let awaySince: number | null = null

  const setInteractive = (value: boolean): void => {
    if (value === interactive) return
    interactive = value
    onChange(value)
  }

  return {
    update(overAvatar) {
      if (overAvatar || held) {
        awaySince = null
        setInteractive(true)
        return
      }
      if (!interactive) return
      awaySince ??= now()
      if (now() - awaySince >= releaseDelayMs) {
        awaySince = null
        setInteractive(false)
      }
    },
    hold(value) {
      held = value
      if (held) this.update(true)
    },
    get interactive() {
      return interactive
    }
  }
}
