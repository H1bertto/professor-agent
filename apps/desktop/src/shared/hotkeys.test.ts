import { describe, expect, it } from 'vitest'

import { acceleratorFor, DEFAULT_TALK_HOTKEY, isTalkHotkey, type KeyPress } from './hotkeys'

const press = (keyCode: number, held: Partial<KeyPress> = {}): KeyPress => ({
  keyCode,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...held
})

describe('talk hotkey', () => {
  it("records Ctrl and the ABNT2 ' key as the key Electron calls `", () => {
    // On the Brazilian ABNT2 layout, ' sits below Esc and has the key code 192.
    expect(acceleratorFor(press(192, { ctrlKey: true }))).toBe(DEFAULT_TALK_HOTKEY)
  })

  it('records letters, digits, and function keys with their modifiers', () => {
    expect(acceleratorFor(press(84, { ctrlKey: true, shiftKey: true }))).toBe(
      'CommandOrControl+Shift+T'
    )
    expect(acceleratorFor(press(55, { altKey: true }))).toBe('Alt+7')
    expect(acceleratorFor(press(119))).toBe('F8')
  })

  it('refuses keys that would take a plain key away from typing', () => {
    expect(acceleratorFor(press(84))).toBeNull()
    expect(acceleratorFor(press(84, { shiftKey: true }))).toBeNull()
    expect(acceleratorFor(press(17, { ctrlKey: true }))).toBeNull()
    expect(acceleratorFor(press(13, { ctrlKey: true }))).toBeNull()
  })

  it('checks saved accelerators', () => {
    expect(isTalkHotkey(DEFAULT_TALK_HOTKEY)).toBe(true)
    expect(isTalkHotkey('Alt+Space')).toBe(true)
    for (const bad of ['T', 'Shift+T', 'Ctrl+T', 'CommandOrControl+Nope', 'Alt+Alt+T', 42, '']) {
      expect(isTalkHotkey(bad), String(bad)).toBe(false)
    }
  })
})
