import type { CoreHealth } from '../shared/api'

export const DEFAULT_CORE_PORT = 8765

export function coreBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const port = env.PROFESSOR_CORE_PORT
  const validPort = port && /^\d{1,5}$/.test(port) ? port : String(DEFAULT_CORE_PORT)
  return `http://127.0.0.1:${validPort}`
}

export async function checkCoreHealth(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 2000
): Promise<CoreHealth> {
  try {
    const response = await fetchImpl(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!response.ok) {
      return { status: 'offline', reason: `HTTP ${response.status}` }
    }
    const body: unknown = await response.json()
    if (isHealthBody(body)) {
      return { status: 'online', version: body.version }
    }
    return { status: 'offline', reason: 'Unexpected response from the core' }
  } catch (error) {
    return { status: 'offline', reason: error instanceof Error ? error.message : String(error) }
  }
}

function isHealthBody(body: unknown): body is { status: 'ok'; version: string } {
  if (typeof body !== 'object' || body === null) return false
  const record = body as Record<string, unknown>
  return record.status === 'ok' && typeof record.version === 'string'
}
