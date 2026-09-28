import { describe, expect, it, vi } from 'vitest'

import { checkCoreHealth, coreBaseUrl, DEFAULT_CORE_PORT } from './core-health'

const BASE_URL = 'http://127.0.0.1:8765'

function fetchReturning(response: Response): typeof fetch {
  return vi.fn(async () => response) as unknown as typeof fetch
}

describe('coreBaseUrl', () => {
  it('uses the default port on localhost', () => {
    expect(coreBaseUrl({})).toBe(`http://127.0.0.1:${DEFAULT_CORE_PORT}`)
  })

  it('uses PROFESSOR_CORE_PORT when it is a number', () => {
    expect(coreBaseUrl({ PROFESSOR_CORE_PORT: '9123' })).toBe('http://127.0.0.1:9123')
  })

  it('ignores an invalid PROFESSOR_CORE_PORT', () => {
    expect(coreBaseUrl({ PROFESSOR_CORE_PORT: '80@evil.example' })).toBe(
      `http://127.0.0.1:${DEFAULT_CORE_PORT}`
    )
  })
})

describe('checkCoreHealth', () => {
  it('reports online with the core version', async () => {
    const fetchImpl = fetchReturning(Response.json({ status: 'ok', version: '0.1.0' }))

    await expect(checkCoreHealth(BASE_URL, fetchImpl)).resolves.toEqual({
      status: 'online',
      version: '0.1.0'
    })
    expect(fetchImpl).toHaveBeenCalledWith(`${BASE_URL}/health`, expect.anything())
  })

  it('reports offline on an HTTP error', async () => {
    const fetchImpl = fetchReturning(new Response('boom', { status: 500 }))

    await expect(checkCoreHealth(BASE_URL, fetchImpl)).resolves.toEqual({
      status: 'offline',
      reason: 'HTTP 500'
    })
  })

  it('reports offline when the body has an unexpected shape', async () => {
    const fetchImpl = fetchReturning(Response.json({ hello: 'world' }))

    await expect(checkCoreHealth(BASE_URL, fetchImpl)).resolves.toMatchObject({
      status: 'offline'
    })
  })

  it('reports offline when the core cannot be reached', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:8765')
    }) as unknown as typeof fetch

    await expect(checkCoreHealth(BASE_URL, fetchImpl)).resolves.toEqual({
      status: 'offline',
      reason: 'connect ECONNREFUSED 127.0.0.1:8765'
    })
  })
})
