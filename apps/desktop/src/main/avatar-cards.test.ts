import { mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ net: {}, protocol: {} }))

import { avatarCards } from './avatar-cards'
import { avatarOptions, type UserAvatar } from './avatar-library'

const BUILTIN = join(__dirname, '..', '..', 'resources', 'avatars')

describe('avatarCards', () => {
  it('shows each avatar with a picture: the neutral image, or the VRM thumbnail', async () => {
    const roots = { builtin: BUILTIN, user: await mkdtemp(join(tmpdir(), 'professor-cards-')) }
    const cards = await avatarCards(avatarOptions([]), [], roots)
    const byId = new Map(cards.map((card) => [card.id, card]))

    expect(byId.get('builtin:hoot')).toEqual({
      id: 'builtin:hoot',
      kind: 'pngtuber',
      name: 'Hoot',
      builtin: true,
      thumbnail: 'avatar://builtin/hoot/neutral.svg'
    })
    expect(byId.get('builtin:hoot-3d')?.thumbnail).toMatch(/^data:image\/png;base64,/)
  })

  it('shows an imported avatar whose files are gone without a picture', async () => {
    const roots = { builtin: BUILTIN, user: await mkdtemp(join(tmpdir(), 'professor-cards-')) }
    const missing: UserAvatar[] = [{ id: 'user:gone', kind: 'vrm', name: 'Gone' }]
    const [card] = await avatarCards(missing, missing, roots)
    expect(card).toEqual({
      id: 'user:gone',
      kind: 'vrm',
      name: 'Gone',
      builtin: false,
      thumbnail: null
    })
  })
})
