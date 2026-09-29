import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it } from 'vitest'

import { importPngTuberFolder, importVrm, listUserAvatars, slugify } from './user-avatars'

let root: string
let source: string

beforeEach(async () => {
  const base = await mkdtemp(join(tmpdir(), 'professor-avatars-'))
  root = join(base, 'library')
  source = join(base, 'source')
  await mkdir(source)
})

/** The smallest file that looks like a glTF 2.0 binary. */
function glbHeader(): Buffer {
  const header = Buffer.alloc(12)
  header.write('glTF', 0, 'ascii')
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12, 8)
  return header
}

async function writePngTuber(manifest: object, images: string[]): Promise<void> {
  await writeFile(join(source, 'avatar.json'), JSON.stringify(manifest))
  for (const image of images) {
    await mkdir(join(source, image, '..'), { recursive: true })
    await writeFile(join(source, image), 'image')
  }
}

describe('slugify', () => {
  it('makes a lowercase folder name without accents or spaces', () => {
    expect(slugify('Professora Ana Júlia!', new Set())).toBe('professora-ana-julia')
  })

  it('adds a number when the name is taken', () => {
    expect(slugify('Chalk', new Set(['chalk', 'chalk-2']))).toBe('chalk-3')
  })

  it('uses a default for names without letters or digits', () => {
    expect(slugify('✨✨', new Set())).toBe('avatar')
  })
})

describe('importVrm', () => {
  it('copies the model into its own folder and lists it', async () => {
    const file = join(source, 'My Tutor.vrm')
    await writeFile(file, glbHeader())

    const avatar = await importVrm(root, file)

    expect(avatar).toEqual({ id: 'user:my-tutor', kind: 'vrm', name: 'My Tutor' })
    expect(await readdir(join(root, 'my-tutor'))).toContain('model.vrm')
    expect(await listUserAvatars(root)).toEqual([avatar])
  })

  it('refuses files that are not glTF binaries', async () => {
    const file = join(source, 'fake.vrm')
    await writeFile(file, 'not a model')
    await expect(importVrm(root, file)).rejects.toThrow(/not a VRM/)
  })
})

describe('importPngTuberFolder', () => {
  const manifest = {
    format: 'professor-agent/pngtuber',
    version: 1,
    name: 'Sketch',
    emotions: { neutral: { idle: 'neutral.png', talking: 'faces/talk.png' } }
  }

  it('copies avatar.json and only the images it lists', async () => {
    await writePngTuber(manifest, ['neutral.png', 'faces/talk.png'])
    await writeFile(join(source, 'notes.txt'), 'not copied')

    const avatar = await importPngTuberFolder(root, source)

    expect(avatar).toEqual({ id: 'user:sketch', kind: 'pngtuber', name: 'Sketch' })
    const folder = join(root, 'sketch')
    expect((await readdir(folder)).sort()).toEqual([
      'avatar.json',
      'faces',
      'neutral.png',
      'professor-avatar.json'
    ])
    expect(await readFile(join(folder, 'faces', 'talk.png'), 'utf-8')).toBe('image')
  })

  it('refuses a folder when a listed image is missing', async () => {
    await writePngTuber(manifest, ['neutral.png'])
    await expect(importPngTuberFolder(root, source)).rejects.toThrow(/faces\/talk.png/)
  })

  it('refuses a folder without avatar.json', async () => {
    await expect(importPngTuberFolder(root, source)).rejects.toThrow(/avatar.json/)
  })
})

describe('listUserAvatars', () => {
  it('returns nothing when the library does not exist yet', async () => {
    expect(await listUserAvatars(join(root, 'missing'))).toEqual([])
  })

  it('skips folders without a valid info file', async () => {
    await mkdir(join(root, 'stray'), { recursive: true })
    await mkdir(join(root, 'broken'), { recursive: true })
    await writeFile(join(root, 'broken', 'professor-avatar.json'), '{ "kind": "live2d" }')
    expect(await listUserAvatars(root)).toEqual([])
  })
})
