import type { LookTarget } from '../shared/avatar'
import type { Rect } from './window-bounds'

/** Height of the avatar's eyes in the bust shot, as a fraction of the window height. */
const EYE_LINE = 0.3

/** Where the avatar should look to face the cursor, in window heights from its eyes. */
export function cursorToLookTarget(cursor: { x: number; y: number }, window: Rect): LookTarget {
  return {
    x: (cursor.x - (window.x + window.width / 2)) / window.height,
    y: (cursor.y - (window.y + window.height * EYE_LINE)) / window.height
  }
}
