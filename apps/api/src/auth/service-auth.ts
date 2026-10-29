import { DidResolverCommon } from '@atproto-labs/did-resolver'
import {
  LexServerAuthError,
  serviceAuth,
  type LexRouterAuth,
  type ServiceAuthCredentials,
  type ServiceAuthOptions,
} from '@atproto/lex-server'
import type { DidString } from '@atproto/lex-schema'
import type { Config } from '../config.js'
import { createSafeFetch } from './safe-fetch.js'

const MAX_TOKEN_AGE_SECONDS = 5 * 60

export type DidResolver = NonNullable<ServiceAuthOptions['didResolver']>

export function createRestrictedDidResolver(config: Config): DidResolver {
  const fetch = createSafeFetch({
    allowHttp: config.did.allowHttp,
    allowPrivateHosts: config.did.allowPrivateHosts,
    timeoutMs: config.did.fetchTimeoutMs,
    maxBytes: config.did.fetchMaxBytes,
  })
  const base = new DidResolverCommon({
    fetch,
    plcDirectoryUrl: config.plcUrl,
    allowHttp: config.did.allowHttp,
  })

  return {
    async resolve(did: string, options?: { signal?: AbortSignal; noCache?: boolean }) {
      const method = did.split(':')[1]?.toLowerCase() ?? ''
      if (!config.did.allowedMethods.includes(method)) {
        throw new Error(`DID method "${method}" is not allowed by this service`)
      }
      return await base.resolve(did as never, options as never)
    },
  } as unknown as DidResolver
}

export function createNonceChecker(): (nonce: string) => Promise<boolean> {
  const seen = new Map<string, number>()
  const ttlMs = MAX_TOKEN_AGE_SECONDS * 2000
  return async (nonce: string) => {
    const now = Date.now()
    for (const [key, expiresAt] of seen) {
      if (expiresAt <= now) seen.delete(key)
    }
    if (seen.has(nonce)) return false
    seen.set(nonce, now + ttlMs)
    return true
  }
}

export function createServiceAuthVerifier(
  config: Config,
  didResolver: DidResolver = createRestrictedDidResolver(config),
): LexRouterAuth<ServiceAuthCredentials> {
  return serviceAuth({
    audience: config.serviceDid as DidString,
    maxAge: MAX_TOKEN_AGE_SECONDS,
    unique: createNonceChecker(),
    didResolver,
  })
}

type TokenPayload = {
  iss?: unknown
  aud?: unknown
  lxm?: unknown
}

function decodePayload(token: string): TokenPayload | null {
  const parts = token.split('.')
  if (parts.length !== 3 || !parts[1]) return null
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8')
    const parsed: unknown = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as TokenPayload
  } catch {
    return null
  }
}

/**
 * Attribution for rejected-but-signed tokens. A token rejected because of its
 * audience or lexicon method can still be attributed to a DID if its signature
 * verifies against the issuer document; the claims themselves are never used
 * for authorization. Returns null when the token cannot be verified.
 */
export async function resolveRejectedTokenDid(
  config: Config,
  request: Request,
  didResolver: DidResolver = createRestrictedDidResolver(config),
): Promise<string | null> {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) return null
  const payload = decodePayload(authorization.slice('Bearer '.length).trim())
  if (!payload || typeof payload.iss !== 'string') return null

  const signatureOnly = serviceAuth({
    audience: null,
    maxAge: MAX_TOKEN_AGE_SECONDS,
    unique: async () => true,
    didResolver,
  })

  try {
    const credentials = await signatureOnly({
      request,
      method: { nsid: typeof payload.lxm === 'string' ? payload.lxm : '' } as never,
      params: {},
    } as never)
    return credentials.did
  } catch {
    return null
  }
}

export function requireLxm(
  credentials: ServiceAuthCredentials,
  methodNsid: string,
): void {
  if (credentials.jwt.payload.lxm !== methodNsid) {
    throw new LexServerAuthError(
      'AuthenticationRequired',
      'JWT token does not declare the invoked lexicon method',
      { Bearer: { error: 'BadJwtLexiconMethod' } },
    )
  }
}
