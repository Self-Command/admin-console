import {
  LexServerAuthError,
  type LexRouterAuth,
  type ServiceAuthCredentials,
} from '@atproto/lex-server'
import { sql } from 'kysely'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootstrapAdmin } from '../../src/auth/roles.js'
import { loadConfig, type Config } from '../../src/config.js'
import { closeDb, createDb } from '../../src/db/index.js'
import { migrateToLatest } from '../../src/db/migrations.js'
import type { AuditResult } from '../../src/db/types.js'
import { DirectoryIndexer } from '../../src/directory/indexer.js'
import type { PdsClient } from '../../src/directory/pds.js'
import type { FirehoseSource } from '../../src/directory/source.js'
import { KyselyDirectoryStore } from '../../src/directory/store.js'
import { silentLogger } from '../../src/logger.js'
import { closeServer, createAppServer } from '../../src/server.js'

// HTTP permission matrix against a real database. The service JWT transport is
// replaced by a token-to-DID map, but the guard, role lookup, audit trail and
// XRPC layer under test are the production ones.
//
//   ADMIN_API_E2E_DATABASE_URL=postgres://... pnpm --filter @admin/api test:e2e
// The schema `admin` is dropped and recreated; never point this at shared data.

const dbUrl = process.env.ADMIN_API_E2E_DATABASE_URL
const describeDb = dbUrl ? describe : describe.skip

const ADMIN_DID = 'did:plc:e2eadmin'
const VIEWER = 'did:plc:e2eviewer'
const OPERATOR = 'did:plc:e2eoperator'
const NOROLE = 'did:plc:e2enorole'
const TARGET = 'did:plc:e2etarget'
const ACCOUNT_DID = 'did:plc:e2eaccount'

type Actor = 'anon' | 'viewer' | 'operator' | 'admin' | 'norole'

const tokens: Record<Exclude<Actor, 'anon'>, string> = {
  viewer: 'token-viewer',
  operator: 'token-operator',
  admin: 'token-admin',
  norole: 'token-norole',
}

const tokenDids = new Map<string, string>([
  [tokens.viewer, VIEWER],
  [tokens.operator, OPERATOR],
  [tokens.admin, ADMIN_DID],
  [tokens.norole, NOROLE],
])

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

const NSID = {
  session: 'com.selfcommand.admin.session.get',
  roleList: 'com.selfcommand.admin.role.list',
  roleGet: 'com.selfcommand.admin.role.get',
  roleCreate: 'com.selfcommand.admin.role.create',
  roleUpdate: 'com.selfcommand.admin.role.update',
  roleRevoke: 'com.selfcommand.admin.role.revoke',
  auditList: 'com.selfcommand.admin.audit.list',
  accountList: 'com.selfcommand.admin.account.list',
  accountGet: 'com.selfcommand.admin.account.get',
} as const

type MatrixEntry = {
  name: string
  nsid: string
  params?: Record<string, string>
  body?: Record<string, unknown>
  statuses: Record<Exclude<Actor, 'norole'>, number>
}

const matrix: MatrixEntry[] = [
  {
    name: 'session.get',
    nsid: NSID.session,
    statuses: { anon: 401, viewer: 200, operator: 200, admin: 200 },
  },
  {
    name: 'role.list',
    nsid: NSID.roleList,
    statuses: { anon: 401, viewer: 403, operator: 403, admin: 200 },
  },
  {
    name: 'role.get',
    nsid: NSID.roleGet,
    params: { subject: VIEWER },
    statuses: { anon: 401, viewer: 403, operator: 403, admin: 200 },
  },
  {
    name: 'role.create',
    nsid: NSID.roleCreate,
    body: { subject: TARGET, role: 'viewer' },
    statuses: { anon: 401, viewer: 403, operator: 403, admin: 200 },
  },
  {
    name: 'role.update',
    nsid: NSID.roleUpdate,
    body: { subject: TARGET, role: 'operator' },
    statuses: { anon: 401, viewer: 403, operator: 403, admin: 200 },
  },
  {
    name: 'role.revoke',
    nsid: NSID.roleRevoke,
    body: { subject: TARGET },
    statuses: { anon: 401, viewer: 403, operator: 403, admin: 200 },
  },
  {
    name: 'audit.list',
    nsid: NSID.auditList,
    statuses: { anon: 401, viewer: 403, operator: 403, admin: 200 },
  },
  {
    name: 'account.list',
    nsid: NSID.accountList,
    statuses: { anon: 401, viewer: 200, operator: 200, admin: 200 },
  },
  {
    name: 'account.get',
    nsid: NSID.accountGet,
    params: { did: ACCOUNT_DID },
    statuses: { anon: 401, viewer: 200, operator: 200, admin: 200 },
  },
]

const deniedNsids = [
  NSID.roleList,
  NSID.roleGet,
  NSID.roleCreate,
  NSID.roleUpdate,
  NSID.roleRevoke,
  NSID.auditList,
]

describeDb('http permission matrix', () => {
  let config: Config
  let db: ReturnType<typeof createDb>
  let baseUrl: string
  let server: ReturnType<typeof createAppServer>

  beforeAll(async () => {
    const url = dbUrl ?? ''
    config = loadConfig({
      ADMIN_API_DATABASE_URL: url,
      ADMIN_API_SERVICE_DID: 'did:web:localhost%3A2587',
      ADMIN_API_BOOTSTRAP_ADMIN_DID: ADMIN_DID,
      ADMIN_API_INDEXER_ENABLED: 'false',
    })
    db = createDb(url, { maxConnections: 2, connectionTimeoutMs: 5000 })
    await sql`drop schema if exists admin cascade`.execute(db)
    await migrateToLatest(db)
    await bootstrapAdmin(db, config, silentLogger)
    await db
      .insertInto('admin.admin_role')
      .values([
        { did: VIEWER, role: 'viewer', granted_by: ADMIN_DID, note: null },
        { did: OPERATOR, role: 'operator', granted_by: ADMIN_DID, note: null },
      ])
      .execute()
    await db
      .insertInto('admin.account_directory')
      .values({
        did: ACCOUNT_DID,
        handle: 'e2e.test',
        status: 'active',
        active: true,
        last_event_at: new Date(),
      })
      .execute()

    const store = new KyselyDirectoryStore(db)
    const indexer = new DirectoryIndexer({
      store,
      pds: unusedPds,
      source: unusedSource,
      logger: silentLogger,
      config: config.indexer,
    })
    const verifier: LexRouterAuth<ServiceAuthCredentials> = async (ctx) => {
      const header = ctx.request.headers.get('authorization') ?? ''
      const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
      const subject = tokenDids.get(token)
      if (!subject) {
        throw new LexServerAuthError('AuthenticationRequired', 'Authentication required')
      }
      const now = Math.floor(Date.now() / 1000)
      return {
        did: subject as never,
        didDocument: {} as never,
        jwt: {
          payload: {
            iss: subject,
            aud: config.serviceDid,
            lxm: ctx.method.nsid,
            iat: now,
            exp: now + 300,
          },
        } as never,
      }
    }

    server = createAppServer({
      config,
      logger: silentLogger,
      db,
      store,
      indexer,
      verifier,
      didResolver: {
        async resolve() {
          throw new Error('unresolvable in e2e tests')
        },
      } as never,
      startedAt: Date.now(),
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await closeServer(server)
    await closeDb(db)
  })

  async function call(
    nsid: string,
    actor: Actor,
    init: { params?: Record<string, string>; body?: Record<string, unknown> } = {},
  ) {
    const url = new URL(`/xrpc/${nsid}`, baseUrl)
    for (const [key, value] of Object.entries(init.params ?? {})) {
      url.searchParams.set(key, value)
    }
    const headers: Record<string, string> = {}
    if (actor !== 'anon') headers.authorization = `Bearer ${tokens[actor]}`
    if (init.body !== undefined) headers['content-type'] = 'application/json'
    const response = await fetch(url, {
      method: init.body !== undefined ? 'POST' : 'GET',
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    })
    const text = await response.text()
    let body: unknown = text
    try {
      body = JSON.parse(text)
    } catch {
      // keep the raw text for the assertion message
    }
    return { status: response.status, body }
  }

  async function countAudit(actor: string, action: string, result: AuditResult) {
    const row = await db
      .selectFrom('admin.admin_audit_event')
      .select(sql<number>`count(*)::int`.as('count'))
      .where('actor_did', '=', actor)
      .where('action', '=', action)
      .where('result', '=', result)
      .executeTakeFirstOrThrow()
    return row.count
  }

  it('answers anonymous calls with 401 and role-gated calls per role', async () => {
    for (const entry of matrix) {
      for (const actor of ['anon', 'viewer', 'operator', 'admin'] as const) {
        const result = await call(entry.nsid, actor, { params: entry.params, body: entry.body })
        expect(
          result.status,
          `${entry.name} as ${actor}: ${JSON.stringify(result.body)}`,
        ).toBe(entry.statuses[actor])
      }
    }
  })

  it('returns the caller identity without requiring a role', async () => {
    const response = await call(NSID.session, 'norole')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ did: NOROLE, permissions: [] })

    const admin = await call(NSID.session, 'admin')
    expect(admin.status).toBe(200)
    expect(admin.body).toMatchObject({
      did: ADMIN_DID,
      role: 'admin',
      permissions: ['directory.read', 'role.read', 'role.write', 'audit.read'],
    })
  })

  it('records one denied audit row per authenticated rejection', async () => {
    for (const nsid of deniedNsids) {
      for (const actor of [VIEWER, OPERATOR]) {
        expect(await countAudit(actor, nsid, 'denied'), `${actor} ${nsid}`).toBe(1)
      }
    }
  })

  it('records success audit rows for admin mutations', async () => {
    for (const nsid of [NSID.roleCreate, NSID.roleUpdate, NSID.roleRevoke]) {
      expect(await countAudit(ADMIN_DID, nsid, 'success'), nsid).toBe(1)
    }
  })

  it('protects the last admin on update and revoke', async () => {
    const downgrade = await call(NSID.roleUpdate, 'admin', {
      body: { subject: ADMIN_DID, role: 'viewer' },
    })
    expect(downgrade.status).toBe(409)
    expect(downgrade.body).toMatchObject({ error: 'LastAdmin' })

    const selfRevoke = await call(NSID.roleRevoke, 'admin', {
      body: { subject: ADMIN_DID },
    })
    expect(selfRevoke.status).toBe(409)
    expect(selfRevoke.body).toMatchObject({ error: 'LastAdmin' })

    expect(await countAudit(ADMIN_DID, NSID.roleUpdate, 'error')).toBe(1)
    expect(await countAudit(ADMIN_DID, NSID.roleRevoke, 'error')).toBe(1)
  })

  it('applies role changes to the next request with the same token', async () => {
    const deniedBefore = await countAudit(OPERATOR, NSID.auditList, 'denied')

    const promote = await call(NSID.roleUpdate, 'admin', {
      body: { subject: OPERATOR, role: 'admin' },
    })
    expect(promote.status).toBe(200)

    const allowed = await call(NSID.auditList, 'operator')
    expect(allowed.status).toBe(200)

    const demote = await call(NSID.roleUpdate, 'admin', {
      body: { subject: OPERATOR, role: 'operator' },
    })
    expect(demote.status).toBe(200)

    const denied = await call(NSID.auditList, 'operator')
    expect(denied.status).toBe(403)
    expect(await countAudit(OPERATOR, NSID.auditList, 'denied')).toBe(deniedBefore + 1)
  })
})
