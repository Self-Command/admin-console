// Client for the official PDS session endpoints. Passwords are only sent to
// the PDS once and never stored; only the session tokens are persisted.

export interface PdsSession {
  service: string
  did: string
  handle: string
  accessJwt: string
  refreshJwt: string
}

export type PdsErrorReason =
  | 'invalid_credentials'
  | 'session_expired'
  | 'network'
  | 'invalid_response'

export class PdsAuthError extends Error {
  constructor(readonly reason: PdsErrorReason) {
    super(`PDS authentication failed: ${reason}`)
    this.name = 'PdsAuthError'
  }
}

const REQUEST_TIMEOUT_MS = 15_000

export function normalizePdsUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) throw new PdsAuthError('invalid_response')
  let url: URL
  try {
    url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
  } catch {
    throw new PdsAuthError('invalid_response')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new PdsAuthError('invalid_response')
  }
  if (url.username || url.password) throw new PdsAuthError('invalid_response')
  return url.origin
}

interface SessionResponse {
  did?: unknown
  handle?: unknown
  accessJwt?: unknown
  refreshJwt?: unknown
}

function toSession(service: string, body: SessionResponse): PdsSession {
  if (
    typeof body.did !== 'string' ||
    typeof body.handle !== 'string' ||
    typeof body.accessJwt !== 'string' ||
    typeof body.refreshJwt !== 'string'
  ) {
    throw new PdsAuthError('invalid_response')
  }
  return {
    service,
    did: body.did,
    handle: body.handle,
    accessJwt: body.accessJwt,
    refreshJwt: body.refreshJwt,
  }
}

async function request(
  service: string,
  nsid: string,
  init: { method: 'GET' | 'POST'; token?: string; body?: unknown },
): Promise<Response> {
  let response: Response
  try {
    response = await fetch(new URL(`/xrpc/${nsid}`, service), {
      method: init.method,
      headers: {
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    throw new PdsAuthError('network')
  }
  return response
}

export async function createPdsSession(input: {
  service: string
  identifier: string
  password: string
}): Promise<PdsSession> {
  const service = normalizePdsUrl(input.service)
  const response = await request(service, 'com.atproto.server.createSession', {
    method: 'POST',
    body: { identifier: input.identifier, password: input.password },
  })
  if (response.status === 401) throw new PdsAuthError('invalid_credentials')
  if (!response.ok) throw new PdsAuthError('network')
  let body: SessionResponse
  try {
    body = (await response.json()) as SessionResponse
  } catch {
    throw new PdsAuthError('invalid_response')
  }
  return toSession(service, body)
}

export async function refreshPdsSession(session: PdsSession): Promise<PdsSession> {
  const response = await request(session.service, 'com.atproto.server.refreshSession', {
    method: 'POST',
    token: session.refreshJwt,
  })
  if (response.status === 400 || response.status === 401) {
    throw new PdsAuthError('session_expired')
  }
  if (!response.ok) throw new PdsAuthError('network')
  let body: SessionResponse
  try {
    body = (await response.json()) as SessionResponse
  } catch {
    throw new PdsAuthError('invalid_response')
  }
  return toSession(session.service, body)
}

export async function deletePdsSession(session: PdsSession): Promise<void> {
  try {
    await request(session.service, 'com.atproto.server.deleteSession', {
      method: 'POST',
      token: session.refreshJwt,
    })
  } catch {
    // Local logout must succeed even when the PDS is unreachable.
  }
}

export async function getServiceAuthToken(
  session: PdsSession,
  input: { aud: string; lxm: string },
): Promise<string> {
  const query = new URLSearchParams({ aud: input.aud, lxm: input.lxm })
  const response = await request(
    session.service,
    `com.atproto.server.getServiceAuth?${query.toString()}`,
    { method: 'GET', token: session.accessJwt },
  )
  if (response.status === 401) throw new PdsAuthError('session_expired')
  if (!response.ok) throw new PdsAuthError('network')
  let body: { token?: unknown }
  try {
    body = (await response.json()) as { token?: unknown }
  } catch {
    throw new PdsAuthError('invalid_response')
  }
  if (typeof body.token !== 'string' || !body.token) {
    throw new PdsAuthError('invalid_response')
  }
  return body.token
}
