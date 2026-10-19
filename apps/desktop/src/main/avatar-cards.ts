import { readFile, stat } from 'fs/promises'
import type { AvatarCard } from '../shared/api'
import type { AvatarKind } from '../shared/avatar'
import { parsePngTuberManifest } from '../shared/pngtuber-manifest'
import { resolveAvatarConfig, type AvatarOption, type UserAvatar } from './avatar-library'
import { resolveAvatarPath, type AvatarRoots } from './avatar-protocol'
import { readVrmThumbnail } from './vrm-file'

/** Thumbnails by file and change time, since reading a large VRM file takes a moment. */
const thumbnails = new Map<string, Promise<string | null>>()

/** The avatars with a picture of each, for the settings window. */
export async function avatarCards(
  options: readonly AvatarOption[],
  userAvatars: readonly UserAvatar[],
  roots: AvatarRoots
): Promise<AvatarCard[]> {
  return Promise.all(
    options.map(async ({ id, kind, name }) => {
      const { url } = resolveAvatarConfig({ kind, id }, userAvatars)
      return {
        id,
        kind,
        name,
        builtin: id.startsWith('builtin:'),
        thumbnail: await thumbnailFor(kind, url, roots)
      }
    })
  )
}

async function thumbnailFor(
  kind: AvatarKind,
  url: string,
  roots: AvatarRoots
): Promise<string | null> {
  const file = resolveAvatarPath(url, roots)
  if (!file) return null
  let key: string
  try {
    key = `${file}:${(await stat(file)).mtimeMs}`
  } catch {
    return null
  }
  if (!thumbnails.has(key)) {
    const reading = kind === 'vrm' ? readVrmThumbnail(file) : pngTuberThumbnail(file, url)
    // An avatar without a picture still shows, with a placeholder.
    thumbnails.set(
      key,
      reading.catch(() => null)
    )
  }
  return thumbnails.get(key)!
}

/** The neutral idle image, which the settings window loads through the avatar protocol. */
async function pngTuberThumbnail(file: string, url: string): Promise<string> {
  const manifest = parsePngTuberManifest(JSON.parse(await readFile(file, 'utf-8')))
  return new URL(manifest.emotions.neutral.idle, url).href
}
