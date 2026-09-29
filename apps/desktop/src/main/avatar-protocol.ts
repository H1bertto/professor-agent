import { net, protocol } from 'electron'
import path from 'path'
import { pathToFileURL } from 'url'

export const AVATAR_SCHEME = 'avatar'

/** Folders the overlay may read avatars from. Nothing outside them is ever served. */
export interface AvatarRoots {
  /** Avatars shipped with the app. */
  builtin: string
  /** Avatars the student imported, copied into the app data folder. */
  user: string
}

/** Must run before the app is ready. */
export function registerAvatarScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: AVATAR_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
    }
  ])
}

/**
 * Maps `avatar://builtin/<file>` and `avatar://user/<file>` to a file inside the matching root.
 * Returns null for anything else, including paths that try to leave the root.
 */
export function resolveAvatarPath(
  url: string,
  roots: AvatarRoots,
  pathImpl: path.PlatformPath = path
): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${AVATAR_SCHEME}:`) return null

  const root =
    parsed.hostname === 'builtin' ? roots.builtin : parsed.hostname === 'user' ? roots.user : null
  if (!root) return null

  let relativePath: string
  try {
    relativePath = decodeURIComponent(parsed.pathname)
  } catch {
    return null
  }
  if (relativePath.includes('\0')) return null

  const target = pathImpl.resolve(root, `.${relativePath}`)
  const fromRoot = pathImpl.relative(root, target)
  if (fromRoot === '' || fromRoot.startsWith('..') || pathImpl.isAbsolute(fromRoot)) return null
  return target
}

export function handleAvatarProtocol(roots: AvatarRoots): void {
  protocol.handle(AVATAR_SCHEME, async (request) => {
    const file = resolveAvatarPath(request.url, roots)
    if (!file) return new Response('Not found', { status: 404 })

    let response: Response
    try {
      response = await net.fetch(pathToFileURL(file).toString())
    } catch {
      return new Response('Not found', { status: 404 })
    }
    const headers = new Headers(response.headers)
    // The overlay page reads avatar pixels for hit testing, which needs CORS approval.
    headers.set('Access-Control-Allow-Origin', '*')
    return new Response(response.body, { status: response.status, headers })
  })
}
