import { describe, expect, it, vi } from 'vitest'
import {
  createPdsSession,
  deletePdsSession,
  getServiceAuthToken,
  normalizePdsUrl,
  PdsAuthError,
  refreshPdsSession,
  type PdsSession,
} from '@/lib/auth/pds'

const SERVICE = 'https://pds.test'

const SESSION_BODY = {
  did: 'did:plc:alice',
  handle: 'alice.test',
  accessJwt: 'access-1',
  refreshJwt: 'refresh-1',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function mockFetch(handler: (url: URL, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(handler)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const stored: PdsSession = {
  service: SERVICE,
  did: 'did:plc:alice',
  handle: 'alice.test',
  accessJwt: 'access-1',
  refreshJwt: 'refresh-1',
}

describe('PDS URL normalization', () => {
  it('accepts hosts without a scheme and strips paths and trailing slashes', () => {
    expect(normalizePdsUrl('pds.example.com')).toBe('https://pds.example.com')
    expect(normalizePdsUrl('https://pds.example.com/')).toBe('https://pds.example.com')
    expect(normalizePdsUrl('http://127.0.0.1:2583/path')).toBe('http://127.0.0.1:2583')
  })

  it('rejects empty, non-http and credential-bearing URLs', () => {
    for (const value of ['', 'ftp://pds.example.com', 'https://user:pass@pds.example.com']) {
      expect(() => normalizePdsUrl(value)).toThrowError(PdsAuthError)
    }
  })
})

describe('PDS session endpoints', () => {
  it('creates a session from the official createSession response', async () => {
    const fetchMock = mockFetch(async () => jsonResponse({ ...SESSION_BODY, email: 'a@b.c' }))

    const session = await createPdsSession({
      service: 'pds.test',
      identifier: 'alice.test',
      password: 'app-password',
    })

    expect(session).toEqual({ service: SERVICE, ...SESSION_BODY })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('https://pds.test/xrpc/com.atproto.server.createSession')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      identifier: 'alice.test',
      password: 'app-password',
    })
  })

  it('maps rejected credentials to a generic invalid_credentials error', async () => {
    mockFetch(async () => jsonResponse({ error: 'AuthenticationRequired' }, 401))

    await expect(
      createPdsSession({ service: SERVICE, identifier: 'alice.test', password: 'wrong' }),
    ).rejects.toMatchObject({ reason: 'invalid_credentials' })
  })

  it('reports network failures without leaking request details', async () => {
    mockFetch(async () => {
      throw new TypeError('fetch failed')
    })

    await expect(
      createPdsSession({ service: SERVICE, identifier: 'alice.test', password: 'pw' }),
    ).rejects.toMatchObject({ reason: 'network' })
  })

  it('rejects responses that are missing session tokens', async () => {
    mockFetch(async () => jsonResponse({ did: 'did:plc:alice' }))
    await expect(
      createPdsSession({ service: SERVICE, identifier: 'alice.test', password: 'pw' }),
    ).rejects.toMatchObject({ reason: 'invalid_response' })
  })

  it('refreshes with the refresh token and returns rotated tokens', async () => {
    const fetchMock = mockFetch(async () =>
      jsonResponse({ ...SESSION_BODY, accessJwt: 'access-2', refreshJwt: 'refresh-2' }),
    )

    const next = await refreshPdsSession(stored)

    expect(next.accessJwt).toBe('access-2')
    expect(next.refreshJwt).toBe('refresh-2')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('https://pds.test/xrpc/com.atproto.server.refreshSession')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer refresh-1')
  })

  it('treats a rejected refresh as an expired session', async () => {
    mockFetch(async () => jsonResponse({ error: 'ExpiredToken' }, 401))
    await expect(refreshPdsSession(stored)).rejects.toMatchObject({ reason: 'session_expired' })
  })

  it('requests a service token with aud and lxm and the access token', async () => {
    const fetchMock = mockFetch(async () => jsonResponse({ token: 'service-jwt' }))

    const token = await getServiceAuthToken(stored, {
      aud: 'did:web:localhost%3A2587',
      lxm: 'com.selfcommand.admin.session.get',
    })

    expect(token).toBe('service-jwt')
    const [url, init] = fetchMock.mock.calls[0]!
    const parsed = new URL(String(url))
    expect(parsed.pathname).toBe('/xrpc/com.atproto.server.getServiceAuth')
    expect(parsed.searchParams.get('aud')).toBe('did:web:localhost%3A2587')
    expect(parsed.searchParams.get('lxm')).toBe('com.selfcommand.admin.session.get')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer access-1')
  })

  it('deletes the remote session on logout and tolerates an unreachable PDS', async () => {
    const fetchMock = mockFetch(async () => new Response(null, { status: 200 }))
    await deletePdsSession(stored)
    expect(String(fetchMock.mock.calls[0]![0])).toContain('com.atproto.server.deleteSession')

    mockFetch(async () => {
      throw new TypeError('offline')
    })
    await expect(deletePdsSession(stored)).resolves.toBeUndefined()
  })
})
