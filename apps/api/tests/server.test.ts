import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Config } from '../src/config.js'
import { loadConfig } from '../src/config.js'
import { closeDb, createDb } from '../src/db/index.js'
import { DirectoryIndexer } from '../src/directory/indexer.js'
import type { PdsClient } from '../src/directory/pds.js'
import type { FirehoseSource } from '../src/directory/source.js'
import { silentLogger } from '../src/logger.js'
import { closeServer, createAppServer } from '../src/server.js'
import { MemoryDirectoryStore } from './helpers/memory-store.js'

const unusedSource: FirehoseSource = {
  async run() {
    throw new Error('not used')
  },
}

const unusedPds: PdsClient = {
  async listRepos() {
    throw new Error('not used')
  },
  async resolveHandle() {
    return null
  },
}

describe('http server', () => {
  let config: Config
  let baseUrl: string
  let server: ReturnType<typeof createAppServer>
  let db: ReturnType<typeof createDb>

  beforeAll(async () => {
    config = loadConfig({
      ADMIN_API_DATABASE_URL: 'postgres://admin:sup3rsecret@127.0.0.1:1/admin',
      ADMIN_API_SERVICE_DID: 'did:web:localhost%3A2587',
      ADMIN_API_READY_DB_TIMEOUT_MS: '500',
      ADMIN_API_INDEXER_ENABLED: 'false',
      ADMIN_API_CORS_ORIGINS: 'http://127.0.0.1:8101',
    })
    db = createDb(config.databaseUrl, { maxConnections: 1, connectionTimeoutMs: 500 })
    const indexer = new DirectoryIndexer({
      store: new MemoryDirectoryStore(),
      pds: unusedPds,
      source: unusedSource,
      logger: silentLogger,
      config: config.indexer,
    })
    server = createAppServer({
      config,
      logger: silentLogger,
      db,
      store: new MemoryDirectoryStore(),
      indexer,
      verifier: (async () => {
        throw new Error('not used')
      }) as never,
      didResolver: { resolve: async () => ({ id: 'did:plc:unused' }) } as never,
      startedAt: Date.now(),
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await closeServer(server)
    await closeDb(db)
  })

  it('answers /healthz without touching the database', async () => {
    const response = await fetch(`${baseUrl}/healthz`)

    expect(response.status).toBe(200)
    const body = (await response.json()) as { status: string; uptimeSeconds: number }
    expect(body.status).toBe('ok')
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0)
  })

  it('reports /readyz as unavailable without leaking the connection string', async () => {
    const response = await fetch(`${baseUrl}/readyz`)
    const text = await response.text()

    expect(response.status).toBe(503)
    expect(text).toContain('"database":"unavailable"')
    expect(text).not.toContain('postgres://')
    expect(text).not.toContain('sup3rsecret')
  })

  it('serves a read-only DID document for did:web', async () => {
    const response = await fetch(`${baseUrl}/.well-known/did.json`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      '@context': ['https://www.w3.org/ns/did/v1'],
      id: 'did:web:localhost%3A2587',
    })
  })

  it('returns JSON 404 for unknown paths', async () => {
    const response = await fetch(`${baseUrl}/nothing-here`)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'NotFound' })
  })

  it('answers CORS preflight for configured web origins', async () => {
    const response = await fetch(`${baseUrl}/xrpc/com.selfcommand.admin.session.get`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://127.0.0.1:8101',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    })

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:8101')
    expect(response.headers.get('access-control-allow-headers')).toContain('authorization')
  })

  it('rejects CORS preflight from unlisted origins', async () => {
    const response = await fetch(`${baseUrl}/xrpc/com.selfcommand.admin.session.get`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://evil.example',
        'access-control-request-method': 'GET',
      },
    })

    expect(response.status).toBe(403)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('adds the allow-origin header to actual XRPC responses without echoing unlisted origins', async () => {
    const allowed = await fetch(`${baseUrl}/xrpc/com.selfcommand.admin.session.get`, {
      headers: { origin: 'http://127.0.0.1:8101' },
    })
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:8101')

    const denied = await fetch(`${baseUrl}/xrpc/com.selfcommand.admin.session.get`, {
      headers: { origin: 'https://evil.example' },
    })
    expect(denied.headers.get('access-control-allow-origin')).toBeNull()
  })
})
