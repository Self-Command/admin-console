import { randomUUID } from 'node:crypto'
import { createServer as createHttpServer, type Server } from 'node:http'
import { toRequestListener } from '@atproto/lex-server/nodejs'
import { resolveClientIp } from './client-ip.js'
import { pingDb } from './db/index.js'
import { migrationStatus } from './db/migrations.js'
import { recordRequest, renderMetrics } from './metrics.js'
import { rateLimit } from './rate-limit.js'
import { createRouter, type RouterDeps } from './routes.js'
import { probePds, probeServiceHealth } from './services/system.js'
import { getBrandingAsset } from './settings/logo.js'

export type ServerDeps = RouterDeps

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/
const PUBLIC_SETTINGS_PATH = '/xrpc/com.selfcommand.admin.settings.public'
const PUBLIC_ANNOUNCEMENT_PATH = '/xrpc/com.selfcommand.admin.announcement.public'

function sendJson(
  response: import('node:http').ServerResponse,
  status: number,
  body: unknown,
) {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  response.end(payload)
}

export function createAppServer(deps: ServerDeps): Server {
  const router = createRouter(deps)
  const xrpcListener = toRequestListener(router.fetch)

  return createHttpServer((request, response) => {
    const startedAt = Date.now()
    const clientIp = resolveClientIp(request, deps.config.trustProxy)
    const suppliedId = request.headers['x-request-id']
    const requestId =
      typeof suppliedId === 'string' && REQUEST_ID_PATTERN.test(suppliedId)
        ? suppliedId
        : randomUUID()
    response.setHeader('x-request-id', requestId)
    // The routers read these headers to attach request metadata to audit rows.
    request.headers['x-request-id'] = requestId
    request.headers['x-admin-client-ip'] = clientIp

    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    const xrpc = url.pathname.startsWith('/xrpc/')

    response.on('finish', () => {
      recordRequest(response.statusCode, xrpc)
      const line = {
        method: request.method,
        path: url.pathname,
        status: response.statusCode,
        durationMs: Date.now() - startedAt,
        requestId,
      }
      if (url.pathname === '/healthz' || url.pathname === '/readyz') {
        deps.logger.debug('http request', line)
      } else {
        deps.logger.info('http request', line)
      }
    })

    if (xrpc) {
      if (url.pathname === PUBLIC_SETTINGS_PATH) {
        const limit = rateLimit(`public:${clientIp}`, 120, 60_000)
        if (!limit.allowed) {
          response.setHeader('retry-after', String(limit.retryAfterSeconds))
          sendJson(response, 429, {
            error: 'RateLimited',
            message: 'Too many requests; retry later',
          })
          return
        }
      }

      if (url.pathname === PUBLIC_ANNOUNCEMENT_PATH) {
        const limit = rateLimit(`public-announcement:${clientIp}`, 240, 60_000)
        if (!limit.allowed) {
          response.setHeader('retry-after', String(limit.retryAfterSeconds))
          sendJson(response, 429, {
            error: 'RateLimited',
            message: 'Too many requests; retry later',
          })
          return
        }
        response.setHeader('cache-control', 'public, max-age=60')
      }

      const origin = request.headers.origin
      const allowedOrigin =
        origin && deps.config.corsOrigins.includes(origin) ? origin : undefined

      if (request.method === 'OPTIONS') {
        if (!allowedOrigin) {
          sendJson(response, 403, { error: 'ForbiddenOrigin' })
          return
        }
        response.writeHead(204, {
          'access-control-allow-origin': allowedOrigin,
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'authorization, content-type, x-request-id',
          'access-control-expose-headers': 'x-request-id',
          'access-control-max-age': '600',
          vary: 'Origin',
        })
        response.end()
        return
      }

      if (allowedOrigin) {
        response.setHeader('access-control-allow-origin', allowedOrigin)
        response.setHeader('access-control-expose-headers', 'x-request-id')
        response.setHeader('vary', 'Origin')
      }
      xrpcListener(request, response)
      return
    }

    if (request.method === 'GET' && url.pathname === '/healthz') {
      sendJson(response, 200, {
        status: 'ok',
        uptimeSeconds: Math.floor((Date.now() - deps.startedAt) / 1000),
      })
      return
    }

    if (request.method === 'GET' && url.pathname === '/readyz') {
      void readiness(deps).then(
        (result) => sendJson(response, result.status, result.body),
        () => sendJson(response, 503, { status: 'unavailable' }),
      )
      return
    }

    if (request.method === 'GET' && url.pathname === '/branding/logo') {
      const limit = rateLimit(`logo:${clientIp}`, 240, 60_000)
      if (!limit.allowed) {
        response.setHeader('retry-after', String(limit.retryAfterSeconds))
        sendJson(response, 429, { error: 'RateLimited', message: 'Too many requests' })
        return
      }
      void getBrandingAsset(deps.db).then(
        (asset) => {
          if (!asset) {
            sendJson(response, 404, { error: 'NotFound' })
            return
          }
          const etag = `"v${asset.version}"`
          if (request.headers['if-none-match'] === etag) {
            response.writeHead(304, { etag })
            response.end()
            return
          }
          response.writeHead(200, {
            'content-type': asset.mime,
            'content-length': asset.bytes.length,
            'cache-control': 'public, max-age=300',
            etag,
          })
          response.end(asset.bytes)
        },
        () => sendJson(response, 503, { error: 'Unavailable' }),
      )
      return
    }

    if (request.method === 'GET' && url.pathname === '/metrics') {
      if (deps.config.metricsToken) {
        const authorization = request.headers.authorization ?? ''
        const token = authorization.startsWith('Bearer ')
          ? authorization.slice('Bearer '.length).trim()
          : ''
        if (token !== deps.config.metricsToken) {
          sendJson(response, 401, { error: 'Unauthorized' })
          return
        }
      }
      const snapshot = deps.indexer.snapshot()
      const body = renderMetrics({
        startedAt: deps.startedAt,
        version: deps.config.version,
        indexerEnabled: snapshot.enabled,
        indexerConnected: snapshot.connected,
        indexerPaused: snapshot.paused,
      })
      response.writeHead(200, {
        'content-type': 'text/plain; version=0.0.4; charset=utf-8',
        'cache-control': 'no-store',
      })
      response.end(body)
      return
    }

    if (request.method === 'GET' && url.pathname === '/.well-known/did.json') {
      if (!deps.config.serviceDid.startsWith('did:web:')) {
        sendJson(response, 404, { error: 'NotFound' })
        return
      }
      // did:web resolution requires the DID media type without parameters.
      response.writeHead(200, {
        'content-type': 'application/did+ld+json',
        'cache-control': 'no-store',
      })
      response.end(
        JSON.stringify({
          '@context': ['https://www.w3.org/ns/did/v1'],
          id: deps.config.serviceDid,
        }),
      )
      return
    }

    if (request.method !== 'GET' && request.method !== 'POST') {
      sendJson(response, 405, { error: 'MethodNotAllowed' })
      return
    }

    sendJson(response, 404, { error: 'NotFound' })
  })
}

async function readiness(deps: ServerDeps): Promise<{
  status: number
  body: unknown
}> {
  const database = await pingDb(deps.db, deps.config.readyDbTimeoutMs)
  const snapshot = deps.indexer.snapshot()
  const indexer = {
    enabled: snapshot.enabled,
    initialized: snapshot.initialized,
    backfillComplete: snapshot.backfillComplete,
    connected: snapshot.connected,
    paused: snapshot.paused,
    lastEventAt: snapshot.lastEventAt?.toISOString() ?? null,
    lastIndexedAt: snapshot.lastIndexedAt?.toISOString() ?? null,
    cursor: snapshot.cursor === null ? null : String(snapshot.cursor),
  }

  if (!database.ok) {
    return {
      status: 503,
      body: {
        status: 'unavailable',
        database: 'unavailable',
        indexer,
      },
    }
  }

  const migrations = await migrationStatus(deps.db).catch(() => null)
  if (!migrations || migrations.pending.length > 0) {
    return {
      status: 503,
      body: {
        status: 'unavailable',
        database: 'ok',
        migrations: migrations
          ? { executed: migrations.executed, pending: migrations.pending }
          : 'unavailable',
        indexer,
      },
    }
  }

  const indexerReady = !snapshot.enabled || snapshot.initialized
  if (!indexerReady) {
    return {
      status: 503,
      body: { status: 'starting', database: 'ok', migrations: 'ok', indexer },
    }
  }

  const pds = await probePds(deps.config, 1200)
  const [ozone, appview] = await Promise.all([
    probeServiceHealth('审核服务', deps.config.ozoneUrl),
    probeServiceHealth('内容服务', deps.config.appviewUrl),
  ])
  const component = (health: {
    status: string
    latencyMs?: number
    checkedAt: string
    detail?: string
  }) => ({
    status: health.status === 'ok' ? 'ok' : health.status,
    ...(health.latencyMs !== undefined ? { latencyMs: health.latencyMs } : {}),
    checkedAt: health.checkedAt,
    ...(health.detail ? { detail: health.detail } : {}),
  })
  const upstreamsReady =
    pds.status === 'ok' && ozone.status === 'ok' && appview.status === 'ok'
  const degraded = (snapshot.enabled && !snapshot.connected) || !upstreamsReady
  return {
    status: upstreamsReady ? 200 : 503,
    body: {
      status: upstreamsReady ? (degraded ? 'degraded' : 'ready') : 'unavailable',
      database: 'ok',
      migrations: 'ok',
      pds: component(pds),
      ozone: component(ozone),
      appview: component(appview),
      indexer,
    },
  }
}

export async function closeServer(server: Server, timeoutMs = 10000): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      server.closeAllConnections()
      resolve()
    }, timeoutMs)
    timer.unref()
    server.close(() => {
      clearTimeout(timer)
      resolve()
    })
    server.closeIdleConnections()
  })
}
