import { LexServerError } from '@atproto/lex-server'
import { sql, type Kysely } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { bootstrapAdmin, loadRole } from '../src/auth/roles.js'
import { loadConfig, type Config } from '../src/config.js'
import { closeDb, createDb } from '../src/db/index.js'
import { migrateToLatest, migrationStatus } from '../src/db/migrations.js'
import type { Database } from '../src/db/types.js'
import { FIREHOSE_STREAM, KyselyDirectoryStore } from '../src/directory/store.js'
import { silentLogger } from '../src/logger.js'
import {
  createFakeAppview,
  createFakeOzone,
  createFakePds,
  createFakeUpstream,
} from './helpers/fake-upstream.js'
import {
  createApprovalSeal,
  createPasswordSealer,
  deleteAccountAdminGuarded,
  disableAccountInvites,
  updateAccountAdminGuarded,
} from '../src/services/account-admin.js'
import { executeApprovedAction } from '../src/services/approval-actions.js'
import {
  approveApproval,
  cancelApproval,
  createApproval,
  listApprovals,
  rejectApproval,
  type ApprovalContext,
} from '../src/services/approvals.js'
import {
  batchExportAccounts,
  exportAccount,
  getAccountProfile,
  updateAccountProfile,
  type AccountOperationContext,
} from '../src/services/account-operations.js'
import {
  backfillDailyMetrics,
  computeDailyMetric,
  dashboardSeries,
  dayKey,
  shiftDay,
  upsertDailyMetric,
  zonedDayStart,
} from '../src/services/dashboard.js'
import {
  importRolesGuarded,
  resetSettingsGuarded,
  revokeRoleGuarded,
  type GuardedActionContext,
} from '../src/services/guarded-actions.js'
import { actOnSubjects, randomAccount } from '../src/services/moderation.js'
import {
  blockAccess,
  findAccessBlock,
  listAccess,
  listBlocks,
  pruneAccess,
  recordAccess,
  selfAccess,
  unblockAccess,
  type SecurityContext,
} from '../src/services/security.js'
import { exportAuditEvents, listAuditEvents } from '../src/services/audit.js'
import {
  archiveAnnouncement,
  createAnnouncement,
  getAnnouncement,
  listAnnouncements,
  listPublicAnnouncements,
  publishAnnouncement,
  updateAnnouncement,
  type AnnouncementContext,
} from '../src/services/announcements.js'
import { exportAnalytics, exportContent } from '../src/services/exports.js'
import {
  clearApprovalScopeCache,
  isApprovalRequiredFor,
  loadApprovalScope,
  updateApprovalScope,
  type ApprovalScopeContext,
} from '../src/settings/approvals.js'
import {
  createRole,
  exportRoles,
  getRole,
  importRoles,
  listRoles,
  revokeRole,
  updateRole,
  type RoleMutationContext,
} from '../src/services/roles.js'
import { DEFAULT_SETTINGS } from '../src/settings/defaults.js'
import { getBrandingAsset, uploadLogo } from '../src/settings/logo.js'
import { getPreferences, updatePreferences } from '../src/settings/preferences.js'
import {
  exportSettings,
  importSettings,
  loadPublicSettings,
  loadSettings,
  resetSettings,
  settingsHistory,
  updateSettings,
  type SettingsContext,
} from '../src/settings/service.js'

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
      expect(firstMigration.applied).toEqual([
        '001_admin_schema',
        '002_runtime_settings',
        '003_admin_operations',
        '004_moderation_roles',
        '005_announcements',
      ])
      expect(secondMigration.error).toBeUndefined()
      expect(secondMigration.applied).toEqual([])
      expect(status.executed).toEqual([
        '001_admin_schema',
        '002_runtime_settings',
        '003_admin_operations',
        '004_moderation_roles',
        '005_announcements',
      ])
      expect(status.pending).toEqual([])

      const tables = await sql<{ table_name: string }>`
        select table_name from information_schema.tables
        where table_schema = 'admin'
          and table_name in (
            'admin_role', 'admin_audit_event', 'account_directory', 'indexer_cursor',
            'admin_setting', 'admin_setting_revision', 'admin_user_preference',
            'admin_branding_asset', 'account_operation', 'admin_access',
            'admin_access_block', 'admin_approval', 'daily_metric',
            'admin_announcement'
          )
        order by table_name
      `.execute(db)
      expect(tables.rows.map((row) => row.table_name)).toEqual([
        'account_directory',
        'account_operation',
        'admin_access',
        'admin_access_block',
        'admin_announcement',
        'admin_approval',
        'admin_audit_event',
        'admin_branding_asset',
        'admin_role',
        'admin_setting',
        'admin_setting_revision',
        'admin_user_preference',
        'daily_metric',
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
      expect(audit.detail).toBe('角色由只读成员变更为运营员')
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

  describe('runtime settings', () => {
    const settingsCtx = (): SettingsContext => ({
      db,
      logger: silentLogger,
      actor: ADMIN_DID,
      meta: { requestId: 'req-settings-test', actorIp: '127.0.0.1', userAgent: 'vitest' },
    })

    beforeEach(async () => {
      await sql`
        truncate admin.admin_setting, admin.admin_setting_revision,
          admin.admin_branding_asset, admin.admin_user_preference,
          admin.admin_role, admin.admin_audit_event
        restart identity
      `.execute(db)
    })

    it('stores a partition with optimistic locking, revision and audit', async () => {
      const initial = await loadSettings(db)
      expect(initial.settings).toEqual(DEFAULT_SETTINGS)
      expect(initial.meta).toEqual([])

      const branding = { ...DEFAULT_SETTINGS.branding, name: '测试后台', shortName: '测试' }
      const meta = await updateSettings(settingsCtx(), {
        section: 'branding',
        values: branding,
        expectedVersion: 0,
        reason: 'initial branding',
      })
      expect(meta).toMatchObject({ section: 'branding', version: 1, updatedBy: ADMIN_DID })

      await expect(
        updateSettings(settingsCtx(), {
          section: 'branding',
          values: branding,
          expectedVersion: 0,
        }),
      ).rejects.toMatchObject({ status: 409, body: { error: 'SettingsConflict' } })

      const publicView = await loadPublicSettings(db)
      expect(publicView.branding.name).toBe('测试后台')
      expect(publicView.version).toBe(1)

      const history = await settingsHistory(db, { section: 'branding', limit: 10 })
      expect(history.total).toBe(1)
      expect(history.revisions[0]).toMatchObject({
        version: 1,
        reason: 'initial branding',
        requestId: 'req-settings-test',
      })

      const audit = await db
        .selectFrom('admin.admin_audit_event')
        .selectAll()
        .where('action', '=', 'com.selfcommand.admin.settings.update')
        .executeTakeFirstOrThrow()
      expect(audit.before).toMatchObject({ name: DEFAULT_SETTINGS.branding.name })
      expect(audit.after).toMatchObject({ name: '测试后台' })
      expect(audit.request_id).toBe('req-settings-test')
      expect(audit.actor_ip).toBe('127.0.0.1')
    })

    it('resets stored partitions back to the built-in defaults', async () => {
      await updateSettings(settingsCtx(), {
        section: 'theme',
        values: { ...DEFAULT_SETTINGS.theme, radius: 20 },
        expectedVersion: 0,
      })

      const reset = await resetSettings(settingsCtx(), { section: 'theme' })
      expect(reset.settings.theme.radius).toBe(DEFAULT_SETTINGS.theme.radius)
      expect(reset.meta).toContainEqual(
        expect.objectContaining({ section: 'theme', version: 2 }),
      )

      const history = await settingsHistory(db, { section: 'theme', limit: 10 })
      expect(history.total).toBe(2)
      expect(history.revisions[0]?.reason).toBe('恢复默认值')
    })

    it('validates every imported partition before writing anything', async () => {
      await expect(
        importSettings(settingsCtx(), {
          sections: {
            branding: { ...DEFAULT_SETTINGS.branding, name: '新品牌' },
            theme: { ...DEFAULT_SETTINGS.theme, primaryLight: '#ffffff' },
          },
        }),
      ).rejects.toMatchObject({ status: 400 })

      const unchanged = await loadSettings(db)
      expect(unchanged.settings.branding.name).toBe(DEFAULT_SETTINGS.branding.name)
      expect(unchanged.meta).toEqual([])
    })

    it('imports and exports the whole settings document', async () => {
      const result = await importSettings(settingsCtx(), {
        sections: {
          branding: { ...DEFAULT_SETTINGS.branding, name: '导入品牌' },
          ui: { ...DEFAULT_SETTINGS.ui, pageSize: 25 },
        },
        reason: 'restore from backup',
      })
      expect(result.changedSections).toEqual(['branding', 'ui'])
      expect(result.settings.branding.name).toBe('导入品牌')

      const exported = await exportSettings(db)
      expect(exported.sections.branding.name).toBe('导入品牌')
      expect(exported.sections.ui.pageSize).toBe(25)
      expect(exported.meta.map((meta) => meta.section)).toEqual(['branding', 'ui'])
    })

    it('stores preferences per administrator with partial updates', async () => {
      expect(await getPreferences(db, ADMIN_DID)).toEqual({ preferences: {} })

      const first = await updatePreferences(db, ADMIN_DID, {
        preferences: { themeMode: 'dark', pageSize: 20 },
      })
      expect(first.preferences).toEqual({ themeMode: 'dark', pageSize: 20 })

      const second = await updatePreferences(db, ADMIN_DID, {
        preferences: { density: 'compact' },
      })
      expect(second.preferences).toEqual({
        themeMode: 'dark',
        pageSize: 20,
        density: 'compact',
      })

      await expect(
        updatePreferences(db, ADMIN_DID, { preferences: { pageSize: 0 } }),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('stores saved directory views per administrator with validation limits', async () => {
      const saved = await updatePreferences(db, VIEWER, {
        preferences: {
          savedViews: [
            {
              id: 'deactivated',
              name: '已停用账号',
              status: 'deactivated',
              sort: 'indexedAt',
              order: 'desc',
            },
            { id: 'recent', name: '最近索引', sort: 'indexedAt', order: 'asc' },
          ],
        },
      })
      expect(saved.preferences.savedViews).toHaveLength(2)
      expect((await getPreferences(db, VIEWER)).preferences.savedViews?.[0]).toMatchObject({
        id: 'deactivated',
        name: '已停用账号',
        status: 'deactivated',
        sort: 'indexedAt',
        order: 'desc',
      })
      expect((await getPreferences(db, ADMIN_DID)).preferences.savedViews).toBeUndefined()

      const replaced = await updatePreferences(db, VIEWER, {
        preferences: { savedViews: [{ id: 'deactivated', name: '  已停用  ' }] },
      })
      expect(replaced.preferences.savedViews).toEqual([
        { id: 'deactivated', name: '已停用' },
      ])

      const eleven = Array.from({ length: 11 }, (_, index) => ({
        id: `view-${index}`,
        name: `视图 ${index}`,
      }))
      await expect(
        updatePreferences(db, VIEWER, { preferences: { savedViews: eleven } }),
      ).rejects.toMatchObject({ status: 400 })
      await expect(
        updatePreferences(db, VIEWER, {
          preferences: {
            savedViews: [
              { id: 'same', name: '甲' },
              { id: 'same', name: '乙' },
            ],
          },
        }),
      ).rejects.toMatchObject({ status: 400 })
      await expect(
        updatePreferences(db, VIEWER, {
          preferences: { savedViews: [{ id: 'bad id', name: '甲' }] },
        }),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('stores filter macros per administrator with validation limits', async () => {
      const saved = await updatePreferences(db, VIEWER, {
        preferences: {
          filterMacros: [
            {
              id: 'urgent-reports',
              name: '紧急举报',
              scope: 'reports',
              isDefault: true,
              filters: {
                status: 'escalated',
                subjectType: 'record',
                queue: 'abuse',
                keyword: '诈骗',
                types: ['com.atproto.repo.strongRef'],
                direction: 'desc',
                hasComment: true,
              },
            },
            {
              id: 'recent-events',
              name: '近期事件',
              scope: 'events',
              filters: { subject: 'did:plc:abc', direction: 'asc', batchId: 'batch-1' },
            },
          ],
        },
      })
      expect(saved.preferences.filterMacros).toHaveLength(2)
      expect((await getPreferences(db, VIEWER)).preferences.filterMacros?.[0]).toMatchObject({
        id: 'urgent-reports',
        name: '紧急举报',
        scope: 'reports',
        isDefault: true,
        filters: {
          status: 'escalated',
          subjectType: 'record',
          queue: 'abuse',
          keyword: '诈骗',
          types: ['com.atproto.repo.strongRef'],
          direction: 'desc',
          hasComment: true,
        },
      })
      expect((await getPreferences(db, ADMIN_DID)).preferences.filterMacros).toBeUndefined()

      const trimmed = await updatePreferences(db, VIEWER, {
        preferences: {
          filterMacros: [{ id: 'urgent-reports', name: '  紧急举报  ', scope: 'reports' }],
        },
      })
      expect(trimmed.preferences.filterMacros).toEqual([
        { id: 'urgent-reports', name: '紧急举报', scope: 'reports' },
      ])

      const tooMany = Array.from({ length: 21 }, (_, index) => ({
        id: `macro-${index}`,
        name: `宏 ${index}`,
        scope: 'reports' as const,
      }))
      await expect(
        updatePreferences(db, VIEWER, { preferences: { filterMacros: tooMany } }),
      ).rejects.toMatchObject({ status: 400 })
      await expect(
        updatePreferences(db, VIEWER, {
          preferences: {
            filterMacros: [
              { id: 'dup', name: '甲', scope: 'reports' },
              { id: 'dup', name: '乙', scope: 'events' },
            ],
          },
        }),
      ).rejects.toMatchObject({ status: 400 })
      await expect(
        updatePreferences(db, VIEWER, {
          preferences: {
            filterMacros: [{ id: 'bad-scope', name: '甲', scope: 'unknown' }],
          },
        }),
      ).rejects.toMatchObject({ status: 400 })
      await expect(
        updatePreferences(db, VIEWER, {
          preferences: {
            filterMacros: [
              { id: 'default-a', name: '甲', scope: 'reports', isDefault: true },
              { id: 'default-b', name: '乙', scope: 'reports', isDefault: true },
            ],
          },
        }),
      ).rejects.toMatchObject({ status: 400 })
      await expect(
        updatePreferences(db, VIEWER, {
          preferences: {
            filterMacros: [
              {
                id: 'bad-filter',
                name: '甲',
                scope: 'reports',
                filters: { status: 'unknown' },
              },
            ],
          },
        }),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('accepts a PNG logo, replaces it safely and points branding at it', async () => {
      const png = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      ])
      const first = await uploadLogo(settingsCtx(), {
        mime: 'image/png',
        data: png.toString('base64'),
      })
      expect(first).toMatchObject({ url: '/branding/logo?v=1', version: 1 })

      const settings = await loadSettings(db)
      expect(settings.settings.branding).toMatchObject({
        logoSource: 'upload',
        logoUrl: '/branding/logo?v=1',
      })

      const asset = await getBrandingAsset(db)
      expect(asset?.mime).toBe('image/png')
      expect(asset?.bytes.equals(png)).toBe(true)

      const second = await uploadLogo(settingsCtx(), {
        mime: 'image/png',
        data: png.toString('base64'),
      })
      expect(second.version).toBe(2)
      expect(second.url).toBe('/branding/logo?v=2')

      await updateSettings(settingsCtx(), {
        section: 'branding',
        values: { ...DEFAULT_SETTINGS.branding, logoSource: 'icon' },
        expectedVersion: 2,
      })
      expect(await getBrandingAsset(db)).toBeNull()
    })

    it('exports audit events and refuses exports above the row cap', async () => {
      await expect(
        createRole(ctx, { subject: 'bad', role: 'viewer' }),
      ).rejects.toBeInstanceOf(LexServerError)
      await expect(
        createRole(ctx, { subject: 'also-bad', role: 'viewer' }),
      ).rejects.toBeInstanceOf(LexServerError)

      const csv = await exportAuditEvents(db, { format: 'csv' }, 10)
      expect(csv.rows).toBe(2)
      expect(csv.filename).toMatch(/^audit-.*\.csv$/)
      expect(csv.content.replace(/^\ufeff/, '').split('\r\n')[0]).toBe(
        'id,createdAt,actor,action,targetType,target,result,detail,requestId,actorIp,userAgent',
      )

      await expect(exportAuditEvents(db, { format: 'json' }, 1)).rejects.toMatchObject({
        status: 413,
        body: { error: 'ExportTooLarge' },
      })
    })
  })

  describe('role import and export', () => {
    beforeEach(async () => {
      await sql`truncate admin.admin_role, admin.admin_audit_event restart identity`.execute(db)
    })

    it('imports a batch atomically and exports the bindings', async () => {
      const result = await importRoles(ctx, {
        batchId: 'batch-2026-10',
        bindings: [
          { subject: VIEWER, role: 'viewer', note: ' helpdesk ' },
          { subject: OPERATOR, role: 'operator' },
        ],
      })
      expect(result).toEqual({ imported: 2, batchId: 'batch-2026-10' })

      const exported = await exportRoles(db)
      expect(exported.total).toBe(2)
      // Exports are ordered by account identifier so repeated downloads are stable.
      expect(exported.bindings.map((binding) => binding.subject)).toEqual([
        OPERATOR,
        VIEWER,
      ])

      const audit = await db
        .selectFrom('admin.admin_audit_event')
        .selectAll()
        .where('action', '=', 'com.selfcommand.admin.role.import')
        .executeTakeFirstOrThrow()
      expect(audit.target_id).toBe('batch-2026-10')
    })

    it('rejects duplicate subjects and existing bindings without partial writes', async () => {
      await expect(
        importRoles(ctx, {
          bindings: [
            { subject: VIEWER, role: 'viewer' },
            { subject: VIEWER, role: 'operator' },
          ],
        }),
      ).rejects.toMatchObject({ status: 400 })

      await createRole(ctx, { subject: OPERATOR, role: 'operator' })
      await expect(
        importRoles(ctx, {
          bindings: [
            { subject: VIEWER, role: 'viewer' },
            { subject: OPERATOR, role: 'viewer' },
          ],
        }),
      ).rejects.toMatchObject({ status: 409, body: { error: 'RoleExists' } })

      const roles = await db.selectFrom('admin.admin_role').select('did').execute()
      expect(roles.map((row) => row.did)).toEqual([OPERATOR])
    })
  })

  describe('indexer state persistence', () => {
    const store = () => new KyselyDirectoryStore(db)

    beforeEach(async () => {
      await sql`truncate admin.account_directory, admin.indexer_cursor`.execute(db)
    })

    it('persists pause, connection and indexing freshness', async () => {
      expect(await store().getIndexerState(FIREHOSE_STREAM)).toBeNull()

      await store().setConnected(FIREHOSE_STREAM, true)
      await store().applyBatch({
        stream: FIREHOSE_STREAM,
        cursor: 5,
        rows: [{ did: VIEWER, status: 'active', active: true, lastEventAt: new Date() }],
      })
      await store().setPaused(FIREHOSE_STREAM, true, ADMIN_DID)

      const state = await store().getIndexerState(FIREHOSE_STREAM)
      expect(state).toMatchObject({
        cursor: 5,
        connected: true,
        paused: true,
        pausedBy: ADMIN_DID,
      })
      expect(state?.pausedAt).toBeInstanceOf(Date)
      expect(state?.lastIndexedAt).toBeInstanceOf(Date)
      expect(state?.lastEventAt).toBeInstanceOf(Date)
      expect(await store().countAccounts()).toBe(1)

      await store().setPaused(FIREHOSE_STREAM, false, null)
      const resumed = await store().getIndexerState(FIREHOSE_STREAM)
      expect(resumed).toMatchObject({ paused: false, pausedBy: null, pausedAt: null })
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

    it('never samples a deleted account for random review', async () => {
      await store().applyBatch({
        stream: FIREHOSE_STREAM,
        cursor: 2,
        rows: [
          { did: 'did:plc:gone', handle: 'gone.test', status: 'deleted', active: false },
          { did: 'did:plc:alive', handle: 'alive.test', status: 'active', active: true },
        ],
      })

      for (let attempt = 0; attempt < 10; attempt += 1) {
        await expect(randomAccount(db)).resolves.toMatchObject({
          overview: { did: 'did:plc:alive' },
        })
      }

      await db.deleteFrom('admin.account_directory').where('did', '=', 'did:plc:alive').execute()
      await expect(randomAccount(db)).rejects.toMatchObject({
        status: 404,
        body: { error: 'NotFound' },
      })
    })
  })

  describe('account operations', () => {
    const ALICE = 'did:plc:aliceops'
    const BOB = 'did:plc:bobops'
    const store = () => new KyselyDirectoryStore(db)
    const opCtx = (actor = ADMIN_DID): AccountOperationContext => ({
      db,
      logger: silentLogger,
      actor,
      meta: { requestId: 'req-account-ops', actorIp: '10.0.0.8', userAgent: 'vitest' },
    })

    beforeEach(async () => {
      await sql`
        truncate admin.account_directory, admin.account_operation,
          admin.admin_audit_event restart identity
      `.execute(db)
      await db
        .insertInto('admin.account_directory')
        .values([
          {
            did: ALICE,
            handle: 'alice.ops.test',
            status: 'active',
            active: true,
            last_event_at: new Date(),
            first_seen_at: new Date(),
          },
          {
            did: BOB,
            handle: 'bob.ops.test',
            status: 'suspended',
            active: false,
            last_event_at: new Date(),
            first_seen_at: new Date(),
          },
        ])
        .execute()
    })

    it('returns an empty operation record before anything is saved', async () => {
      const profile = await getAccountProfile(db, store(), ALICE)
      expect(profile.account).toMatchObject({ did: ALICE, handle: 'alice.ops.test' })
      expect(profile.operation).toEqual({ did: ALICE, tags: [], syncPaused: false })
      await expect(getAccountProfile(db, store(), 'did:plc:missingops')).rejects.toMatchObject({
        status: 404,
        body: { error: 'AccountNotFound' },
      })
    })

    it('trims, deduplicates and audits note and tag changes', async () => {
      const saved = await updateAccountProfile(opCtx(), {
        did: ALICE,
        note: '  重点客户，已回访  ',
        tags: ['重点客户', '重点客户', ' 续约 '],
      })

      expect(saved.operation).toMatchObject({
        did: ALICE,
        note: '重点客户，已回访',
        tags: ['重点客户', '续约'],
        syncPaused: false,
        updatedBy: ADMIN_DID,
      })

      const audit = await db
        .selectFrom('admin.admin_audit_event')
        .selectAll()
        .where('action', '=', 'com.selfcommand.admin.account.profile.update')
        .executeTakeFirstOrThrow()
      expect(audit).toMatchObject({
        actor_did: ADMIN_DID,
        target_id: ALICE,
        result: 'success',
        request_id: 'req-account-ops',
        detail: '更新运营备注；更新标签（2 个）',
      })
    })

    it('rejects invalid notes, tags and empty updates without writing', async () => {
      await expect(
        updateAccountProfile(opCtx(), { did: ALICE, note: 'a'.repeat(501) }),
      ).rejects.toMatchObject({ status: 400 })
      await expect(
        updateAccountProfile(opCtx(), {
          did: ALICE,
          tags: Array.from({ length: 11 }, (_, index) => `标签${index}`),
        }),
      ).rejects.toMatchObject({ status: 400 })
      await expect(
        updateAccountProfile(opCtx(), { did: ALICE, tags: ['   '] }),
      ).rejects.toMatchObject({ status: 400 })
      await expect(
        updateAccountProfile(opCtx(), { did: ALICE, tags: ['a'.repeat(25)] }),
      ).rejects.toMatchObject({ status: 400 })
      await expect(updateAccountProfile(opCtx(), { did: ALICE })).rejects.toMatchObject({
        status: 400,
      })
      await expect(
        updateAccountProfile(opCtx(), { did: 'did:plc:missingops', note: 'x' }),
      ).rejects.toMatchObject({ status: 404 })
      expect(await db.selectFrom('admin.account_operation').selectAll().execute()).toHaveLength(0)
    })

    it('keeps untouched fields and records the pause actor', async () => {
      await updateAccountProfile(opCtx(), {
        did: ALICE,
        note: '重点客户',
        tags: ['重点客户'],
      })

      const paused = await updateAccountProfile(opCtx(SECOND_ADMIN), {
        did: ALICE,
        syncPaused: true,
      })
      expect(paused.operation).toMatchObject({
        note: '重点客户',
        tags: ['重点客户'],
        syncPaused: true,
        syncPausedBy: SECOND_ADMIN,
        updatedBy: SECOND_ADMIN,
      })
      expect(paused.operation.syncPausedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

      const resumed = await updateAccountProfile(opCtx(), { did: ALICE, syncPaused: false })
      expect(resumed.operation.syncPaused).toBe(false)
      expect(resumed.operation.syncPausedAt).toBeUndefined()
      expect(resumed.operation.syncPausedBy).toBeUndefined()
      expect(resumed.operation.note).toBe('重点客户')
    })

    it('exports a single record and batch CSV/JSON payloads', async () => {
      await updateAccountProfile(opCtx(), { did: ALICE, note: '重点客户, 含逗号' })

      const single = await exportAccount(db, store(), ALICE)
      expect(single.document).toMatchObject({
        account: { did: ALICE, handle: 'alice.ops.test' },
        operation: { note: '重点客户, 含逗号' },
        role: null,
      })
      const recent = single.document.recentAudit as Array<{ action: string }>
      expect(recent.some((event) => event.action.endsWith('account.profile.update'))).toBe(true)

      const csv = await batchExportAccounts(db, [ALICE, BOB, ALICE], 'csv')
      expect(csv.count).toBe(2)
      expect(csv.content.split('\r\n')[0]).toBe(
        'did,handle,status,note,tags,syncPaused,lastEventAt,indexedAt',
      )
      expect(csv.content).toContain('"重点客户, 含逗号"')
      expect(csv.content).toContain('did:plc:bobops,bob.ops.test,suspended,')

      const json = await batchExportAccounts(db, [ALICE, BOB], 'json')
      const parsed = JSON.parse(json.content) as {
        accounts: Array<{ did: string; note: string }>
      }
      expect(parsed.accounts.map((row) => row.did)).toEqual([ALICE, BOB])
      expect(parsed.accounts[0]?.note).toBe('重点客户, 含逗号')

      await expect(batchExportAccounts(db, [], 'json')).rejects.toMatchObject({ status: 400 })
      await expect(batchExportAccounts(db, ['not-a-did'], 'json')).rejects.toMatchObject({
        status: 400,
      })
      await expect(batchExportAccounts(db, [ALICE], 'xml')).rejects.toMatchObject({ status: 400 })
      await expect(
        batchExportAccounts(
          db,
          Array.from({ length: 501 }, (_, index) => `did:plc:bulk${index}`),
          'json',
        ),
      ).rejects.toMatchObject({ status: 400 })
    })
  })

  describe('access records and blocks', () => {
    const secCtx = (actor = ADMIN_DID): SecurityContext => ({
      db,
      logger: silentLogger,
      actor,
      meta: { requestId: 'req-security', actorIp: '198.51.100.9', userAgent: 'vitest' },
    })

    beforeEach(async () => {
      await sql`
        truncate admin.admin_access, admin.admin_access_block,
          admin.admin_audit_event restart identity
      `.execute(db)
    })

    it('aggregates repeated access and filters by account', async () => {
      await recordAccess(db, { did: VIEWER, ip: '203.0.113.1', userAgent: 'Firefox' })
      await recordAccess(db, { did: VIEWER, ip: '203.0.113.1', userAgent: 'Firefox' })
      await recordAccess(db, { did: OPERATOR, ip: '203.0.113.2' })

      const all = await listAccess(db, { limit: 10 })
      expect(all.total).toBe(2)
      expect(all.records[0]).toMatchObject({ did: OPERATOR, ip: '203.0.113.2' })

      const viewer = await listAccess(db, { limit: 10, did: VIEWER })
      expect(viewer.records).toHaveLength(1)
      expect(viewer.records[0]).toMatchObject({
        did: VIEWER,
        requestCount: 2,
        userAgent: 'Firefox',
      })

      await expect(listAccess(db, { limit: 10, did: 'not-a-did' })).rejects.toMatchObject({
        status: 400,
      })
    })

    it('paginates access records without repeating rows', async () => {
      for (const ip of ['203.0.113.11', '203.0.113.12', '203.0.113.13']) {
        await recordAccess(db, { did: VIEWER, ip })
      }
      const first = await listAccess(db, { limit: 1 })
      expect(first.cursor).toBeTruthy()
      const second = await listAccess(db, { limit: 1, cursor: first.cursor })
      expect(second.records[0]?.ip).not.toBe(first.records[0]?.ip)
      await expect(listAccess(db, { limit: 1, cursor: 'broken' })).rejects.toMatchObject({
        status: 400,
      })
    })

    it('blocks and unblocks another administrator with audits', async () => {
      await expect(
        blockAccess(secCtx(ADMIN_DID), { did: ADMIN_DID, reason: '尝试封锁自己' }),
      ).rejects.toMatchObject({ status: 400 })

      const { block } = await blockAccess(secCtx(ADMIN_DID), {
        did: VIEWER,
        reason: '  疑似账号泄露  ',
      })
      expect(block).toMatchObject({
        did: VIEWER,
        blockedBy: ADMIN_DID,
        reason: '疑似账号泄露',
      })
      expect(await findAccessBlock(db, VIEWER)).toMatchObject({ did: VIEWER })

      const self = await selfAccess(db, VIEWER)
      expect(self).toMatchObject({
        blocked: true,
        blockedBy: ADMIN_DID,
        reason: '疑似账号泄露',
      })

      await expect(
        unblockAccess(secCtx(ADMIN_DID), { did: ADMIN_DID }),
      ).rejects.toMatchObject({ status: 400 })

      expect(await unblockAccess(secCtx(SECOND_ADMIN), { did: VIEWER })).toEqual({
        blocked: false,
      })
      expect(await findAccessBlock(db, VIEWER)).toBeNull()
      expect((await selfAccess(db, VIEWER)).blocked).toBe(false)

      const audits = await db
        .selectFrom('admin.admin_audit_event')
        .select(['action', 'target_id', 'result', 'detail'])
        .where('action', 'in', [
          'com.selfcommand.admin.security.block',
          'com.selfcommand.admin.security.unblock',
        ])
        .orderBy('id', 'asc')
        .execute()
      expect(audits).toEqual([
        {
          action: 'com.selfcommand.admin.security.block',
          target_id: VIEWER,
          result: 'success',
          detail: '封锁后台访问（原因：疑似账号泄露）',
        },
        {
          action: 'com.selfcommand.admin.security.unblock',
          target_id: VIEWER,
          result: 'success',
          detail: '解除后台访问封锁',
        },
      ])
    })

    it('lists blocks newest first with a stable cursor', async () => {
      await blockAccess(secCtx(ADMIN_DID), { did: VIEWER, reason: '账号共享' })
      await blockAccess(secCtx(ADMIN_DID), { did: OPERATOR, reason: '重复登录异常' })

      const first = await listBlocks(db, { limit: 1 })
      expect(first.total).toBe(2)
      expect(first.blocks).toHaveLength(1)
      expect(first.blocks[0]).toMatchObject({ did: OPERATOR, reason: '重复登录异常' })
      expect(first.cursor).toBeTruthy()

      const second = await listBlocks(db, { limit: 1, cursor: first.cursor })
      expect(second.blocks[0]).toMatchObject({ did: VIEWER, reason: '账号共享' })

      await expect(listBlocks(db, { limit: 10, cursor: 'broken' })).rejects.toMatchObject({
        status: 400,
      })
    })

    it('prunes access records past the retention window', async () => {
      await db
        .insertInto('admin.admin_access')
        .values({
          did: VIEWER,
          ip: '192.0.2.1',
          user_agent: 'old-agent',
          first_seen_at: new Date('2026-01-01T00:00:00.000Z'),
          last_seen_at: new Date('2026-01-01T00:00:00.000Z'),
          request_count: 3,
        })
        .execute()
      await recordAccess(db, { did: VIEWER, ip: '192.0.2.2', userAgent: 'new-agent' })

      expect(await pruneAccess(db)).toBe(1)
      const remaining = await listAccess(db, { limit: 10 })
      expect(remaining.total).toBe(1)
      expect(remaining.records[0]?.ip).toBe('192.0.2.2')
    })
  })

  describe('two-person approvals', () => {
    const THIRD = 'did:plc:thirdadmin'
    const guardCtx = (actor: string): GuardedActionContext => ({
      db,
      logger: silentLogger,
      actor,
      meta: { requestId: 'req-approval', actorIp: '10.0.0.9', userAgent: 'vitest' },
      ttlHours: 24,
    })
    const approvalCtx = (actor: string): ApprovalContext => ({
      db,
      logger: silentLogger,
      actor,
      meta: { requestId: 'req-approval', actorIp: '10.0.0.9', userAgent: 'vitest' },
      ttlHours: 24,
    })
    const runApproved = (actor: string, id: string) =>
      approveApproval(approvalCtx(actor), id, (trx, action, payload) =>
        executeApprovedAction(trx, action, payload, {
          db,
          logger: silentLogger,
          actor,
          meta: {},
          approvalId: id,
          ozone: createFakeOzone(),
          appview: createFakeAppview(),
          pds: createFakePds(),
          senderDid: config.serviceDid,
        }),
      )

    beforeEach(async () => {
      await sql`
        truncate admin.admin_role, admin.admin_approval,
          admin.admin_audit_event restart identity
      `.execute(db)
      expect(await bootstrapAdmin(db, config, silentLogger)).toBe(true)
      await createRole(ctx, { subject: SECOND_ADMIN, role: 'admin' })
      await createRole(ctx, { subject: THIRD, role: 'admin' })
    })

    it('requires a second administrator and executes the request once', async () => {
      await expect(
        revokeRoleGuarded(guardCtx(ADMIN_DID), { subject: SECOND_ADMIN }),
      ).rejects.toMatchObject({ status: 409, body: { error: 'ApprovalRequired' } })

      const created = await createApproval(approvalCtx(ADMIN_DID), {
        action: 'role.revoke',
        targetType: 'role',
        target: SECOND_ADMIN,
        payload: { subject: SECOND_ADMIN },
      })
      expect(created.approval).toMatchObject({
        status: 'pending',
        action: 'role.revoke',
        requestedBy: ADMIN_DID,
        target: SECOND_ADMIN,
        summary: '撤销管理员角色（did:plc:secondadmin）',
      })
      const ttl = new Date(created.approval.expiresAt).getTime() - Date.now()
      expect(ttl).toBeGreaterThan(23 * 60 * 60 * 1000)

      await expect(
        runApproved(ADMIN_DID, created.approval.id),
      ).rejects.toMatchObject({ status: 403, body: { error: 'Forbidden' } })

      const approved = await runApproved(THIRD, created.approval.id)
      expect(approved.approval).toMatchObject({ status: 'executed', decidedBy: THIRD })
      expect(await loadRole(db, SECOND_ADMIN)).toBeNull()

      const revokeAudit = await db
        .selectFrom('admin.admin_audit_event')
        .selectAll()
        .where('action', '=', 'com.selfcommand.admin.role.revoke')
        .executeTakeFirstOrThrow()
      expect(revokeAudit).toMatchObject({
        actor_did: THIRD,
        target_id: SECOND_ADMIN,
        result: 'success',
        approval_id: created.approval.id,
      })

      await expect(runApproved(THIRD, created.approval.id)).rejects.toMatchObject({
        status: 409,
        body: { error: 'ApprovalState' },
      })
      const approveAudits = await db
        .selectFrom('admin.admin_audit_event')
        .select('result')
        .where('action', '=', 'com.selfcommand.admin.approval.approve')
        .execute()
      expect(approveAudits.map((row) => row.result)).toEqual(['success'])
    })

    it('rejects, cancels and lists requests by status', async () => {
      const rejected = await createApproval(approvalCtx(ADMIN_DID), {
        action: 'settings.resetAll',
        payload: { reason: ' 例行重置 ' },
      })
      const decision = await rejectApproval(
        approvalCtx(SECOND_ADMIN),
        rejected.approval.id,
        '  暂不重置  ',
      )
      expect(decision.approval).toMatchObject({
        status: 'rejected',
        decidedBy: SECOND_ADMIN,
        error: '暂不重置',
      })
      await expect(
        rejectApproval(approvalCtx(THIRD), rejected.approval.id, undefined),
      ).rejects.toMatchObject({ status: 409, body: { error: 'ApprovalState' } })

      const cancelled = await createApproval(approvalCtx(ADMIN_DID), {
        action: 'settings.resetAll',
        payload: {},
      })
      await expect(
        cancelApproval(approvalCtx(SECOND_ADMIN), cancelled.approval.id),
      ).rejects.toMatchObject({ status: 403, body: { error: 'Forbidden' } })
      expect(
        (await cancelApproval(approvalCtx(ADMIN_DID), cancelled.approval.id)).approval.status,
      ).toBe('cancelled')
      await expect(
        cancelApproval(approvalCtx(ADMIN_DID), cancelled.approval.id),
      ).rejects.toMatchObject({ status: 409 })
      await expect(cancelApproval(approvalCtx(ADMIN_DID), 'missing')).rejects.toMatchObject({
        status: 404,
        body: { error: 'ApprovalNotFound' },
      })

      const pending = await listApprovals(db, { status: 'pending', limit: 10 })
      expect(pending.total).toBe(0)
      expect((await listApprovals(db, { status: 'rejected', limit: 10 })).approvals[0]?.id).toBe(
        rejected.approval.id,
      )
      const page = await listApprovals(db, { limit: 1 })
      const next = await listApprovals(db, { limit: 1, cursor: page.cursor })
      expect(next.approvals[0]?.id).not.toBe(page.approvals[0]?.id)
      await expect(listApprovals(db, { status: 'bogus', limit: 10 })).rejects.toMatchObject({
        status: 400,
      })
    })

    it('expires overdue requests before they can be approved', async () => {
      const created = await createApproval(approvalCtx(ADMIN_DID), {
        action: 'settings.resetAll',
        payload: {},
      })
      await sql`
        update admin.admin_approval
        set expires_at = now() - interval '1 minute'
        where id = ${created.approval.id}
      `.execute(db)

      await expect(runApproved(THIRD, created.approval.id)).rejects.toMatchObject({
        status: 409,
        body: { error: 'ApprovalState' },
      })
      // Listing is what durably flips overdue pending rows to expired.
      const listed = await listApprovals(db, { limit: 10 })
      expect(listed.approvals.find((approval) => approval.id === created.approval.id)?.status).toBe(
        'expired',
      )
      const row = await db
        .selectFrom('admin.admin_approval')
        .select('status')
        .where('id', '=', created.approval.id)
        .executeTakeFirstOrThrow()
      expect(row.status).toBe('expired')
    })

    it('marks a request failed when the approved action fails', async () => {
      const created = await createApproval(approvalCtx(ADMIN_DID), {
        action: 'role.demote',
        target: 'did:plc:missingrole',
        payload: { subject: 'did:plc:missingrole', role: 'viewer' },
      })

      await expect(runApproved(THIRD, created.approval.id)).rejects.toMatchObject({
        status: 404,
        body: { error: 'RoleNotFound' },
      })
      const row = await db
        .selectFrom('admin.admin_approval')
        .select(['status', 'error', 'decided_by'])
        .where('id', '=', created.approval.id)
        .executeTakeFirstOrThrow()
      expect(row).toMatchObject({ status: 'failed', decided_by: THIRD })
      expect(row.error ?? '').toContain('role binding')
      const audit = await db
        .selectFrom('admin.admin_audit_event')
        .select(['result', 'detail'])
        .where('action', '=', 'com.selfcommand.admin.approval.approve')
        .executeTakeFirstOrThrow()
      expect(audit).toMatchObject({
        result: 'error',
        detail: '批准后执行失败：降级管理员角色',
      })
    })

    it('refuses to execute a request with a different action or payload', async () => {
      const created = await createApproval(approvalCtx(ADMIN_DID), {
        action: 'role.revoke',
        target: SECOND_ADMIN,
        payload: { subject: SECOND_ADMIN },
      })

      await expect(
        revokeRoleGuarded(guardCtx(THIRD), {
          subject: THIRD,
          approvalId: created.approval.id,
        }),
      ).rejects.toMatchObject({ status: 409, body: { error: 'ApprovalState' } })

      const demote = await createApproval(approvalCtx(ADMIN_DID), {
        action: 'role.demote',
        target: SECOND_ADMIN,
        payload: { subject: SECOND_ADMIN, role: 'viewer' },
      })
      await expect(
        revokeRoleGuarded(guardCtx(THIRD), {
          subject: SECOND_ADMIN,
          approvalId: demote.approval.id,
        }),
      ).rejects.toMatchObject({ status: 409, body: { error: 'ApprovalState' } })

      expect(await loadRole(db, SECOND_ADMIN)).toBe('admin')
      expect(await loadRole(db, THIRD)).toBe('admin')
    })

    it('lets the sole administrator run guarded actions without a second approver', async () => {
      await sql`truncate admin.admin_role, admin.admin_approval restart identity`.execute(db)
      expect(await bootstrapAdmin(db, config, silentLogger)).toBe(true)

      const imported = await importRolesGuarded(guardCtx(ADMIN_DID), {
        bindings: [{ subject: VIEWER, role: 'viewer' }],
      })
      expect(imported).toMatchObject({ imported: 1 })
      expect(await loadRole(db, VIEWER)).toBe('viewer')

      const reset = await resetSettingsGuarded(guardCtx(ADMIN_DID), { reason: '单管理员重置' })
      expect(reset.settings).toBeTruthy()

      await expect(
        revokeRoleGuarded(guardCtx(ADMIN_DID), { subject: ADMIN_DID }),
      ).rejects.toMatchObject({ status: 409, body: { error: 'LastAdmin' } })
    })
  })

  describe('announcements, approval scope and exports', () => {
    const ANNOUNCEMENT_CTX_META = {
      requestId: 'req-announcement',
      actorIp: '10.0.0.12',
      userAgent: 'vitest',
    }
    const announcementCtx = (actor: string): AnnouncementContext => ({
      db,
      logger: silentLogger,
      actor,
      meta: ANNOUNCEMENT_CTX_META,
      ttlHours: 24,
    })
    const approvalCtx = (actor: string): ApprovalContext => ({
      db,
      logger: silentLogger,
      actor,
      meta: ANNOUNCEMENT_CTX_META,
      ttlHours: 24,
    })
    const scopeCtx = (actor: string): ApprovalScopeContext => ({
      db,
      logger: silentLogger,
      actor,
      meta: ANNOUNCEMENT_CTX_META,
    })
    const runApproved = (
      actor: string,
      id: string,
      overrides: { ozone?: ReturnType<typeof createFakeOzone> } = {},
    ) =>
      approveApproval(approvalCtx(actor), id, (trx, action, payload) =>
        executeApprovedAction(trx, action, payload, {
          db,
          logger: silentLogger,
          actor,
          meta: {},
          approvalId: id,
          ozone: overrides.ozone ?? createFakeOzone(),
          appview: createFakeAppview(),
          pds: createFakePds(),
          senderDid: config.serviceDid,
        }),
      )
    const draft = (actor: string, overrides: Partial<Parameters<typeof createAnnouncement>[1]> = {}) =>
      createAnnouncement(announcementCtx(actor), {
        title: '系统维护通知',
        body: '今晚 22:00 起进行维护，预计 30 分钟。',
        level: 'warning',
        placement: 'app',
        ...overrides,
      })

    beforeEach(async () => {
      await sql`
        truncate admin.admin_role, admin.admin_approval, admin.admin_announcement,
          admin.admin_audit_event restart identity
      `.execute(db)
      await sql`delete from admin.admin_setting where section = 'approvals'`.execute(db)
      clearApprovalScopeCache(db)
      expect(await bootstrapAdmin(db, config, silentLogger)).toBe(true)
    })

    it('enforces announcement constraints and records drafts', async () => {
      await expect(
        sql`
          insert into admin.admin_announcement (title, body, level, placement, status, created_by)
          values ('标题', '正文', 'urgent', 'app', 'draft', 'did:plc:adminfirst')
        `.execute(db),
      ).rejects.toThrow()
      await expect(
        sql`
          insert into admin.admin_announcement (title, body, level, placement, status, created_by)
          values ('标题', '正文', 'info', 'web', 'draft', 'did:plc:adminfirst')
        `.execute(db),
      ).rejects.toThrow()
      await expect(
        sql`
          insert into admin.admin_announcement
            (title, body, level, placement, status, created_by, starts_at, ends_at)
          values ('标题', '正文', 'info', 'app', 'draft', 'did:plc:adminfirst',
            '2026-10-30T10:00:00Z', '2026-10-30T09:00:00Z')
        `.execute(db),
      ).rejects.toThrow()

      const created = await draft(ADMIN_DID)
      expect(created.announcement).toMatchObject({
        title: '系统维护通知',
        level: 'warning',
        placement: 'app',
        status: 'draft',
        createdBy: ADMIN_DID,
      })
      const audit = await db
        .selectFrom('admin.admin_audit_event')
        .selectAll()
        .where('action', '=', 'com.selfcommand.admin.announcement.create')
        .executeTakeFirstOrThrow()
      expect(audit).toMatchObject({
        target_type: 'announcement',
        target_id: String(created.announcement.id),
        result: 'success',
        request_id: 'req-announcement',
      })
    })

    it('rejects invalid announcement text and time windows', async () => {
      await expect(draft(ADMIN_DID, { title: '<b>加粗</b>' })).rejects.toMatchObject({
        status: 400,
        body: { error: 'InvalidRequest' },
      })
      await expect(draft(ADMIN_DID, { title: '   ' })).rejects.toMatchObject({
        status: 400,
        body: { error: 'InvalidRequest' },
      })
      await expect(
        draft(ADMIN_DID, {
          startsAt: '2026-11-01T10:00:00.000Z',
          endsAt: '2026-11-01T09:00:00.000Z',
        }),
      ).rejects.toMatchObject({ status: 400, body: { error: 'InvalidRequest' } })
      await expect(getAnnouncement(db, 999)).rejects.toMatchObject({
        status: 404,
        body: { error: 'NotFound' },
      })
    })

    it('updates drafts only and lists them with filters', async () => {
      const created = await draft(ADMIN_DID)
      const updated = await updateAnnouncement(announcementCtx(ADMIN_DID), {
        id: created.announcement.id,
        title: '系统维护通知（更新）',
        body: '维护时间调整为 23:00。',
        level: 'critical',
        placement: 'app',
      })
      expect(updated.announcement).toMatchObject({
        title: '系统维护通知（更新）',
        level: 'critical',
        status: 'draft',
      })

      const listed = await listAnnouncements(db, { q: '维护', limit: 50 })
      expect(listed.announcements.map((item) => item.id)).toEqual([created.announcement.id])

      const published = await draft(ADMIN_DID, { title: '上线公告' })
      await publishAnnouncement(announcementCtx(ADMIN_DID), {
        id: published.announcement.id,
      })
      await expect(
        updateAnnouncement(announcementCtx(ADMIN_DID), {
          id: published.announcement.id,
          title: '修改已发布公告',
          body: '不应成功。',
          level: 'info',
          placement: 'app',
        }),
      ).rejects.toMatchObject({ status: 409, body: { error: 'InvalidState' } })
    })

    it('publishes and archives with the sole-admin bypass', async () => {
      const created = await draft(ADMIN_DID)
      const published = await publishAnnouncement(announcementCtx(ADMIN_DID), {
        id: created.announcement.id,
      })
      expect(published.announcement).toMatchObject({
        status: 'published',
        publishedBy: ADMIN_DID,
      })
      const publicList = await listPublicAnnouncements(db, { limit: 20 })
      expect(publicList.announcements).toEqual([
        expect.objectContaining({ title: '系统维护通知', level: 'warning', placement: 'app' }),
      ])
      expect(publicList.announcements[0]).not.toHaveProperty('id')
      expect(publicList.announcements[0]).not.toHaveProperty('createdBy')

      await expect(
        publishAnnouncement(announcementCtx(ADMIN_DID), { id: created.announcement.id }),
      ).rejects.toMatchObject({ status: 409, body: { error: 'InvalidState' } })

      const archived = await archiveAnnouncement(announcementCtx(ADMIN_DID), {
        id: created.announcement.id,
      })
      expect(archived.announcement.status).toBe('archived')
      expect((await listPublicAnnouncements(db, { limit: 20 })).announcements).toEqual([])
      await expect(
        archiveAnnouncement(announcementCtx(ADMIN_DID), { id: created.announcement.id }),
      ).rejects.toMatchObject({ status: 409, body: { error: 'InvalidState' } })
    })

    it('requires approval to publish when other administrators exist', async () => {
      await createRole(ctx, { subject: SECOND_ADMIN, role: 'admin' })
      const created = await draft(ADMIN_DID)

      await expect(
        publishAnnouncement(announcementCtx(ADMIN_DID), { id: created.announcement.id }),
      ).rejects.toMatchObject({ status: 409, body: { error: 'ApprovalRequired' } })

      const approval = await createApproval(approvalCtx(ADMIN_DID), {
        action: 'announcement.publish',
        targetType: 'announcement',
        target: String(created.announcement.id),
        payload: { announcementId: created.announcement.id },
      })
      expect(approval.approval).toMatchObject({
        action: 'announcement.publish',
        status: 'pending',
      })
      const executed = await runApproved(SECOND_ADMIN, approval.approval.id)
      expect(executed.approval.status).toBe('executed')

      const published = await getAnnouncement(db, created.announcement.id)
      expect(published.announcement).toMatchObject({
        status: 'published',
        publishedBy: SECOND_ADMIN,
      })
      const audit = await db
        .selectFrom('admin.admin_audit_event')
        .selectAll()
        .where('action', '=', 'com.selfcommand.admin.announcement.publish')
        .executeTakeFirstOrThrow()
      expect(audit).toMatchObject({
        approval_id: approval.approval.id,
        result: 'success',
      })
    })

    it('returns only published announcements inside their window', async () => {
      const now = Date.now()
      const insert = (
        title: string,
        status: string,
        startsAt: Date | null,
        endsAt: Date | null,
        placement = 'app',
      ) =>
        db
          .insertInto('admin.admin_announcement')
          .values({
            title,
            body: `${title}正文`,
            level: 'info',
            placement,
            status: status as 'draft' | 'published' | 'archived',
            starts_at: startsAt,
            ends_at: endsAt,
            created_by: ADMIN_DID,
          })
          .execute()
      await insert('生效公告', 'published', new Date(now - 60_000), new Date(now + 60_000))
      await insert('未开始公告', 'published', new Date(now + 60_000), null)
      await insert('已过期公告', 'published', null, new Date(now - 60_000))
      await insert('草稿公告', 'draft', null, null)
      await insert('已下线公告', 'archived', null, null)
      await insert('管理端公告', 'published', null, null, 'admin')

      const appList = await listPublicAnnouncements(db, { placement: 'app', limit: 20 })
      expect(appList.announcements.map((item) => item.title)).toEqual(['生效公告'])
      const adminList = await listPublicAnnouncements(db, { placement: 'admin', limit: 20 })
      expect(adminList.announcements.map((item) => item.title)).toEqual(['管理端公告'])
    })

    it('appends approval scope without allowing built-in or unknown actions', async () => {
      const initial = await loadApprovalScope(db)
      expect(initial.additionalActions).toEqual([])
      expect(initial.builtInActions).toContain('announcement.publish')
      expect(initial.availableActions).toContain('moderation.label')
      expect(await isApprovalRequiredFor(db, 'moderation.label')).toBe(false)

      const updated = await updateApprovalScope(scopeCtx(ADMIN_DID), {
        additionalActions: ['moderation.label'],
        reason: '标签影响范围较大',
      })
      expect(updated).toMatchObject({
        additionalActions: ['moderation.label'],
        version: 1,
      })
      expect(await isApprovalRequiredFor(db, 'moderation.label')).toBe(true)

      await expect(
        updateApprovalScope(scopeCtx(ADMIN_DID), {
          additionalActions: ['role.revoke'],
        }),
      ).rejects.toMatchObject({ status: 400, body: { error: 'InvalidRequest' } })
      await expect(
        updateApprovalScope(scopeCtx(ADMIN_DID), {
          additionalActions: ['moderation.unknown'],
        }),
      ).rejects.toMatchObject({ status: 400, body: { error: 'InvalidRequest' } })

      const noop = await updateApprovalScope(scopeCtx(ADMIN_DID), {
        additionalActions: [],
      })
      expect(noop).toMatchObject({
        additionalActions: ['moderation.label'],
        version: 1,
      })

      const audit = await db
        .selectFrom('admin.admin_audit_event')
        .selectAll()
        .where('action', '=', 'com.selfcommand.admin.settings.approvals.update')
        .executeTakeFirstOrThrow()
      expect(audit).toMatchObject({ target_id: '审批范围', result: 'success' })
      expect(JSON.stringify(audit.after)).toContain('moderation.label')
    })

    it('applies the appended label approval to moderation actions', async () => {
      await createRole(ctx, { subject: SECOND_ADMIN, role: 'admin' })
      await updateApprovalScope(scopeCtx(ADMIN_DID), {
        additionalActions: ['moderation.label'],
      })
      const record = 'at://did:plc:author/app.bsky.feed.post/3klabel'
      const ozone = createFakeUpstream((nsid) => {
        if (nsid === 'tools.ozone.moderation.getRecords') {
          return { records: [{ uri: record, cid: 'bafyreicid' }] }
        }
        if (nsid === 'tools.ozone.moderation.emitEvent') return { id: 42 }
        return {}
      })
      const moderationCtx = {
        ozone,
        logger: silentLogger,
        db,
        actor: ADMIN_DID,
        meta: ANNOUNCEMENT_CTX_META,
        ttlHours: 24,
      }
      await expect(
        actOnSubjects(moderationCtx, {
          subjects: [record],
          action: 'label',
          labels: ['spam'],
        }),
      ).rejects.toMatchObject({ status: 409, body: { error: 'ApprovalRequired' } })

      const approval = await createApproval(approvalCtx(ADMIN_DID), {
        action: 'moderation.label',
        targetType: 'moderation',
        target: record,
        payload: { subjects: [record], action: 'label', labels: ['spam'] },
      })
      const executed = await runApproved(SECOND_ADMIN, approval.approval.id, { ozone })
      expect(executed.approval.status).toBe('executed')
      const emitted = ozone.calls.filter(
        (call) => call.nsid === 'tools.ozone.moderation.emitEvent',
      )
      expect(emitted).toHaveLength(1)
      expect(emitted[0]?.options?.body).toMatchObject({
        event: { $type: 'tools.ozone.moderation.defs#modEventLabel', createLabelVals: ['spam'] },
      })
    })

    it('audits content and analytics exports with filters and row counts', async () => {
      const appview = createFakeUpstream((nsid) => {
        if (nsid !== 'app.bsky.feed.searchPosts') return {}
        return {
          posts: [1, 2, 3].map((index) => ({
            uri: `at://did:plc:author/app.bsky.feed.post/${index}`,
            author: { did: 'did:plc:author', handle: 'author.test' },
            record: { text: '社区内容' },
            indexedAt: '2026-10-29T01:00:00.000Z',
          })),
        }
      })
      const content = await exportContent(
        { appview, logger: silentLogger },
        { db, logger: silentLogger, actor: ADMIN_DID, meta: ANNOUNCEMENT_CTX_META },
        { q: '社区', author: 'author.test' },
      )
      expect(content.rows).toBe(3)
      expect(content.truncated).toBe(false)
      const contentAudit = await db
        .selectFrom('admin.admin_audit_event')
        .selectAll()
        .where('action', '=', 'com.selfcommand.admin.content.export')
        .executeTakeFirstOrThrow()
      expect(contentAudit.detail).toContain('关键词「社区」')
      expect(contentAudit.detail).toContain('作者 author.test')
      expect(contentAudit.detail).toContain('3 行')
      expect(contentAudit.result).toBe('success')

      const ozone = createFakeUpstream((nsid) => {
        if (nsid === 'tools.ozone.report.getHistoricalStats') {
          return {
            stats: [
              {
                date: '2026-10-29',
                inboundCount: 4,
                pendingCount: 1,
                closedCount: 2,
                escalatedCount: 0,
                actionedCount: 2,
                acknowledgedCount: 1,
              },
            ],
          }
        }
        return { stats: {} }
      })
      const analytics = await exportAnalytics(
        { ozone, logger: silentLogger },
        { db, logger: silentLogger, actor: ADMIN_DID, meta: ANNOUNCEMENT_CTX_META },
        { days: 7 },
      )
      expect(analytics.rows).toBe(1)
      const analyticsAudit = await db
        .selectFrom('admin.admin_audit_event')
        .selectAll()
        .where('action', '=', 'com.selfcommand.admin.analytics.export')
        .executeTakeFirstOrThrow()
      expect(analyticsAudit.detail).toContain('最近 7 天')
      expect(analyticsAudit.detail).toContain('1 天')
    })
  })

  describe('PDS account administration', () => {
    const TARGET = 'did:plc:pdsaccount'
    const PASSWORD = 'integration-account-password'
    const sealer = createPasswordSealer('integration-pds-admin')
    let pds: ReturnType<typeof createFakePds>
    const meta = { requestId: 'req-pds-account', actorIp: '10.0.0.10', userAgent: 'vitest' }
    const writeCtx = (actor = ADMIN_DID) => ({ db, pds, logger: silentLogger, actor, meta })
    const approvalCtx = (actor: string): ApprovalContext => ({
      db,
      logger: silentLogger,
      actor,
      meta,
      ttlHours: 24,
      seal: createApprovalSeal(sealer),
    })
    const runApproved = (actor: string, id: string, withSealer = true) =>
      approveApproval(approvalCtx(actor), id, (trx, action, payload) =>
        executeApprovedAction(trx, action, payload, {
          db,
          logger: silentLogger,
          actor,
          meta: {},
          approvalId: id,
          ozone: createFakeOzone(),
          appview: createFakeAppview(),
          pds,
          senderDid: config.serviceDid,
          ...(withSealer ? { sealer } : {}),
        }),
      )

    beforeEach(async () => {
      pds = createFakePds()
      await sql`
        truncate admin.admin_role, admin.admin_approval,
          admin.admin_audit_event restart identity
      `.execute(db)
      expect(await bootstrapAdmin(db, config, silentLogger)).toBe(true)
      await createRole(ctx, { subject: SECOND_ADMIN, role: 'admin' })
    })

    it('requires approval before touching the PDS once a second administrator exists', async () => {
      await expect(
        updateAccountAdminGuarded(writeCtx(), { did: TARGET, email: 'new@example.test' }),
      ).rejects.toMatchObject({ status: 409, body: { error: 'ApprovalRequired' } })
      await expect(
        deleteAccountAdminGuarded(writeCtx(), { did: TARGET }),
      ).rejects.toMatchObject({ status: 409, body: { error: 'ApprovalRequired' } })
      expect(pds.calls).toHaveLength(0)
    })

    it('seals the password and executes the update once approved', async () => {
      const created = await createApproval(approvalCtx(ADMIN_DID), {
        action: 'account.admin.update',
        targetType: 'account',
        target: TARGET,
        payload: { did: TARGET, email: 'new@example.test', password: PASSWORD },
      })

      const pending = await db
        .selectFrom('admin.admin_approval')
        .selectAll()
        .where('id', '=', created.approval.id)
        .executeTakeFirstOrThrow()
      const stored = pending.payload as Record<string, unknown>
      expect(stored).toMatchObject({ did: TARGET, email: 'new@example.test' })
      expect(stored.password).toBeUndefined()
      expect(typeof stored.passwordSealed).toBe('string')
      expect(JSON.stringify(pending)).not.toContain(PASSWORD)

      await expect(runApproved(ADMIN_DID, created.approval.id)).rejects.toMatchObject({
        status: 403,
      })

      const approved = await runApproved(SECOND_ADMIN, created.approval.id)
      expect(approved.approval.status).toBe('executed')
      expect(
        pds.calls.find(
          (call) => call.nsid === 'com.atproto.admin.updateAccountPassword',
        )?.options?.body,
      ).toEqual({ did: TARGET, password: PASSWORD })

      const executed = await db
        .selectFrom('admin.admin_approval')
        .selectAll()
        .where('id', '=', created.approval.id)
        .executeTakeFirstOrThrow()
      expect((executed.payload as Record<string, unknown>).passwordSealed).toBeUndefined()

      const audit = await db
        .selectFrom('admin.admin_audit_event')
        .selectAll()
        .where('action', '=', 'com.selfcommand.admin.account.admin.update')
        .executeTakeFirstOrThrow()
      expect(audit).toMatchObject({
        actor_did: SECOND_ADMIN,
        target_id: TARGET,
        approval_id: created.approval.id,
        result: 'success',
      })
      expect(audit.detail).not.toContain(PASSWORD)
    })

    it('fails safely and drops the sealed secret when the execution key is gone', async () => {
      const created = await createApproval(approvalCtx(ADMIN_DID), {
        action: 'account.admin.update',
        target: TARGET,
        payload: { did: TARGET, password: PASSWORD },
      })

      await expect(runApproved(SECOND_ADMIN, created.approval.id, false)).rejects.toMatchObject({
        status: 503,
        body: { error: 'NotConfigured' },
      })

      const failed = await db
        .selectFrom('admin.admin_approval')
        .selectAll()
        .where('id', '=', created.approval.id)
        .executeTakeFirstOrThrow()
      expect(failed.status).toBe('failed')
      expect((failed.payload as Record<string, unknown>).passwordSealed).toBeUndefined()
      expect(
        pds.calls.some((call) => call.nsid === 'com.atproto.admin.updateAccountPassword'),
      ).toBe(false)
    })

    it('deletes an account through an approval and records the approval id', async () => {
      const created = await createApproval(approvalCtx(ADMIN_DID), {
        action: 'account.admin.delete',
        targetType: 'account',
        target: TARGET,
        payload: { did: TARGET },
      })

      const approved = await runApproved(SECOND_ADMIN, created.approval.id)
      expect(approved.approval.status).toBe('executed')
      expect(
        pds.calls.find((call) => call.nsid === 'com.atproto.admin.deleteAccount')?.options?.body,
      ).toEqual({ did: TARGET })

      const audit = await db
        .selectFrom('admin.admin_audit_event')
        .selectAll()
        .where('action', '=', 'com.selfcommand.admin.account.admin.delete')
        .executeTakeFirstOrThrow()
      expect(audit).toMatchObject({
        target_id: TARGET,
        approval_id: created.approval.id,
        detail: '通过上游服务删除账号',
      })
    })

    it('lets the sole administrator update and delete without an approval', async () => {
      await sql`truncate admin.admin_role, admin.admin_approval restart identity`.execute(db)
      expect(await bootstrapAdmin(db, config, silentLogger)).toBe(true)

      await updateAccountAdminGuarded(writeCtx(), { did: TARGET, handle: 'renamed.test' })
      await deleteAccountAdminGuarded(writeCtx(), { did: TARGET })

      expect(pds.calls.map((call) => call.nsid)).toEqual([
        'com.atproto.admin.getAccountInfo',
        'com.atproto.admin.updateAccountHandle',
        'com.atproto.admin.getAccountInfo',
        'com.atproto.admin.deleteAccount',
      ])
      const audits = await db
        .selectFrom('admin.admin_audit_event')
        .select(['action', 'approval_id'])
        .where('approval_id', 'is', null)
        .where('action', 'in', [
          'com.selfcommand.admin.account.admin.update',
          'com.selfcommand.admin.account.admin.delete',
        ])
        .execute()
      expect(audits).toHaveLength(2)
    })

    it('disables invitation codes without an approval', async () => {
      await disableAccountInvites(writeCtx(), { did: TARGET })
      expect(
        pds.calls
          .slice(-2)
          .map((call) => [call.nsid, call.options?.body]),
      ).toEqual([
        ['com.atproto.admin.disableAccountInvites', { account: TARGET }],
        ['com.atproto.admin.disableInviteCodes', { accounts: [TARGET] }],
      ])
      const audit = await db
        .selectFrom('admin.admin_audit_event')
        .selectAll()
        .where('action', '=', 'com.selfcommand.admin.account.invites.disable')
        .executeTakeFirstOrThrow()
      expect(audit).toMatchObject({
        target_id: TARGET,
        detail: '停用该账号创建的全部邀请码',
      })
    })
  })

  describe('daily metric snapshots', () => {
    const timeZone = 'Asia/Shanghai'
    const now = new Date('2026-10-29T04:00:00.000Z')
    const today = dayKey(now, timeZone)

    beforeEach(async () => {
      await sql`
        truncate admin.account_directory, admin.admin_audit_event,
          admin.daily_metric restart identity
      `.execute(db)
      await sql`
        insert into admin.admin_audit_event (created_at, actor_did, action, result)
        values
          (${now}, ${ADMIN_DID}, 'com.selfcommand.admin.role.list', 'success'),
          (${now}, ${VIEWER}, 'com.selfcommand.admin.role.create', 'denied')
      `.execute(db)
    })

    it('zeroes directory metrics while the indexer is disabled', async () => {
      const point = await computeDailyMetric(db, today, {
        now,
        timeZone,
        indexerEnabled: false,
      })
      expect(point).toMatchObject({
        day: today,
        accountsTotal: 0,
        accountsNew: 0,
        accountsActive24h: 0,
        auditTotal: 2,
        auditDenied: 1,
      })
      expect(Object.values(point.statusCounts).every((value) => value === 0)).toBe(true)
    })

    it('counts statuses, new accounts and recent activity in the report timezone', async () => {
      const yesterday = shiftDay(today, -1)
      await db
        .insertInto('admin.account_directory')
        .values([
          {
            did: 'did:plc:metric1',
            status: 'active',
            active: true,
            first_seen_at: now,
            last_event_at: new Date(now.getTime() - 2 * 60 * 60 * 1000),
          },
          {
            did: 'did:plc:metric2',
            status: 'suspended',
            active: false,
            first_seen_at: zonedDayStart(yesterday, timeZone),
            last_event_at: new Date(now.getTime() - 48 * 60 * 60 * 1000),
          },
          {
            did: 'did:plc:metric3',
            status: 'unknown',
            active: true,
            first_seen_at: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
            last_event_at: new Date(now.getTime() - 48 * 60 * 60 * 1000),
          },
        ])
        .execute()

      const point = await computeDailyMetric(db, today, {
        now,
        timeZone,
        indexerEnabled: true,
      })
      expect(point).toMatchObject({ accountsTotal: 3, accountsNew: 1, accountsActive24h: 1 })
      expect(point.statusCounts).toMatchObject({ active: 1, suspended: 1, unknown: 1 })
    })

    it('backfills snapshot days once and serves only the requested window', async () => {
      expect(await backfillDailyMetrics(db, { now, timeZone, indexerEnabled: true })).toBe(30)
      expect(await backfillDailyMetrics(db, { now, timeZone, indexerEnabled: true })).toBe(0)

      const series = await dashboardSeries(db, 7, true, now, timeZone)
      expect(series).toMatchObject({ days: 7, indexerEnabled: true })
      expect(series.points).toHaveLength(7)
      expect(series.points.at(-1)?.day).toBe(today)
      expect(series.generatedAt).toBe(now.toISOString())

      await expect(dashboardSeries(db, 14, true, now, timeZone)).rejects.toMatchObject({
        status: 400,
      })
    })

    it('refreshes the current day without duplicating the snapshot', async () => {
      await upsertDailyMetric(db, today, { now, timeZone, indexerEnabled: false })
      await db
        .insertInto('admin.account_directory')
        .values({
          did: 'did:plc:metric4',
          status: 'active',
          active: true,
          first_seen_at: now,
          last_event_at: now,
        })
        .execute()

      const refreshed = await upsertDailyMetric(db, today, {
        now,
        timeZone,
        indexerEnabled: true,
      })
      expect(refreshed.accountsTotal).toBe(1)
      const count = await db
        .selectFrom('admin.daily_metric')
        .select(sql<number>`count(*)::int`.as('count'))
        .executeTakeFirstOrThrow()
      expect(count.count).toBe(1)
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
