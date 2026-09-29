import path from 'path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ net: {}, protocol: {} }))

import { resolveAvatarPath } from './avatar-protocol'

const POSIX_ROOTS = { builtin: '/app/resources/avatars', user: '/home/student/.config/avatars' }
const WINDOWS_ROOTS = {
  builtin: 'C:\\Program Files\\Professor Agent\\resources\\avatars',
  user: 'C:\\Users\\student\\AppData\\Roaming\\professor-agent\\avatars'
}

const posix = (url: string): string | null => resolveAvatarPath(url, POSIX_ROOTS, path.posix)
const windows = (url: string): string | null => resolveAvatarPath(url, WINDOWS_ROOTS, path.win32)

describe('resolveAvatarPath', () => {
  it('maps built-in and user avatars to their folders', () => {
    expect(posix('avatar://builtin/seed-san.vrm')).toBe('/app/resources/avatars/seed-san.vrm')
    expect(posix('avatar://user/my-tutor/avatar.json')).toBe(
      '/home/student/.config/avatars/my-tutor/avatar.json'
    )
    expect(windows('avatar://builtin/chalk/happy.svg')).toBe(
      'C:\\Program Files\\Professor Agent\\resources\\avatars\\chalk\\happy.svg'
    )
  })

  it('decodes escaped characters in file names', () => {
    expect(posix('avatar://user/my%20tutor/model.vrm')).toBe(
      '/home/student/.config/avatars/my tutor/model.vrm'
    )
  })

  it('keeps dot segments inside the root, because the URL parser removes them', () => {
    const inside = '/home/student/.config/avatars/etc/passwd'
    expect(posix('avatar://user/../../etc/passwd')).toBe(inside)
    expect(posix('avatar://user/%2e%2e/%2e%2e/etc/passwd')).toBe(inside)
  })

  it('refuses encoded separators that try to leave the root', () => {
    const attacks = [
      'avatar://user/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
      'avatar://builtin/..%2F..%2Fsecret.txt'
    ]
    for (const url of attacks) expect(posix(url)).toBeNull()
  })

  it('refuses Windows-style escapes', () => {
    expect(windows('avatar://user/..%5C..%5C..%5CWindows%5Cwin.ini')).toBeNull()
    expect(windows('avatar://user/C:%5CWindows%5Cwin.ini')).toBeNull()
  })

  it('refuses unknown hosts, other schemes, the root itself, and null bytes', () => {
    const rejected = [
      'avatar://system/file.txt',
      'file:///etc/passwd',
      'https://example.com/seed-san.vrm',
      'avatar://builtin/',
      'avatar://builtin/seed-san.vrm%00.png',
      'not a url'
    ]
    for (const url of rejected) expect(posix(url)).toBeNull()
  })
})
