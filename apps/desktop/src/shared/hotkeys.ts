// The talk hotkey, as Electron accelerators. Electron registers global shortcuts by Windows key
// code, and Chromium gives that same code in KeyboardEvent.keyCode. So a shortcut recorded from
// keyCode works on any keyboard layout, while the character on the key would not: on the
// Brazilian ABNT2 layout, ' is the key Electron calls `.

/** Ctrl and the key below Esc, which types ' on the Brazilian ABNT2 layout. */
export const DEFAULT_TALK_HOTKEY = 'CommandOrControl+`'
export const DEFAULT_TALK_HOTKEY_LABEL = "Ctrl + ' (the key below Esc)"

const PUNCTUATION: Record<number, string> = {
  186: ';',
  187: '=',
  188: ',',
  189: '-',
  190: '.',
  191: '/',
  192: '`',
  219: '[',
  220: '\\',
  221: ']',
  222: "'"
}
const MODIFIERS = ['CommandOrControl', 'Alt', 'Shift', 'Super'] as const

/** The accelerator name of a Windows key code, or `null` for keys a shortcut cannot use. */
function keyName(keyCode: number): string | null {
  if (keyCode >= 65 && keyCode <= 90) return String.fromCharCode(keyCode)
  if (keyCode >= 48 && keyCode <= 57) return String.fromCharCode(keyCode)
  if (keyCode >= 112 && keyCode <= 135) return `F${keyCode - 111}`
  if (keyCode === 32) return 'Space'
  return PUNCTUATION[keyCode] ?? null
}

const KEY_NAMES = new Set(
  [
    ...Array.from({ length: 26 }, (_, i) => 65 + i),
    ...Array.from({ length: 10 }, (_, i) => 48 + i),
    ...Array.from({ length: 24 }, (_, i) => 112 + i),
    32,
    ...Object.keys(PUNCTUATION).map(Number)
  ].map((code) => keyName(code))
)

export interface KeyPress {
  keyCode: number
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

/** The accelerator for a key press, or `null` when it cannot be a shortcut. */
export function acceleratorFor(press: KeyPress): string | null {
  const key = keyName(press.keyCode)
  if (!key) return null
  const modifiers = [
    press.ctrlKey && 'CommandOrControl',
    press.altKey && 'Alt',
    press.shiftKey && 'Shift',
    press.metaKey && 'Super'
  ].filter((modifier): modifier is string => Boolean(modifier))
  const accelerator = [...modifiers, key].join('+')
  return isTalkHotkey(accelerator) ? accelerator : null
}

/**
 * A shortcut needs Ctrl, Alt, or the Windows key, so it never takes a plain key away from the
 * student's typing. Function keys may stand alone.
 */
export function isTalkHotkey(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 64) return false
  const parts = value.split('+')
  const key = parts.pop()
  if (!key || !KEY_NAMES.has(key)) return false
  if (new Set(parts).size !== parts.length) return false
  if (!parts.every((part) => (MODIFIERS as readonly string[]).includes(part))) return false
  const held = parts.some((part) => part !== 'Shift')
  return held || /^F\d+$/.test(key)
}
