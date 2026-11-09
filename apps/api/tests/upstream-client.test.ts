import { LexServerError } from '@atproto/lex-server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { silentLogger } from '../src/logger.js'
import {
  callUpstream,
  createAppviewClient,
  createOzoneClient,
  createXrpcClient,
} from '../src/upstream/client.js'

const baseOptions = {
  name: 'Ozone',
  baseUrl: 'http://ozone.test',
  timeoutMs: 2000,
  maxBytes: 1024 * 1024,
  logger: silentLogger,
}

function stubFetch(response: Response | (() => Response)) {
  const make = typeof response === 'function' ? response : () => response.clone()
  const fetchMock = vi.fn(async () => make())
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function jwt(expiresInSeconds: number): string {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expiresInSeconds }),
  ).toString('base64url')
  return `e30.${payload}.signature`
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('xrpc client configuration', () => {
  it('fails with NotConfigured before touching the network when no credential is configured', async () => {
    const fetchMock = stubFetch(new Response('{}'))
    const client = createXrpcClient({ ...baseOptions })

    expect(client.configured).toBe(false)
    await expect(callUpstream(client, 'tools.ozone.report.getLiveStats')).rejects.toMatchObject({
      status: 503,
      body: { error: 'NotConfigured' },
    })
    await expect(client.probe('tools.ozone.report.getLiveStats')).resolves.toEqual({
      status: 'unavailable',
      detail: '未配置管理员凭据',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('treats the AppView client as configured and sends no authorization header', async () => {
    const fetchMock = stubFetch(new Response(JSON.stringify({ posts: [] })))
    const appview = createAppviewClient(
      { appviewUrl: 'http://appview.test', appviewTimeoutMs: 2000, appviewMaxBytes: 1024 },
      silentLogger,
    )

    expect(appview.configured).toBe(true)
    await expect(callUpstream(appview, 'app.bsky.feed.searchPosts', { params: { q: '社区' } })).resolves.toEqual({
      posts: [],
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(url)).toBe('http://appview.test/xrpc/app.bsky.feed.searchPosts?q=%E7%A4%BE%E5%8C%BA')
    expect((init.headers as Record<string, string>).authorization).toBeUndefined()
  })

  it('leaves the Ozone client unconfigured without an admin password', () => {
    const client = createOzoneClient(
      { ozoneUrl: 'http://ozone.test', ozoneTimeoutMs: 2000, ozoneMaxBytes: 1024 },
      silentLogger,
    )
    expect(client.configured).toBe(false)
  })

  it('sends the basic authorization header and serializes query parameters and bodies', async () => {
    const fetchMock = stubFetch(new Response(JSON.stringify({ ok: true })))
    const client = createXrpcClient({ ...baseOptions, authorization: 'Basic c2VjcmV0' })

    await callUpstream(client, 'tools.ozone.report.queryReports', {
      params: { status: 'open', reportTypes: ['a', 'b'], limit: 5, cursor: undefined },
    })
    const [getUrl, getInit] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(getInit.method).toBe('GET')
    expect(getUrl.searchParams.getAll('reportTypes')).toEqual(['a', 'b'])
    expect(getUrl.searchParams.get('status')).toBe('open')
    expect(getUrl.searchParams.has('cursor')).toBe(false)
    expect((getInit.headers as Record<string, string>).authorization).toBe('Basic c2VjcmV0')

    await callUpstream(client, 'tools.ozone.moderation.emitEvent', {
      method: 'POST',
      body: { event: { $type: 'x' } },
    })
    const [, postInit] = fetchMock.mock.calls[1] as unknown as [URL, RequestInit]
    expect(postInit.method).toBe('POST')
    expect((postInit.headers as Record<string, string>)['content-type']).toBe('application/json')
    expect(postInit.body).toBe(JSON.stringify({ event: { $type: 'x' } }))
  })
})

describe('moderator service auth routing', () => {
  const matchesInbox = (nsid: string) => nsid.startsWith('tools.ozone.inbox.')

  it('uses a moderator service token for inbox methods and basic auth elsewhere', async () => {
    const fetchMock = stubFetch(new Response(JSON.stringify({ notifications: [] })))
    const token = vi.fn(async () => 'service-token')
    const serviceAuth = {
      configured: true,
      matches: matchesInbox,
      token,
      invalidate: vi.fn(),
    }
    const client = createXrpcClient({
      ...baseOptions,
      authorization: 'Basic c2VjcmV0',
      serviceAuth,
    })

    await callUpstream(client, 'tools.ozone.inbox.listNotifications', {
      params: { did: 'did:plc:account' },
    })
    const [inboxUrl, inboxInit] = fetchMock.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ]
    expect(inboxUrl.pathname).toBe('/xrpc/tools.ozone.inbox.listNotifications')
    expect((inboxInit.headers as Record<string, string>).authorization).toBe(
      'Bearer service-token',
    )

    await callUpstream(client, 'tools.ozone.setting.listOptions', {
      params: { scope: 'instance' },
    })
    const [, settingsInit] = fetchMock.mock.calls[1] as unknown as [
      URL,
      RequestInit,
    ]
    expect((settingsInit.headers as Record<string, string>).authorization).toBe(
      'Basic c2VjcmV0',
    )
    expect(token).toHaveBeenCalledTimes(1)
  })

  it('invalidates the cached token and retries once after a 401', async () => {
    const responses = [
      new Response(JSON.stringify({ error: 'MissingJwt' }), { status: 401 }),
      new Response(JSON.stringify({ unreadCounts: { total: 0 } })),
    ]
    const fetchMock = stubFetch(() => responses.shift() ?? new Response('{}'))
    const invalidate = vi.fn()
    const serviceAuth = {
      configured: true,
      matches: matchesInbox,
      token: vi.fn(async () => 'service-token'),
      invalidate,
    }
    const client = createXrpcClient({
      ...baseOptions,
      authorization: 'Basic c2VjcmV0',
      serviceAuth,
    })

    await expect(
      callUpstream(client, 'tools.ozone.inbox.getUnreadCount', {
        params: { did: 'did:plc:account' },
      }),
    ).resolves.toEqual({ unreadCounts: { total: 0 } })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(invalidate).toHaveBeenCalledWith('tools.ozone.inbox.getUnreadCount')
    expect(serviceAuth.token).toHaveBeenCalledTimes(2)
  })

  it('reports a missing moderator session before touching the network', async () => {
    const fetchMock = stubFetch(new Response('{}'))
    const serviceAuth = {
      configured: false,
      matches: matchesInbox,
      token: vi.fn(),
      invalidate: vi.fn(),
    }
    const client = createXrpcClient({
      ...baseOptions,
      authorization: 'Basic c2VjcmV0',
      serviceAuth,
    })

    await expect(
      callUpstream(client, 'tools.ozone.inbox.listNotifications'),
    ).rejects.toMatchObject({
      status: 503,
      body: {
        error: 'NotConfigured',
        message: expect.stringContaining('版主会话'),
      },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps basic-auth methods unconfigured when only a moderator session is set', async () => {
    const access = jwt(600)
    const fetchMock = vi.fn(async (input: URL | string) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('createSession')) {
        return new Response(
          JSON.stringify({
            accessJwt: access,
            refreshJwt: jwt(3600),
            did: 'did:plc:moderator',
          }),
        )
      }
      if (url.pathname.endsWith('getServiceAuth')) {
        return new Response(JSON.stringify({ token: jwt(60) }))
      }
      if (url.pathname.endsWith('tools.ozone.inbox.listNotifications')) {
        return new Response(JSON.stringify({ notifications: [] }))
      }
      return new Response('{}')
    })
    vi.stubGlobal('fetch', fetchMock)
    const client = createOzoneClient(
      {
        pdsUrl: 'http://pds.test',
        ozoneUrl: 'http://ozone.test',
        ozoneDid: 'did:plc:ozone',
        ozoneModeratorHandle: 'moderator.test',
        ozoneModeratorPassword: 'app-password',
        ozoneTimeoutMs: 2000,
        ozoneMaxBytes: 1024 * 1024,
      },
      silentLogger,
    )

    expect(client.configured).toBe(false)
    await expect(
      callUpstream(client, 'tools.ozone.inbox.listNotifications'),
    ).resolves.toEqual({ notifications: [] })
    await expect(
      callUpstream(client, 'tools.ozone.setting.listOptions'),
    ).rejects.toMatchObject({
      status: 503,
      body: { error: 'NotConfigured' },
    })
    expect(
      fetchMock.mock.calls.filter((call) =>
        String(call[0]).includes('tools.ozone.setting'),
      ),
    ).toHaveLength(0)
  })
})

describe('xrpc error mapping', () => {
  const cases: Array<{ status: number; code: string; httpStatus: number; headers?: Record<string, string> }> = [
    { status: 401, code: 'UpstreamAuthFailed', httpStatus: 502 },
    { status: 403, code: 'UpstreamAuthFailed', httpStatus: 502 },
    { status: 400, code: 'InvalidRequest', httpStatus: 400 },
    { status: 404, code: 'NotFound', httpStatus: 404 },
    { status: 429, code: 'RateLimited', httpStatus: 429 },
    { status: 500, code: 'UpstreamUnavailable', httpStatus: 502 },
    { status: 503, code: 'UpstreamUnavailable', httpStatus: 502 },
  ]

  for (const entry of cases) {
    it(`maps upstream ${entry.status} to ${entry.code}`, async () => {
      stubFetch(new Response(JSON.stringify({ error: 'UpstreamError' }), { status: entry.status }))
      const client = createXrpcClient({ ...baseOptions, authorization: 'Basic c2VjcmV0' })

      const error = await callUpstream(client, 'tools.ozone.report.queryReports').catch(
        (caught: unknown) => caught,
      )
      expect(error).toBeInstanceOf(LexServerError)
      expect((error as LexServerError).status).toBe(entry.httpStatus)
      expect((error as LexServerError).body.error).toBe(entry.code)
    })
  }

  it('rejects responses beyond the configured byte limit', async () => {
    stubFetch(() => new Response(JSON.stringify({ pad: 'x'.repeat(4096) })))
    const client = createXrpcClient({
      ...baseOptions,
      authorization: 'Basic c2VjcmV0',
      maxBytes: 128,
    })

    await expect(callUpstream(client, 'tools.ozone.report.queryReports')).rejects.toMatchObject({
      status: 502,
      body: { error: 'UpstreamUnavailable' },
    })
  })

  it('rejects invalid JSON with UpstreamUnavailable', async () => {
    stubFetch(new Response('not-json'))
    const client = createXrpcClient({ ...baseOptions, authorization: 'Basic c2VjcmV0' })

    await expect(callUpstream(client, 'tools.ozone.report.queryReports')).rejects.toMatchObject({
      status: 502,
      body: { error: 'UpstreamUnavailable' },
    })
  })

  it('reports probe success and credential rejection', async () => {
    stubFetch(new Response('{}'))
    const ok = createXrpcClient({ ...baseOptions, authorization: 'Basic c2VjcmV0' })
    await expect(ok.probe('tools.ozone.report.getLiveStats')).resolves.toMatchObject({
      status: 'ok',
    })

    stubFetch(new Response('{}', { status: 401 }))
    const denied = createXrpcClient({ ...baseOptions, authorization: 'Basic c2VjcmV0' })
    await expect(denied.probe('tools.ozone.report.getLiveStats')).resolves.toMatchObject({
      status: 'unavailable',
      detail: '管理员凭据被上游拒绝',
    })
  })
})
