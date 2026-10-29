import {
  getServiceAuthToken,
  PdsAuthError,
  refreshPdsSession,
  type PdsSession,
} from '@/lib/auth/pds'
import { adminApiConfig } from '@/lib/config'
import { isRoleName, type Permission, type RoleName } from '@/lib/roles'

export const SESSION_NSID = 'com.selfcommand.admin.session.get'

export interface AdminIdentity {
  did: string
  role?: RoleName
  permissions: Permission[]
}

export type AdminErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'conflict'
  | 'validation'
  | 'not_found'
  | 'server'
  | 'network'

export class AdminApiError extends Error {
  constructor(
    readonly kind: AdminErrorKind,
    readonly status: number | null,
    readonly code: string | null = null,
    readonly requestId: string | null = null,
  ) {
    super(`admin api error: ${kind}`)
    this.name = 'AdminApiError'
  }
}

interface XrpcErrorBody {
  error?: unknown
  message?: unknown
}

function kindForStatus(status: number): AdminErrorKind {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  if (status >= 400 && status < 500) return 'validation'
  return 'server'
}

async function readError(
  response: Response,
): Promise<{ code: string | null; requestId: string | null }> {
  let code: string | null = null
  try {
    const body = (await response.json()) as XrpcErrorBody
    if (typeof body.error === 'string') code = body.error
  } catch {
    code = null
  }
  return { code, requestId: response.headers.get('x-request-id') }
}

async function serviceToken(session: PdsSession, lxm: string): Promise<string> {
  try {
    return await getServiceAuthToken(session, { aud: adminApiConfig.serviceDid, lxm })
  } catch (error) {
    if (error instanceof PdsAuthError && error.reason === 'session_expired') {
      throw new AdminApiError('unauthorized', 401)
    }
    if (error instanceof PdsAuthError && error.reason === 'network') {
      throw new AdminApiError('network', null)
    }
    throw error
  }
}

async function send(
  session: PdsSession,
  nsid: string,
  options: { params?: Record<string, string>; body?: unknown },
): Promise<Response> {
  const token = await serviceToken(session, nsid)
  const query = options.params ? `?${new URLSearchParams(options.params).toString()}` : ''
  try {
    return await fetch(`${adminApiConfig.url}/xrpc/${nsid}${query}`, {
      method: options.body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new AdminApiError('network', null)
  }
}

/**
 * Calls an admin-api XRPC method with a fresh service JWT. A 401 (from token
 * minting or the service) triggers one silent PDS refresh, persisted through
 * onSession, and a single retry; a second 401 is surfaced as unauthorized.
 */
export async function callAdmin<T>(
  session: PdsSession,
  nsid: string,
  options: { params?: Record<string, string>; body?: unknown } = {},
  onSession?: (session: PdsSession) => void,
): Promise<{ data: T; session: PdsSession }> {
  let current = session

  async function attempt(): Promise<Response> {
    const response = await send(current, nsid, options)
    if (response.status === 401) throw new AdminApiError('unauthorized', 401)
    return response
  }

  let response: Response
  try {
    response = await attempt()
  } catch (error) {
    if (!(error instanceof AdminApiError) || error.kind !== 'unauthorized') throw error
    current = await refresh(current)
    onSession?.(current)
    response = await attempt()
  }

  if (!response.ok) {
    const { code, requestId } = await readError(response)
    throw new AdminApiError(kindForStatus(response.status), response.status, code, requestId)
  }

  let data: T
  try {
    data = (await response.json()) as T
  } catch {
    throw new AdminApiError('server', response.status)
  }
  return { data, session: current }
}

async function refresh(session: PdsSession): Promise<PdsSession> {
  try {
    return await refreshPdsSession(session)
  } catch {
    throw new AdminApiError('unauthorized', 401)
  }
}

function parseIdentity(value: unknown): AdminIdentity {
  if (!value || typeof value !== 'object') throw new AdminApiError('server', 200)
  const body = value as { did?: unknown; role?: unknown; permissions?: unknown }
  if (typeof body.did !== 'string' || !Array.isArray(body.permissions)) {
    throw new AdminApiError('server', 200)
  }
  const role = isRoleName(body.role) ? body.role : undefined
  return {
    did: body.did,
    ...(role ? { role } : {}),
    permissions: body.permissions.filter(
      (item): item is Permission => typeof item === 'string',
    ),
  }
}

export async function fetchAdminIdentity(
  session: PdsSession,
  onSession?: (session: PdsSession) => void,
): Promise<{ identity: AdminIdentity; session: PdsSession }> {
  const { data, session: current } = await callAdmin<unknown>(
    session,
    SESSION_NSID,
    {},
    onSession,
  )
  return { identity: parseIdentity(data), session: current }
}
