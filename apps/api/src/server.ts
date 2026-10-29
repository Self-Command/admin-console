import { createServer as createHttpServer, type Server } from 'node:http'
import { toRequestListener } from '@atproto/lex-server/nodejs'
import { pingDb } from './db/index.js'
import { createRouter, type RouterDeps } from './routes.js'

export type ServerDeps = RouterDeps & { startedAt: number }

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
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

    if (url.pathname.startsWith('/xrpc/')) {
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
          'access-control-allow-headers': 'authorization, content-type',
          'access-control-max-age': '600',
          vary: 'Origin',
        })
        response.end()
        return
      }

      if (allowedOrigin) {
        response.setHeader('access-control-allow-origin', allowedOrigin)
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

    if (request.method === 'GET' && url.pathname === '/.well-known/did.json') {
      if (!deps.config.serviceDid.startsWith('did:web:')) {
        sendJson(response, 404, { error: 'NotFound' })
        return
      }
      sendJson(response, 200, {
        '@context': ['https://www.w3.org/ns/did/v1'],
        id: deps.config.serviceDid,
      })
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

  const indexerReady = !snapshot.enabled || snapshot.initialized
  if (!indexerReady) {
    return {
      status: 503,
      body: { status: 'starting', database: 'ok', indexer },
    }
  }

  const degraded = snapshot.enabled && !snapshot.connected
  return {
    status: 200,
    body: {
      status: degraded ? 'degraded' : 'ready',
      database: 'ok',
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
