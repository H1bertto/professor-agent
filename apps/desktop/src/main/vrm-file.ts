import { open, type FileHandle } from 'fs/promises'

/** Larger JSON chunks are not avatars the app can show, so it does not read them. */
const MAX_JSON_BYTES = 32 * 1024 * 1024
const MAX_THUMBNAIL_BYTES = 8 * 1024 * 1024
const THUMBNAIL_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

/** What the app needs from a VRM file, read without loading the model. */
export interface VrmInfo {
  specVersion: '1.0' | '0.x'
  name: string | null
  authors: string[]
  /** Whether the license lets anyone share the file, which a built-in avatar needs. */
  allowsRedistribution: boolean
  /** Where the thumbnail picture is in the file, if it has one. */
  thumbnail: { offset: number; length: number; mimeType: string } | null
}

interface GltfJson {
  images?: { bufferView?: number; mimeType?: string }[]
  textures?: { source?: number }[]
  bufferViews?: { buffer?: number; byteOffset?: number; byteLength?: number }[]
  extensions?: {
    VRMC_vrm?: { meta?: Record<string, unknown> }
    VRM?: { meta?: Record<string, unknown> }
  }
}

/** Reads the VRM metadata from the JSON chunk of a glTF binary file. */
export async function readVrmInfo(file: string): Promise<VrmInfo> {
  const handle = await open(file, 'r')
  try {
    const { json, binaryStart } = await readJsonChunk(handle)
    return describe(json, binaryStart)
  } finally {
    await handle.close()
  }
}

/** The thumbnail a VRM file carries, as a data URL, or `null` when it has none. */
export async function readVrmThumbnail(file: string): Promise<string | null> {
  const handle = await open(file, 'r')
  try {
    const { json, binaryStart } = await readJsonChunk(handle)
    const { thumbnail } = describe(json, binaryStart)
    if (!thumbnail) return null
    const picture = Buffer.alloc(thumbnail.length)
    const { bytesRead } = await handle.read(picture, 0, thumbnail.length, thumbnail.offset)
    if (bytesRead !== thumbnail.length) return null
    return `data:${thumbnail.mimeType};base64,${picture.toString('base64')}`
  } finally {
    await handle.close()
  }
}

async function readJsonChunk(handle: FileHandle): Promise<{ json: GltfJson; binaryStart: number }> {
  const header = Buffer.alloc(20)
  await handle.read(header, 0, 20, 0)
  if (header.toString('ascii', 0, 4) !== 'glTF' || header.readUInt32LE(4) !== 2) {
    throw new Error('This file is not a VRM model.')
  }
  const length = header.readUInt32LE(12)
  if (header.toString('ascii', 16, 20) !== 'JSON' || length > MAX_JSON_BYTES) {
    throw new Error('This file is not a VRM model.')
  }
  const text = Buffer.alloc(length)
  const { bytesRead } = await handle.read(text, 0, length, 20)
  if (bytesRead !== length) throw new Error('This VRM file is cut short.')
  // The binary chunk follows the JSON chunk and its own 8-byte header.
  return { json: JSON.parse(text.toString('utf-8')) as GltfJson, binaryStart: 20 + length + 8 }
}

function describe(json: GltfJson, binaryStart: number): VrmInfo {
  const vrm1 = json.extensions?.VRMC_vrm?.meta
  if (vrm1) {
    return {
      specVersion: '1.0',
      name: text(vrm1.name),
      authors: Array.isArray(vrm1.authors) ? vrm1.authors.filter(isText) : [],
      allowsRedistribution: vrm1.allowRedistribution === true,
      thumbnail: imageLocation(json, vrm1.thumbnailImage, binaryStart)
    }
  }
  const vrm0 = json.extensions?.VRM?.meta
  if (vrm0) {
    const texture = typeof vrm0.texture === 'number' ? json.textures?.[vrm0.texture] : undefined
    const author = text(vrm0.author)
    return {
      specVersion: '0.x',
      name: text(vrm0.title),
      authors: author ? [author] : [],
      allowsRedistribution:
        typeof vrm0.licenseName === 'string' && vrm0.licenseName !== 'Redistribution_Prohibited',
      thumbnail: imageLocation(json, texture?.source, binaryStart)
    }
  }
  throw new Error('This file is not a VRM model.')
}

function imageLocation(json: GltfJson, index: unknown, binaryStart: number): VrmInfo['thumbnail'] {
  if (typeof index !== 'number') return null
  const image = json.images?.[index]
  const view = typeof image?.bufferView === 'number' ? json.bufferViews?.[image.bufferView] : null
  if (!image?.mimeType || !THUMBNAIL_TYPES.has(image.mimeType) || !view) return null
  const length = view.byteLength ?? 0
  if ((view.buffer ?? 0) !== 0 || length <= 0 || length > MAX_THUMBNAIL_BYTES) return null
  return { offset: binaryStart + (view.byteOffset ?? 0), length, mimeType: image.mimeType }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isText(value: unknown): value is string {
  return typeof value === 'string'
}
