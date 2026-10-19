import { mkdtemp, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeAll, describe, expect, it } from 'vitest'

import { readVrmInfo, readVrmThumbnail } from './vrm-file'

let folder: string

beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'professor-vrm-'))
})

/** A glTF binary file with this JSON and a binary chunk that holds `picture` after `skip` bytes. */
async function glb(
  name: string,
  json: object,
  picture = Buffer.from('PNG!'),
  skip = 4
): Promise<string> {
  const pad = (data: Buffer, fill: number): Buffer =>
    Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4, fill)])
  const text = pad(Buffer.from(JSON.stringify(json)), 0x20)
  const binary = pad(Buffer.concat([Buffer.alloc(skip), picture]), 0)
  const chunk = (data: Buffer, type: string): Buffer => {
    const header = Buffer.alloc(8)
    header.writeUInt32LE(data.length, 0)
    header.write(type, 4, 'ascii')
    return Buffer.concat([header, data])
  }
  const header = Buffer.alloc(12)
  header.write('glTF', 0, 'ascii')
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 16 + text.length + binary.length, 8)
  const file = join(folder, name)
  await writeFile(file, Buffer.concat([header, chunk(text, 'JSON'), chunk(binary, 'BIN\0')]))
  return file
}

const PICTURE_VIEW = {
  images: [{ bufferView: 0, mimeType: 'image/png' }],
  bufferViews: [{ buffer: 0, byteOffset: 4, byteLength: 4 }]
}

describe('readVrmInfo and readVrmThumbnail', () => {
  it('reads a VRM 1.0 file and its thumbnail', async () => {
    const file = await glb('one.vrm', {
      ...PICTURE_VIEW,
      extensions: {
        VRMC_vrm: {
          meta: { name: 'Owl', authors: ['Someone'], allowRedistribution: true, thumbnailImage: 0 }
        }
      }
    })
    expect(await readVrmInfo(file)).toMatchObject({
      specVersion: '1.0',
      name: 'Owl',
      authors: ['Someone'],
      allowsRedistribution: true
    })
    expect(await readVrmThumbnail(file)).toBe(
      `data:image/png;base64,${Buffer.from('PNG!').toString('base64')}`
    )
  })

  it('reads a VRM 0.x file, whose thumbnail is a texture', async () => {
    const file = await glb('zero.vrm', {
      ...PICTURE_VIEW,
      textures: [{ source: 0 }],
      extensions: {
        VRM: { meta: { title: 'Old', author: 'Maker', licenseName: 'CC_BY', texture: 0 } }
      }
    })
    expect(await readVrmInfo(file)).toMatchObject({
      specVersion: '0.x',
      name: 'Old',
      authors: ['Maker'],
      allowsRedistribution: true
    })
    expect(await readVrmThumbnail(file)).toMatch(/^data:image\/png;base64,/)
  })

  it('reports what the license does not allow, and a missing thumbnail', async () => {
    const one = await glb('closed.vrm', {
      extensions: { VRMC_vrm: { meta: { name: 'Mine', allowRedistribution: false } } }
    })
    const zero = await glb('closed-zero.vrm', {
      extensions: { VRM: { meta: { title: 'Mine', licenseName: 'Redistribution_Prohibited' } } }
    })
    expect((await readVrmInfo(one)).allowsRedistribution).toBe(false)
    expect((await readVrmInfo(zero)).allowsRedistribution).toBe(false)
    expect(await readVrmThumbnail(one)).toBeNull()
  })

  it('refuses files that are not VRM models', async () => {
    const plain = join(folder, 'plain.vrm')
    await writeFile(plain, 'not a model at all, just some text')
    await expect(readVrmInfo(plain)).rejects.toThrow('not a VRM model')
    const gltf = await glb('plain.glb', { asset: { version: '2.0' } })
    await expect(readVrmInfo(gltf)).rejects.toThrow('not a VRM model')
  })
})
