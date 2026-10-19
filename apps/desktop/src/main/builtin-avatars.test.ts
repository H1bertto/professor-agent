import { access, readFile } from 'fs/promises'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

import { parsePngTuberManifest } from '../shared/pngtuber-manifest'
import { BUILTIN_AVATARS } from './avatar-library'
import { readVrmInfo, readVrmThumbnail } from './vrm-file'

const RESOURCES = join(__dirname, '..', '..', 'resources', 'avatars')

function builtinFile(url: string): string {
  return join(RESOURCES, url.slice('avatar://builtin/'.length))
}

describe('built-in avatars', () => {
  it.each(BUILTIN_AVATARS.filter((avatar) => avatar.kind === 'pngtuber'))(
    '$name has a manifest and every image it lists',
    async ({ url }) => {
      const file = builtinFile(url)
      const manifest = parsePngTuberManifest(JSON.parse(await readFile(file, 'utf-8')))
      const images = Object.values(manifest.emotions).flatMap((frames) => Object.values(frames))
      expect(images.length).toBeGreaterThan(0)
      for (const image of new Set(images)) await access(join(file, '..', image))
    }
  )

  it.each(BUILTIN_AVATARS.filter((avatar) => avatar.kind === 'vrm'))(
    '$name is a VRM file that may be shared, with a thumbnail',
    async ({ url }) => {
      const file = builtinFile(url)
      const info = await readVrmInfo(file)
      expect(info.allowsRedistribution).toBe(true)
      expect(await readVrmThumbnail(file)).toMatch(/^data:image\/(png|jpeg);base64,/)
    }
  )
})
