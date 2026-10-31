import { afterEach, describe, expect, it, vi } from 'vitest'
import { silentLogger } from '../src/logger.js'
import {
  createModeratorAuth,
  ModeratorAuthError,
} from '../src/upstream/moderator-auth.js'

const config = {
  pdsUrl: 'http://pds.test',
  ozoneDid: 'did:plc:ozone',
  identifier: 'moderator.test',
  password: 'app-password',
  timeoutMs: 2000,
}

function jwt(expiresInSeconds: number): string {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expiresInSeconds }),
  ).toString('base64url')
  return `e30.${payload}.signature`
}

type Call = { url: URL; init: RequestInit }

function stubPds(
  handler: (url: URL, init: RequestInit) => Response | Promise<Response>,
) {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (input: URL | string, init: RequestInit = {}) => {
    const url = new URL(String(input))
    calls.push({ url, init })
    return handler(url, init)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, fetchMock }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('moderator session auth', () => {
  it('stays unconfigured without all three settings', async () => {
    const auth = createModeratorAuth(
      { ...config, password: undefined },
      silentLogger,
    )
    expect(auth.configured).toBe(false)
    expect(auth.matches('tools.ozone.inbox.listNotifications')).toBe(true)
    await expect(
      auth.token('tools.ozone.inbox.listNotifications'),
    ).rejects.toMatchObject({ kind: 'unavailable' })
  })

  it('logs in once and mints a cached service token per method', async () => {
    const access = jwt(600)
    const refresh = jwt(3600)
    const { calls } = stubPds((url) => {
      if (url.pathname.endsWith('com.atproto.server.createSession')) {
        return json({ accessJwt: access, refreshJwt: refresh, did: 'did:plc:moderator' })
      }
      if (url.pathname.endsWith('com.atproto.server.getServiceAuth')) {
        return json({ token: jwt(60) })
      }
      return json({}, 404)
    })
    const auth = createModeratorAuth(config, silentLogger)

    const first = await auth.token('tools.ozone.inbox.listNotifications')
    const second = await auth.token('tools.ozone.inbox.listNotifications')
    const signature = await auth.token('tools.ozone.signature.searchAccounts')

    expect(second).toBe(first)
    expect(signature).toBeDefined()
    expect(calls.map((call) => call.url.pathname)).toEqual([
      '/xrpc/com.atproto.server.createSession',
      '/xrpc/com.atproto.server.getServiceAuth',
      '/xrpc/com.atproto.server.getServiceAuth',
    ])
    const mintCalls = calls.filter((call) =>
      call.url.pathname.endsWith('getServiceAuth'),
    )
    expect(mintCalls[0]?.url.searchParams.get('aud')).toBe(config.ozoneDid)
    expect(mintCalls[0]?.url.searchParams.get('lxm')).toBe(
      'tools.ozone.inbox.listNotifications',
    )
    expect(mintCalls[1]?.url.searchParams.get('lxm')).toBe(
      'tools.ozone.signature.searchAccounts',
    )
    for (const call of mintCalls) {
      expect((call.init.headers as Record<string, string>).authorization).toBe(
        `Bearer ${access}`,
      )
    }
  })

  it('refreshes the session when the service token request is rejected', async () => {
    const firstAccess = jwt(600)
    const refreshedAccess = jwt(600)
    let mintAttempts = 0
    const { calls } = stubPds((url) => {
      if (url.pathname.endsWith('createSession')) {
        return json({
          accessJwt: firstAccess,
          refreshJwt: jwt(3600),
          did: 'did:plc:moderator',
        })
      }
      if (url.pathname.endsWith('refreshSession')) {
        return json({
          accessJwt: refreshedAccess,
          refreshJwt: jwt(3600),
          did: 'did:plc:moderator',
        })
      }
      mintAttempts += 1
      return mintAttempts === 1
        ? json({ error: 'AuthRequired' }, 401)
        : json({ token: jwt(60) })
    })
    const auth = createModeratorAuth(config, silentLogger)

    await expect(
      auth.token('tools.ozone.signature.searchAccounts'),
    ).resolves.toBeDefined()
    expect(calls.map((call) => call.url.pathname)).toEqual([
      '/xrpc/com.atproto.server.createSession',
      '/xrpc/com.atproto.server.getServiceAuth',
      '/xrpc/com.atproto.server.refreshSession',
      '/xrpc/com.atproto.server.getServiceAuth',
    ])
    expect(
      (calls[2]?.init.headers as Record<string, string>).authorization,
    ).toMatch(/^Bearer /)
  })

  it('reports rejected moderator credentials as an auth failure', async () => {
    stubPds(() => json({ error: 'AuthenticationRequired' }, 401))
    const auth = createModeratorAuth(config, silentLogger)

    const error = await auth
      .token('tools.ozone.inbox.getUnreadCount')
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ModeratorAuthError)
    expect((error as ModeratorAuthError).kind).toBe('auth')
  })

  it('mints a new token once the cached token is near expiry', async () => {
    const tokens = [jwt(2), jwt(60)]
    let minted = 0
    const { calls } = stubPds((url) => {
      if (url.pathname.endsWith('createSession')) {
        return json({
          accessJwt: jwt(600),
          refreshJwt: jwt(3600),
          did: 'did:plc:moderator',
        })
      }
      const token = tokens[minted] ?? jwt(60)
      minted += 1
      return json({ token })
    })
    const auth = createModeratorAuth(config, silentLogger)

    await auth.token('tools.ozone.inbox.listNotifications')
    await auth.token('tools.ozone.inbox.listNotifications')
    expect(calls.filter((call) => call.url.pathname.endsWith('getServiceAuth'))).toHaveLength(2)
  })
})
