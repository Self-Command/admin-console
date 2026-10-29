import { LexServerError } from '@atproto/lex-server'
import { sql, type Kysely } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { bootstrapAdmin } from '../src/auth/roles.js'
import { loadConfig, type Config } from '../src/config.js'
import { closeDb, createDb } from '../src/db/index.js'
import { migrateToLatest, migrationStatus } from '../src/db/migrations.js'
import type { Database } from '../src/db/types.js'
import { FIREHOSE_STREAM, KyselyDirectoryStore } from '../src/directory/store.js'
import { silentLogger } from '../src/logger.js'
import { listAuditEvents } from '../src/services/audit.js'
import {
  createRole,
  getRole,
  listRoles,
  revokeRole,
  updateRole,
  type RoleMutationContext,
} from '../src/services/roles.js'

// Integration tests only run when a disposable database is supplied:
//   ADMIN_API_TEST_DATABASE_URL=postgres://... pnpm --filter @admin/api test
// The schema `admin` is dropped and recreated; never point this at shared data.

const ADMIN_DID = 'did:plc:adminfirst'
const SECOND_ADMIN = 'did:plc:secondadmin'
const VIEWER = 'did:plc:viewer'
const OPERATOR = 'did:plc:operator'
const AUDIT_FAIL = 'did:plc:auditfail'

const dbUrl = process.env.ADMIN_API_TEST_DATABASE_URL
const describeDb = dbUrl ? describe : describe.skip

describeDb('admin api database integration', () => {
  let db: Kysely<Database>
  let config: Config
  let ctx: RoleMutationContext
  let firstMigration: Awaited<ReturnType<typeof migrateToLatest>>
  let secondMigration: Awaited<ReturnType<typeof migrateToLatest>>
  let status: Awaited<ReturnType<typeof migrationStatus>>

  beforeAll(async () => {
    const url = dbUrl ?? ''
    config = loadConfig({
      ADMIN_API_DATABASE_URL: url,
      ADMIN_API_SERVICE_DID: 'did:web:admin.test',
      ADMIN_API_BOOTSTRAP_ADMIN_DID: ADMIN_DID,
    })
    db = createDb(url, { maxConnections: 2, connectionTimeoutMs: 5000 })
    await sql`drop schema if exists admin cascade`.execute(db)
    firstMigration = await migrateToLatest(db)
    secondMigration = await migrateToLatest(db)
    status = await migrationStatus(db)
    ctx = { db, logger: silentLogger, actor: ADMIN_DID }
  })

  afterAll(async () => {
    await closeDb(db)
  })

  describe('migrations', () => {
    it('creates the admin schema exactly once and is re-entrant', async () => {
      expect(firstMigration.error).toBeUndefined()
      expect(firstMigration.applied).toEqual(['001_admin_schema'])
      expect(secondMigration.error).toBeUndefined()
      expect(secondMigration.applied).toEqual([])
      expect(status.executed).toEqual(['001_admin_schema'])
      expect(status.pending).toEqual([])

      const tables = await sql<{ table_name: string }>`
        select table_name from information_schema.tables
        where table_schema = 'admin'
          and table_name in (
            'admin_role', 'admin_audit_event', 'account_directory', 'indexer_cursor'
          )
        order by table_name
      `.execute(db)
      expect(tables.rows.map((row) => row.table_name)).toEqual([
        'account_directory',
        'admin_audit_event',
        'admin_role',
        'indexer_cursor',
      ])
    })
  })

  describe('roles and audit', () => {
    beforeEach(async () => {
      await sql`truncate admin.admin_role, admin.admin_audit_event restart identity`.execute(
        db,
      )
      expect(await bootstrapAdmin(db, config, silentLogger)).toBe(true)
    })

    it('bootstraps the first admin only while the role table is empty', async () => {
      const roles = await db.selectFrom('admin.admin_role').selectAll().execute()
      expect(roles).toEqual([
        expect.objectContaining({
          did: ADMIN_DID,
          role: 'admin',
          granted_by: config.serviceDid,
        }),
      ])

      expect(await bootstrapAdmin(db, config, silentLogger)).toBe(false)
      const audits = await db
        .selectFrom('admin.admin_audit_event')
        .selectAll()
        .where('action', '=', 'com.selfcommand.admin.role.bootstrap')
        .execute()
      expect(audits).toHaveLength(1)
      expect(audits[0]).toMatchObject({ actor_did: config.serviceDid, target_id: ADMIN_DID })
    })

    it('creates a binding and its success audit in one transaction', async () => {
      const created = await createRole(ctx, {
        subject: VIEWER,
        role: 'viewer',
        note: '  helpdesk  ',
      })

      expect(created).toMatchObject({
        subject: VIEWER,
        role: 'viewer',
        note: 'helpdesk',
        grantedBy: ADMIN_DID,
      })
      expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

      const audits = await db
        .selectFrom('admin.admin_audit_event')
        .selectAll()
        .where('action', '=', 'com.selfcommand.admin.role.create')
        .execute()
      expect(audits).toHaveLength(1)
      expect(audits[0]).toMatchObject({
        actor_did: ADMIN_DID,
        target_type: 'role',
        target_id: VIEWER,
        result: 'success',
      })
    })

    it('rejects duplicate bindings with a conflict and audits the failure', async () => {
      await createRole(ctx, { subject: VIEWER, role: 'viewer' })

      await expect(createRole(ctx, { subject: VIEWER, role: 'operator' })).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof LexServerError &&
          error.status === 409 &&
          error.body.error === 'RoleExists',
      )

      const result = await db
        .selectFrom('admin.admin_audit_event')
        .select('result')
        .where('action', '=', 'com.selfcommand.admin.role.create')
        .orderBy('id', 'asc')
        .execute()
      expect(result.map((row) => row.result)).toEqual(['success', 'error'])
    })

    it('rejects a malformed DID without touching the role table', async () => {
      await expect(
        createRole(ctx, { subject: 'alice.test', role: 'viewer' }),
      ).rejects.toMatchObject({ status: 400, body: { error: 'InvalidRequest' } })

      const roles = await db.selectFrom('admin.admin_role').select('did').execute()
      expect(roles.map((row) => row.did)).toEqual([ADMIN_DID])
      const audits = await db
        .selectFrom('admin.admin_audit_event')
        .select(['target_id', 'result'])
        .where('action', '=', 'com.selfcommand.admin.role.create')
        .execute()
      expect(audits).toEqual([{ target_id: 'alice.test', result: 'error' }])
    })

    it('protects the last admin from demotion and revocation', async () => {
      await expect(revokeRole(ctx, { subject: ADMIN_DID })).rejects.toMatchObject({
        status: 409,
        body: { error: 'LastAdmin' },
      })
      await expect(
        updateRole(ctx, { subject: ADMIN_DID, role: 'viewer' }),
      ).rejects.toMatchObject({ status: 409, body: { error: 'LastAdmin' } })

      await createRole(ctx, { subject: SECOND_ADMIN, role: 'admin' })
      await revokeRole(ctx, { subject: ADMIN_DID })

      expect(await getRole(db, SECOND_ADMIN)).toMatchObject({ role: 'admin' })
      await expect(getRole(db, ADMIN_DID)).rejects.toMatchObject({ status: 404 })
    })

    it('rolls the mutation back when the audit insert fails', async () => {
      await sql.raw(`
        create or replace function admin.fail_audit_target() returns trigger
        language plpgsql as $$
        begin
          if new.target_id = '${AUDIT_FAIL}' then
            raise exception 'simulated audit failure';
          end if;
          return new;
        end
        $$
      `).execute(db)
      await sql.raw(`
        create trigger fail_audit_target before insert on admin.admin_audit_event
        for each row execute function admin.fail_audit_target()
      `).execute(db)

      try {
        const before = await countAudits(db)
        await expect(
          createRole(ctx, { subject: AUDIT_FAIL, role: 'viewer' }),
        ).rejects.toThrow(/simulated audit failure/)

        const roles = await db
          .selectFrom('admin.admin_role')
          .select('did')
          .where('did', '=', AUDIT_FAIL)
          .execute()
        expect(roles).toHaveLength(0)
        expect(await countAudits(db)).toBe(before)
      } finally {
        await sql.raw(
          'drop trigger if exists fail_audit_target on admin.admin_audit_event',
        ).execute(db)
        await sql.raw('drop function if exists admin.fail_audit_target()').execute(db)
      }
    })

    it('updates a binding and records the previous role', async () => {
      await createRole(ctx, { subject: OPERATOR, role: 'viewer' })

      const updated = await updateRole(ctx, { subject: OPERATOR, role: 'operator' })

      expect(updated).toMatchObject({ subject: OPERATOR, role: 'operator' })
      const audit = await db
        .selectFrom('admin.admin_audit_event')
        .select('detail')
        .where('action', '=', 'com.selfcommand.admin.role.update')
        .executeTakeFirstOrThrow()
      expect(audit.detail).toBe('role changed from viewer to operator')
    })

    it('filters and paginates role bindings', async () => {
      await createRole(ctx, { subject: VIEWER, role: 'viewer' })
      await createRole(ctx, { subject: OPERATOR, role: 'operator' })
      await createRole(ctx, { subject: 'did:plc:viewer2', role: 'viewer' })

      const viewers = await listRoles(db, { limit: 10, role: 'viewer' })
      expect(viewers.total).toBe(2)

      const search = await listRoles(db, { limit: 10, search: 'did:plc:view' })
      expect(search.total).toBe(2)

      const first = await listRoles(db, { limit: 1 })
      expect(first.roles).toHaveLength(1)
      expect(first.cursor).toBeTruthy()
      const second = await listRoles(db, { limit: 1, cursor: first.cursor })
      expect(second.roles[0]?.subject).not.toBe(first.roles[0]?.subject)
    })

    it('filters and paginates audit events', async () => {
      await expect(
        createRole(ctx, { subject: 'bad', role: 'viewer' }),
      ).rejects.toBeInstanceOf(LexServerError)
      await expect(
        createRole(ctx, { subject: 'also-bad', role: 'viewer' }),
      ).rejects.toBeInstanceOf(LexServerError)

      const errors = await listAuditEvents(db, { limit: 50, result: 'error' })
      expect(errors.total).toBe(2)
      expect(errors.events.every((event) => event.result === 'error')).toBe(true)

      const page = await listAuditEvents(db, { limit: 1, result: 'error' })
      expect(page.events).toHaveLength(1)
      expect(page.cursor).toBeTruthy()
      const next = await listAuditEvents(db, {
        limit: 1,
        result: 'error',
        cursor: page.cursor,
      })
      expect(next.events[0]?.id).toBeLessThan(page.events[0]?.id ?? 0)

      await expect(
        listAuditEvents(db, { limit: 10, since: 'not-a-date' }),
      ).rejects.toMatchObject({ status: 400 })
    })
  })

  describe('directory store', () => {
    const store = () => new KyselyDirectoryStore(db)

    beforeEach(async () => {
      await sql`truncate admin.account_directory, admin.indexer_cursor`.execute(db)
    })

    it('keeps account status when a later identity event arrives', async () => {
      await store().applyBatch({
        stream: FIREHOSE_STREAM,
        cursor: 10,
        rows: [{ did: VIEWER, handle: 'viewer.test' }],
      })
      await store().applyBatch({
        stream: FIREHOSE_STREAM,
        cursor: 11,
        rows: [{ did: VIEWER, status: 'suspended', active: false }],
      })
      await store().applyBatch({
        stream: FIREHOSE_STREAM,
        cursor: 12,
        rows: [{ did: VIEWER, handle: 'viewer2.test' }],
      })

      const account = await store().getAccount(VIEWER)
      expect(account).toMatchObject({
        did: VIEWER,
        handle: 'viewer2.test',
        status: 'suspended',
      })

      const state = await store().getCursor(FIREHOSE_STREAM)
      expect(state).toEqual({ cursor: 12, backfillComplete: false })
    })

    it('never moves the cursor backwards and keeps the backfill flag', async () => {
      await store().applyBatch({
        stream: FIREHOSE_STREAM,
        cursor: 20,
        rows: [{ did: VIEWER, status: 'active', active: true }],
        backfillComplete: true,
      })
      await store().applyBatch({
        stream: FIREHOSE_STREAM,
        cursor: 15,
        rows: [],
      })
      await store().markBackfillComplete(FIREHOSE_STREAM)

      expect(await store().getCursor(FIREHOSE_STREAM)).toEqual({
        cursor: 20,
        backfillComplete: true,
      })
    })

    it('searches, filters and paginates the directory', async () => {
      await store().applyBatch({
        stream: FIREHOSE_STREAM,
        cursor: 1,
        rows: [
          { did: 'did:plc:alice', handle: 'alice.test', status: 'active', active: true },
          { did: 'did:plc:bob', handle: 'bob.test', status: 'suspended', active: false },
          { did: 'did:plc:carol', handle: 'carol.test', status: 'active', active: true },
        ],
      })

      const byHandle = await store().listAccounts({ limit: 10, search: 'bob' })
      expect(byHandle.total).toBe(1)
      expect(byHandle.accounts[0]?.did).toBe('did:plc:bob')

      const byDid = await store().listAccounts({ limit: 10, search: 'did:plc:car' })
      expect(byDid.accounts.map((account) => account.did)).toEqual(['did:plc:carol'])

      const suspended = await store().listAccounts({ limit: 10, status: 'suspended' })
      expect(suspended.total).toBe(1)

      const first = await store().listAccounts({ limit: 1 })
      expect(first.accounts).toHaveLength(1)
      expect(first.cursor).toBeTruthy()
      const second = await store().listAccounts({ limit: 1, cursor: first.cursor })
      expect(second.accounts[0]?.did).not.toBe(first.accounts[0]?.did)
      expect(await store().getAccount('did:plc:missing')).toBeNull()
    })
  })
})

async function countAudits(db: Kysely<Database>): Promise<number> {
  const row = await db
    .selectFrom('admin.admin_audit_event')
    .select(sql<number>`count(*)::int`.as('count'))
    .executeTakeFirstOrThrow()
  return row.count
}
