import { describe, expect, it, vi } from 'vitest'
import {
  AdminApiError,
  callAdmin,
  fetchAdminIdentity,
  SESSION_NSID,
} from '@/lib/api/admin-client'
import type { PdsSession } from '@/lib/auth/pds'

const SERVICE = 'https://pds.test'
const session: PdsSession = {
  service: SERVICE,
  did: 'did:plc:alice',
  handle: 'alice.test',
  accessJwt: 'access-1',
  refreshJwt: 'refresh-1',
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

interface Route {
  method: string
  path: string
  reply: (url: URL, init?: RequestInit) => Response
}

function mockFetch(routes: Route[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    const route = routes.find((item) => item.method === method && url.pathname === item.path)
    if (!route) throw new Error(`unexpected request ${method} ${url.pathname}`)
    return route.reply(url, init)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const serviceAuth = (reply: Route['reply']): Route => ({
  method: 'GET',
  path: '/xrpc/com.atproto.server.getServiceAuth',
  reply,
})

const refresh = (reply: Route['reply']): Route => ({
  method: 'POST',
  path: '/xrpc/com.atproto.server.refreshSession',
  reply,
})

const identity = (reply: Route['reply']): Route => ({
  method: 'GET',
  path: `/xrpc/${SESSION_NSID}`,
  reply,
})

describe('admin api client', () => {
  it('mints a service token per call and returns the parsed identity', async () => {
    const fetchMock = mockFetch([
      serviceAuth(() => jsonResponse({ token: 'service-jwt' })),
      identity(() => jsonResponse({ did: 'did:plc:alice', role: 'admin', permissions: ['role.read'] })),
    ])

    const result = await fetchAdminIdentity(session)

    expect(result.identity).toEqual({
      did: 'did:plc:alice',
      role: 'admin',
      permissions: ['role.read'],
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url, init] = fetchMock.mock.calls[1]!
    expect(String(url)).toBe(`http://127.0.0.1:2587/xrpc/${SESSION_NSID}`)
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer service-jwt')
  })

  it('refreshes once on 401, persists rotated tokens and retries', async () => {
    let accessCalls = 0
    const fetchMock = mockFetch([
      serviceAuth(() => {
        accessCalls += 1
        return accessCalls === 1
          ? jsonResponse({ error: 'ExpiredToken' }, 401)
          : jsonResponse({ token: 'service-jwt-2' })
      }),
      refresh(() =>
        jsonResponse({
          did: 'did:plc:alice',
          handle: 'alice.test',
          accessJwt: 'access-2',
          refreshJwt: 'refresh-2',
        }),
      ),
      identity(() => jsonResponse({ did: 'did:plc:alice', role: 'viewer', permissions: ['directory.read'] })),
    ])
    const onSession = vi.fn()

    const result = await fetchAdminIdentity(session, onSession)

    expect(result.session.accessJwt).toBe('access-2')
    expect(onSession).toHaveBeenCalledWith(expect.objectContaining({ accessJwt: 'access-2' }))
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('surfaces unauthorized after a single failed refresh', async () => {
    const fetchMock = mockFetch([
      serviceAuth(() => jsonResponse({ error: 'ExpiredToken' }, 401)),
      refresh(() => jsonResponse({ error: 'ExpiredToken' }, 401)),
    ])

    await expect(fetchAdminIdentity(session)).rejects.toMatchObject({ kind: 'unauthorized' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('maps forbidden, conflict, validation and server responses', async () => {
    const cases: Array<{ status: number; kind: string; headers?: Record<string, string> }> = [
      { status: 403, kind: 'forbidden' },
      { status: 409, kind: 'conflict' },
      { status: 400, kind: 'validation' },
      { status: 500, kind: 'server', headers: { 'x-request-id': 'req-42' } },
    ]

    for (const item of cases) {
      mockFetch([
        serviceAuth(() => jsonResponse({ token: 'service-jwt' })),
        identity(() =>
          jsonResponse({ error: 'Failure', message: 'internal detail' }, item.status, item.headers),
        ),
      ])
      const error = await fetchAdminIdentity(session).catch((cause: unknown) => cause)
      expect(error).toBeInstanceOf(AdminApiError)
      expect((error as AdminApiError).kind).toBe(item.kind)
      expect((error as AdminApiError).requestId).toBe(item.headers?.['x-request-id'] ?? null)
      expect((error as Error).message).not.toContain('internal detail')
    }
  })

  it('reports network failures as a retryable network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline')
      }),
    )

    await expect(callAdmin(session, SESSION_NSID)).rejects.toMatchObject({ kind: 'network' })
  })
})
