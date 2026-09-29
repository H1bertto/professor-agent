import { mkdtemp, readFile, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_SETTINGS } from './settings'
import { SettingsStore } from './settings-store'

let file: string

beforeEach(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'professor-settings-'))
  file = join(directory, 'nested', 'settings.json')
})

describe('SettingsStore', () => {
  it('starts with the defaults when the file does not exist', async () => {
    const store = await SettingsStore.load(file)
    expect(store.get()).toEqual(DEFAULT_SETTINGS)
  })

  it('starts with the defaults when the file is corrupt', async () => {
    const store = await SettingsStore.load(file)
    await store.flush()
    await writeFile(file, '{ not json', 'utf-8')

    expect((await SettingsStore.load(file)).get()).toEqual(DEFAULT_SETTINGS)
  })

  it('saves changes and reads them back', async () => {
    const store = await SettingsStore.load(file)
    const overlayBounds = { x: 1, y: 2, width: 300, height: 400 }

    store.update({ overlayBounds })
    await store.flush()

    expect(JSON.parse(await readFile(file, 'utf-8')).overlayBounds).toEqual(overlayBounds)
    expect((await SettingsStore.load(file)).get().overlayBounds).toEqual(overlayBounds)
  })

  it('returns copies, so callers cannot change the stored settings by accident', async () => {
    const store = await SettingsStore.load(file)
    store.get().avatar.id = 'user:changed'
    expect(store.get().avatar.id).toBe('builtin:seed-san')
  })
})
