import { copyFile, mkdir, open, readdir, readFile, stat, writeFile } from 'fs/promises'
import { basename, dirname, extname, join } from 'path'
import type { AvatarKind } from '../shared/avatar'
import { parsePngTuberManifest } from '../shared/pngtuber-manifest'
import { USER_PNGTUBER_FILE, USER_VRM_FILE, type UserAvatar } from './avatar-library'

/** Written next to each imported avatar, so the library can list it later. */
const INFO_FILE = 'professor-avatar.json'
const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
const MAX_VRM_BYTES = 200 * 1024 * 1024
const MAX_IMAGE_BYTES = 20 * 1024 * 1024

/** Turns a display name into a folder name that is valid in a `user:<slug>` avatar id. */
export function slugify(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'avatar'
  let slug = base
  for (let suffix = 2; taken.has(slug); suffix++) slug = `${base}-${suffix}`
  return slug
}

/** Avatars the student imported before. Folders without a valid info file are skipped. */
export async function listUserAvatars(root: string): Promise<UserAvatar[]> {
  const avatars: UserAvatar[] = []
  for (const slug of await folderNames(root)) {
    try {
      const info: unknown = JSON.parse(await readFile(join(root, slug, INFO_FILE), 'utf-8'))
      if (!isAvatarInfo(info)) continue
      avatars.push({ id: `user:${slug}`, kind: info.kind, name: info.name.slice(0, 64) })
    } catch {
      // Not an imported avatar, or a damaged one: leave it out of the menu.
    }
  }
  return avatars.sort((a, b) => a.name.localeCompare(b.name))
}

/** Copies a .vrm file into the avatar library after checking that it is a glTF 2.0 binary. */
export async function importVrm(root: string, file: string): Promise<UserAvatar> {
  const info = await stat(file)
  if (!info.isFile() || info.size > MAX_VRM_BYTES) {
    throw new Error('Choose a VRM file smaller than 200 MB.')
  }
  if (!(await isGltfBinary(file))) throw new Error('This file is not a VRM model.')

  const name = basename(file, extname(file))
  const slug = slugify(name, new Set(await folderNames(root)))
  const folder = join(root, slug)
  await mkdir(folder, { recursive: true })
  await copyFile(file, join(folder, USER_VRM_FILE))
  await writeInfo(folder, 'vrm', name)
  return { id: `user:${slug}`, kind: 'vrm', name }
}

/**
 * Copies a PNGTuber folder into the avatar library. Only avatar.json and the images it lists
 * are copied, after the manifest passes validation.
 */
export async function importPngTuberFolder(root: string, source: string): Promise<UserAvatar> {
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(join(source, USER_PNGTUBER_FILE), 'utf-8'))
  } catch {
    throw new Error('The folder needs a valid avatar.json file.')
  }
  const manifest = parsePngTuberManifest(raw)
  const images = new Set(
    Object.values(manifest.emotions).flatMap((frames) => [
      frames.idle,
      frames.talking,
      frames.blinking
    ])
  )
  for (const image of images) {
    const info = await stat(join(source, image)).catch(() => null)
    if (!info?.isFile() || info.size > MAX_IMAGE_BYTES) {
      throw new Error(`The image ${image} is missing or larger than 20 MB.`)
    }
  }

  const slug = slugify(manifest.name, new Set(await folderNames(root)))
  const folder = join(root, slug)
  for (const image of images) {
    await mkdir(dirname(join(folder, image)), { recursive: true })
    await copyFile(join(source, image), join(folder, image))
  }
  await copyFile(join(source, USER_PNGTUBER_FILE), join(folder, USER_PNGTUBER_FILE))
  await writeInfo(folder, 'pngtuber', manifest.name)
  return { id: `user:${slug}`, kind: 'pngtuber', name: manifest.name }
}

async function folderNames(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && SLUG_PATTERN.test(entry.name))
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

async function isGltfBinary(file: string): Promise<boolean> {
  const handle = await open(file, 'r')
  try {
    const header = Buffer.alloc(8)
    await handle.read(header, 0, 8, 0)
    return header.toString('ascii', 0, 4) === 'glTF' && header.readUInt32LE(4) === 2
  } finally {
    await handle.close()
  }
}

async function writeInfo(folder: string, kind: AvatarKind, name: string): Promise<void> {
  const info = { kind, name, importedAt: new Date().toISOString() }
  await writeFile(join(folder, INFO_FILE), `${JSON.stringify(info, null, 2)}\n`, 'utf-8')
}

function isAvatarInfo(value: unknown): value is { kind: AvatarKind; name: string } {
  if (typeof value !== 'object' || value === null) return false
  const { kind, name } = value as Record<string, unknown>
  return (kind === 'vrm' || kind === 'pngtuber') && typeof name === 'string' && name.length > 0
}
