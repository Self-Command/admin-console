import type { Logger } from '../logger.js'

const BEARER = 'Bearer '
const TOKEN_SKEW_MS = 10_000
const DEFAULT_TOKEN_TTL_MS = 30_000
const SESSION_SKEW_MS = 30_000

const SERVICE_AUTH_PREFIXES = ['tools.ozone.inbox.', 'tools.ozone.signature.'] as const

export type ModeratorAuthErrorKind = 'auth' | 'unavailable'

export class ModeratorAuthError extends Error {
  constructor(
    readonly kind: ModeratorAuthErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'ModeratorAuthError'
  }
}

export type ModeratorAuthConfig = {
  pdsUrl?: string
  ozoneDid?: string
  identifier?: string
  password?: string
  timeoutMs: number
}

export type ModeratorAuth = {
  readonly configured: boolean
  matches(nsid: string): boolean
  token(nsid: string): Promise<string>
  invalidate(nsid: string): void
}

type Session = {
  accessJwt: string
  refreshJwt: string
  accessExpiresAt?: number
}

type ServiceToken = {
  value: string
  expiresAt: number
}

/**
 * Ozone verifies tools.ozone.inbox.* with the standard user verifier and
 * tools.ozone.signature.* with the moderator verifier. Both require a service
 * token minted for a team member, so those calls cannot use basic admin auth.
 */
export function createModeratorAuth(
  config: ModeratorAuthConfig,
  logger: Logger,
  fetchImpl: typeof fetch = fetch,
): ModeratorAuth {
  const configured = Boolean(
    config.pdsUrl &&
      config.ozoneDid &&
      config.identifier &&
      config.password,
  )
  const scope = logger.child({ component: 'moderator-auth' })

  let session: Session | undefined
  let sessionPromise: Promise<Session> | undefined
  const tokens = new Map<string, ServiceToken>()
  const minting = new Map<string, Promise<ServiceToken>>()

  function matches(nsid: string): boolean {
    return SERVICE_AUTH_PREFIXES.some((prefix) => nsid.startsWith(prefix))
  }

  async function request(url: URL, init: RequestInit): Promise<Response> {
    try {
      return await fetchImpl(url, {
        ...init,
        signal: AbortSignal.timeout(config.timeoutMs),
      })
    } catch {
      throw new ModeratorAuthError(
        'unavailable',
        'moderator session request failed',
      )
    }
  }

  async function readJson(
    response: Response,
  ): Promise<Record<string, unknown>> {
    const text = await response.text().catch(() => '')
    try {
      const value = JSON.parse(text) as unknown
      return value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : {}
    } catch {
      return {}
    }
  }

  function readSession(body: Record<string, unknown>): Session {
    const accessJwt =
      typeof body.accessJwt === 'string' ? body.accessJwt : undefined
    const refreshJwt =
      typeof body.refreshJwt === 'string' ? body.refreshJwt : undefined
    if (!accessJwt || !refreshJwt) {
      throw new ModeratorAuthError(
        'unavailable',
        'moderator session response missing tokens',
      )
    }
    return {
      accessJwt,
      refreshJwt,
      accessExpiresAt: jwtExpiry(accessJwt),
    }
  }

  async function login(): Promise<Session> {
    const response = await request(
      new URL('/xrpc/com.atproto.server.createSession', config.pdsUrl),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          identifier: config.identifier,
          password: config.password,
        }),
      },
    )
    if (!response.ok) {
      scope.warn('moderator session login failed', { status: response.status })
      throw new ModeratorAuthError(
        response.status === 400 || response.status === 401
          ? 'auth'
          : 'unavailable',
        'moderator session login failed',
        response.status,
      )
    }
    return readSession(await readJson(response))
  }

  async function refresh(current: Session): Promise<Session> {
    const response = await request(
      new URL('/xrpc/com.atproto.server.refreshSession', config.pdsUrl),
      {
        method: 'POST',
        headers: {
          authorization: `${BEARER}${current.refreshJwt}`,
          accept: 'application/json',
        },
      },
    )
    if (!response.ok) {
      scope.info('moderator session refresh rejected; logging in again', {
        status: response.status,
      })
      return login()
    }
    return readSession(await readJson(response))
  }

  async function obtainSession(): Promise<Session> {
    try {
      const next = session ? await refresh(session) : await login()
      session = next
      return next
    } finally {
      sessionPromise = undefined
    }
  }

  async function ensureSession(): Promise<Session> {
    if (
      session &&
      (!session.accessExpiresAt ||
        session.accessExpiresAt - SESSION_SKEW_MS > Date.now())
    ) {
      return session
    }
    return renewSession()
  }

  async function renewSession(): Promise<Session> {
    if (!sessionPromise) {
      sessionPromise = obtainSession()
    }
    return sessionPromise
  }

  async function mint(nsid: string): Promise<ServiceToken> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = await ensureSession()
      const url = new URL('/xrpc/com.atproto.server.getServiceAuth', config.pdsUrl)
      url.searchParams.set('aud', config.ozoneDid ?? '')
      url.searchParams.set('lxm', nsid)
      const response = await request(url, {
        headers: {
          authorization: `${BEARER}${current.accessJwt}`,
          accept: 'application/json',
        },
      })
      if (response.status === 401 || response.status === 403) {
        if (attempt === 0) {
          await renewSession()
          continue
        }
        session = undefined
        scope.warn('moderator service token rejected', { nsid, status: response.status })
        throw new ModeratorAuthError(
          'auth',
          'moderator service token rejected',
          response.status,
        )
      }
      if (!response.ok) {
        scope.warn('moderator service token request failed', {
          nsid,
          status: response.status,
        })
        throw new ModeratorAuthError(
          'unavailable',
          'moderator service token request failed',
          response.status,
        )
      }
      const body = await readJson(response)
      const value = typeof body.token === 'string' ? body.token : undefined
      if (!value) {
        throw new ModeratorAuthError(
          'unavailable',
          'moderator service token response missing token',
        )
      }
      const expiresAt = jwtExpiry(value)
      return {
        value,
        expiresAt:
          expiresAt !== undefined
            ? expiresAt - TOKEN_SKEW_MS
            : Date.now() + DEFAULT_TOKEN_TTL_MS,
      }
    }
    throw new ModeratorAuthError('auth', 'moderator session rejected')
  }

  async function token(nsid: string): Promise<string> {
    if (!configured) {
      throw new ModeratorAuthError(
        'unavailable',
        'moderator session not configured',
      )
    }
    const cached = tokens.get(nsid)
    if (cached && cached.expiresAt > Date.now()) return cached.value
    let pending = minting.get(nsid)
    if (!pending) {
      const next = mint(nsid)
        .then((minted) => {
          tokens.set(nsid, minted)
          return minted
        })
        .finally(() => {
          if (minting.get(nsid) === next) minting.delete(nsid)
        })
      pending = next
      minting.set(nsid, next)
    }
    return (await pending).value
  }

  function invalidate(nsid: string): void {
    tokens.delete(nsid)
  }

  return { configured, matches, token, invalidate }
}

function jwtExpiry(token: string): number | undefined {
  const payload = token.split('.')[1]
  if (!payload) return undefined
  try {
    const decoded = Buffer.from(
      payload.replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    ).toString('utf8')
    const claims = JSON.parse(decoded) as { exp?: unknown }
    return typeof claims.exp === 'number' && Number.isFinite(claims.exp)
      ? claims.exp * 1000
      : undefined
  } catch {
    return undefined
  }
}
