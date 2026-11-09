import { LexServerError } from '@atproto/lex-server'
import type { Logger } from '../logger.js'
import { recordUpstream } from '../metrics.js'
import {
  createModeratorAuth,
  ModeratorAuthError,
  type ModeratorAuth,
} from './moderator-auth.js'

export type UpstreamOptions = {
  name: string
  baseUrl: string
  authorization?: string
  configured?: boolean
  serviceAuth?: ModeratorAuth
  timeoutMs: number
  maxBytes: number
  logger: Logger
}

export type UpstreamCallOptions = {
  method?: 'GET' | 'POST'
  params?: Record<string, unknown>
  body?: unknown
}

export type UpstreamHealth = {
  status: 'ok' | 'unavailable'
  latencyMs?: number
  detail?: string
}

type FailureKind =
  | 'auth'
  | 'session'
  | 'invalid'
  | 'notfound'
  | 'rate'
  | 'unavailable'

export class UpstreamFailure extends Error {
  constructor(
    readonly kind: FailureKind,
    message: string,
    readonly status?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message)
    this.name = 'UpstreamFailure'
  }
}

const AUTH_HEADER = 'Basic '

function basicAuth(username: string, password: string): string {
  return AUTH_HEADER + Buffer.from(`${username}:${password}`).toString('base64')
}

export function toLexError(error: unknown): LexServerError {
  if (error instanceof LexServerError) return error
  if (error instanceof UpstreamFailure) {
    if (error.kind === 'auth') {
      return new LexServerError(502, {
        error: 'UpstreamAuthFailed',
        message: '上游服务拒绝了管理员凭据，请联系部署管理员检查凭据配置。',
      })
    }
    if (error.kind === 'session') {
      return new LexServerError(502, {
        error: 'UpstreamAuthFailed',
        message: '版主会话凭据被上游服务拒绝，请联系部署管理员检查版主账号配置。',
      })
    }
    if (error.kind === 'invalid') {
      return new LexServerError(400, {
        error: 'InvalidRequest',
        message: '上游服务无法处理本次请求，请检查筛选条件或操作参数后重试。',
      })
    }
    if (error.kind === 'notfound') {
      return new LexServerError(404, {
        error: 'NotFound',
        message: '请求的对象不存在或已被删除。',
      })
    }
    if (error.kind === 'rate') {
      const mapped = new LexServerError(429, {
        error: 'RateLimited',
        message: '上游服务请求过于频繁，请稍后重试。',
      })
      return mapped
    }
    return new LexServerError(502, {
      error: 'UpstreamUnavailable',
      message: '暂时无法连接上游服务，请稍后重试。',
    })
  }
  return new LexServerError(502, {
    error: 'UpstreamUnavailable',
    message: '上游服务返回了无法识别的响应，请稍后重试。',
  })
}

export function notConfigured(service: string): LexServerError {
  return new LexServerError(503, {
    error: 'NotConfigured',
    message: `尚未配置${service}的管理员凭据，该功能暂不可用。请联系部署管理员完成配置。`,
  })
}

export function moderatorSessionNotConfigured(): LexServerError {
  return new LexServerError(503, {
    error: 'NotConfigured',
    message:
      '尚未配置版主会话凭据，用户通知与威胁签名检索暂不可用。请联系部署管理员完成配置。',
  })
}

function buildUrl(baseUrl: string, nsid: string, params?: Record<string, unknown>): URL {
  const url = new URL(`/xrpc/${nsid}`, baseUrl)
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, String(item))
      } else {
        url.searchParams.set(key, String(value))
      }
    }
  }
  return url
}

async function readLimited(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {})
    throw new UpstreamFailure('unavailable', 'response exceeds size limit')
  }
  const body = response.body
  if (!body) return ''
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new UpstreamFailure('unavailable', 'response exceeds size limit')
      }
      chunks.push(value)
    }
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')
}

export type XrpcClient = {
  readonly name: string
  readonly configured: boolean
  call<T>(nsid: string, options?: UpstreamCallOptions): Promise<T>
  probe(nsid: string): Promise<UpstreamHealth>
}

export function createXrpcClient(options: UpstreamOptions): XrpcClient {
  const configured = options.configured ?? Boolean(options.authorization)
  const serviceAuth = options.serviceAuth
  const logger = options.logger.child({ upstream: options.name })

  async function call<T>(nsid: string, callOptions: UpstreamCallOptions = {}): Promise<T> {
    const useServiceAuth = Boolean(serviceAuth?.matches(nsid))
    if (useServiceAuth && !serviceAuth?.configured) {
      throw moderatorSessionNotConfigured()
    }
    if (!configured && !useServiceAuth) throw notConfigured(options.name)
    const startedAt = Date.now()
    let ok = false
    const attempt = () =>
      callOnce<T>(nsid, callOptions, startedAt, useServiceAuth, () => {
        ok = true
      })
    try {
      try {
        return await attempt()
      } catch (error) {
        if (
          useServiceAuth &&
          error instanceof UpstreamFailure &&
          error.kind === 'auth'
        ) {
          serviceAuth?.invalidate(nsid)
          return await attempt()
        }
        throw error
      }
    } finally {
      recordUpstream(options.name, Date.now() - startedAt, ok)
    }
  }

  async function callOnce<T>(
    nsid: string,
    callOptions: UpstreamCallOptions,
    startedAt: number,
    useServiceAuth: boolean,
    markOk: () => void,
  ): Promise<T> {
    const method = callOptions.method ?? (callOptions.body === undefined ? 'GET' : 'POST')
    const url = buildUrl(options.baseUrl, nsid, callOptions.params)
    let authorization = options.authorization
    if (useServiceAuth && serviceAuth) {
      try {
        authorization = `Bearer ${await serviceAuth.token(nsid)}`
      } catch (error) {
        if (error instanceof ModeratorAuthError) {
          throw new UpstreamFailure(
            error.kind === 'auth' ? 'session' : 'unavailable',
            error.message,
            error.status,
          )
        }
        throw error
      }
    }
    let response: Response
    try {
      response = await fetch(url, {
        method,
        signal: AbortSignal.timeout(options.timeoutMs),
        headers: {
          accept: 'application/json',
          ...(callOptions.body === undefined
            ? {}
            : { 'content-type': 'application/json' }),
          ...(authorization ? { authorization } : {}),
        },
        ...(callOptions.body === undefined
          ? {}
          : { body: JSON.stringify(callOptions.body) }),
      })
    } catch (error) {
      logger.warn('upstream request failed', {
        nsid,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.name : 'Error',
      })
      throw new UpstreamFailure('unavailable', 'upstream request failed')
    }

    const durationMs = Date.now() - startedAt
    let text: string
    try {
      text = await readLimited(response, options.maxBytes)
    } catch (error) {
      logger.warn('upstream response rejected', { nsid, status: response.status, durationMs })
      throw error instanceof UpstreamFailure
        ? error
        : new UpstreamFailure('unavailable', 'upstream response read failed')
    }

    if (!response.ok) {
      logger.warn('upstream returned an error', { nsid, status: response.status, durationMs })
      if (response.status === 401 || response.status === 403) {
        throw new UpstreamFailure('auth', 'upstream rejected credentials', response.status)
      }
      if (response.status === 404) {
        throw new UpstreamFailure('notfound', 'upstream object not found', response.status)
      }
      if (response.status === 429) {
        const retry = Number(response.headers.get('retry-after') ?? '0')
        throw new UpstreamFailure(
          'rate',
          'upstream rate limited',
          response.status,
          Number.isFinite(retry) && retry > 0 ? retry : undefined,
        )
      }
      if (response.status >= 400 && response.status < 500) {
        throw new UpstreamFailure('invalid', 'upstream rejected request', response.status)
      }
      throw new UpstreamFailure('unavailable', 'upstream error', response.status)
    }

    if (!text) {
      markOk()
      return {} as T
    }
    try {
      const parsed = JSON.parse(text) as T
      markOk()
      return parsed
    } catch {
      logger.warn('upstream returned invalid json', { nsid, status: response.status, durationMs })
      throw new UpstreamFailure('unavailable', 'invalid upstream json')
    }
  }

  async function probe(nsid: string): Promise<UpstreamHealth> {
    if (!configured) {
      return { status: 'unavailable', detail: '未配置管理员凭据' }
    }
    const started = Date.now()
    try {
      await call(nsid)
      return { status: 'ok', latencyMs: Date.now() - started }
    } catch (error) {
      const detail =
        error instanceof UpstreamFailure && error.kind === 'auth'
          ? '管理员凭据被上游拒绝'
          : '无法连接上游服务'
      return { status: 'unavailable', latencyMs: Date.now() - started, detail }
    }
  }

  return { name: options.name, configured, call, probe }
}

export async function callUpstream<T>(
  client: XrpcClient,
  nsid: string,
  options?: UpstreamCallOptions,
): Promise<T> {
  try {
    return await client.call<T>(nsid, options)
  } catch (error) {
    throw toLexError(error)
  }
}

export function createOzoneClient(
  config: {
    pdsUrl?: string
    ozoneUrl: string
    ozoneAdminPassword?: string
    ozoneDid?: string
    ozoneModeratorHandle?: string
    ozoneModeratorPassword?: string
    ozoneTimeoutMs: number
    ozoneMaxBytes: number
  },
  logger: Logger,
): XrpcClient {
  const serviceAuth = createModeratorAuth(
    {
      pdsUrl: config.pdsUrl,
      ozoneDid: config.ozoneDid,
      identifier: config.ozoneModeratorHandle,
      password: config.ozoneModeratorPassword,
      timeoutMs: config.ozoneTimeoutMs,
    },
    logger,
  )
  return createXrpcClient({
    name: 'Ozone',
    baseUrl: config.ozoneUrl,
    configured: Boolean(config.ozoneAdminPassword),
    ...(config.ozoneAdminPassword
      ? { authorization: basicAuth('admin', config.ozoneAdminPassword) }
      : {}),
    serviceAuth,
    timeoutMs: config.ozoneTimeoutMs,
    maxBytes: config.ozoneMaxBytes,
    logger,
  })
}

export function createPdsAdminClient(
  config: {
    pdsUrl: string
    pdsAdminPassword?: string
    pdsTimeoutMs: number
    pdsMaxBytes: number
  },
  logger: Logger,
): XrpcClient {
  return createXrpcClient({
    name: 'PDS',
    baseUrl: config.pdsUrl,
    ...(config.pdsAdminPassword
      ? { authorization: basicAuth('admin', config.pdsAdminPassword) }
      : {}),
    timeoutMs: config.pdsTimeoutMs,
    maxBytes: config.pdsMaxBytes,
    logger,
  })
}

export function createAppviewClient(
  config: { appviewUrl: string; appviewTimeoutMs: number; appviewMaxBytes: number },
  logger: Logger,
): XrpcClient {
  return createXrpcClient({
    name: 'AppView',
    baseUrl: config.appviewUrl,
    configured: true,
    timeoutMs: config.appviewTimeoutMs,
    maxBytes: config.appviewMaxBytes,
    logger,
  })
}

export async function fetchImageSearch(
  config: { imageSearchUrl?: string; imageSearchToken?: string },
  params: { q: string; limit: number; cursor?: string },
): Promise<unknown> {
  if (!config.imageSearchUrl) throw notConfigured('图片检索服务')
  const url = new URL(config.imageSearchUrl)
  url.searchParams.set('q', params.q)
  url.searchParams.set('limit', String(params.limit))
  if (params.cursor) url.searchParams.set('cursor', params.cursor)
  let response: Response
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: {
        accept: 'application/json',
        ...(config.imageSearchToken
          ? { authorization: `Bearer ${config.imageSearchToken}` }
          : {}),
      },
    })
  } catch {
    throw new UpstreamFailure('unavailable', 'image search unreachable')
  }
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel().catch(() => {})
    throw new UpstreamFailure('auth', 'image search rejected credentials', response.status)
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    throw new UpstreamFailure('unavailable', 'image search error', response.status)
  }
  const text = await readLimited(response, 4 * 1024 * 1024)
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new UpstreamFailure('unavailable', 'invalid image search json')
  }
}
