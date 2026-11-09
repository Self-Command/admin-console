import { sql, type Kysely } from 'kysely'
import {
  Migrator,
  type Migration,
  type MigrationProvider,
} from 'kysely/migration'
import type { Database } from './types.js'

const migrations: Record<string, Migration> = {
  '001_admin_schema': {
    async up(db) {
      await db.schema
        .createTable('admin.admin_role')
        .ifNotExists()
        .addColumn('did', 'text', (col) => col.primaryKey())
        .addColumn('role', 'text', (col) => col.notNull())
        .addColumn('granted_by', 'text', (col) => col.notNull())
        .addColumn('note', 'text')
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addCheckConstraint(
          'admin_role_role_check',
          sql`role in ('admin', 'operator', 'viewer')`,
        )
        .execute()

      await db.schema
        .createIndex('admin_role_role_idx')
        .ifNotExists()
        .on('admin.admin_role')
        .column('role')
        .execute()

      await db.schema
        .createTable('admin.admin_audit_event')
        .ifNotExists()
        .addColumn('id', 'bigserial', (col) => col.primaryKey())
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addColumn('actor_did', 'text', (col) => col.notNull())
        .addColumn('action', 'text', (col) => col.notNull())
        .addColumn('target_type', 'text')
        .addColumn('target_id', 'text')
        .addColumn('result', 'text', (col) => col.notNull())
        .addColumn('detail', 'text')
        .addCheckConstraint(
          'admin_audit_event_result_check',
          sql`result in ('success', 'denied', 'error')`,
        )
        .execute()

      await sql`
        create index if not exists admin_audit_event_created_at_idx
        on admin.admin_audit_event (created_at desc)
      `.execute(db)

      await db.schema
        .createIndex('admin_audit_event_actor_idx')
        .ifNotExists()
        .on('admin.admin_audit_event')
        .column('actor_did')
        .execute()

      await db.schema
        .createIndex('admin_audit_event_action_idx')
        .ifNotExists()
        .on('admin.admin_audit_event')
        .column('action')
        .execute()

      await db.schema
        .createIndex('admin_audit_event_result_idx')
        .ifNotExists()
        .on('admin.admin_audit_event')
        .column('result')
        .execute()

      await db.schema
        .createTable('admin.account_directory')
        .ifNotExists()
        .addColumn('did', 'text', (col) => col.primaryKey())
        .addColumn('handle', 'text')
        .addColumn('status', 'text', (col) => col.notNull().defaultTo('unknown'))
        .addColumn('active', 'boolean')
        .addColumn('last_event_at', 'timestamptz')
        .addColumn('indexed_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addCheckConstraint(
          'account_directory_status_check',
          sql`status in ('active', 'deactivated', 'suspended', 'takendown', 'deleted', 'unknown')`,
        )
        .execute()

      await db.schema
        .createIndex('account_directory_handle_idx')
        .ifNotExists()
        .on('admin.account_directory')
        .column('handle')
        .execute()

      await db.schema
        .createIndex('account_directory_status_idx')
        .ifNotExists()
        .on('admin.account_directory')
        .column('status')
        .execute()

      await db.schema
        .createTable('admin.indexer_cursor')
        .ifNotExists()
        .addColumn('stream', 'text', (col) => col.primaryKey())
        .addColumn('cursor', 'bigint')
        .addColumn('backfill_complete', 'boolean', (col) => col.notNull().defaultTo(false))
        .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute()
    },
    async down(db) {
      await db.schema.dropTable('admin.indexer_cursor').ifExists().execute()
      await db.schema.dropTable('admin.account_directory').ifExists().execute()
      await db.schema.dropTable('admin.admin_audit_event').ifExists().execute()
      await db.schema.dropTable('admin.admin_role').ifExists().execute()
    },
  },
  '002_runtime_settings': {
    async up(db) {
      await db.schema
        .createTable('admin.admin_setting')
        .ifNotExists()
        .addColumn('section', 'text', (col) => col.primaryKey())
        .addColumn('version', 'integer', (col) => col.notNull().defaultTo(0))
        .addColumn('values', 'jsonb', (col) => col.notNull())
        .addColumn('updated_by', 'text')
        .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addCheckConstraint(
          'admin_setting_section_check',
          sql`section in ('branding', 'theme', 'login', 'navigation', 'features', 'ui', 'integrations', 'audit', 'indexer')`,
        )
        .addCheckConstraint('admin_setting_version_check', sql`version >= 0`)
        .execute()

      await db.schema
        .createTable('admin.admin_setting_revision')
        .ifNotExists()
        .addColumn('id', 'bigserial', (col) => col.primaryKey())
        .addColumn('section', 'text', (col) => col.notNull())
        .addColumn('version', 'integer', (col) => col.notNull())
        .addColumn('actor_did', 'text', (col) => col.notNull())
        .addColumn('reason', 'text')
        .addColumn('request_id', 'text')
        .addColumn('before', 'jsonb', (col) => col.notNull())
        .addColumn('after', 'jsonb', (col) => col.notNull())
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute()

      await sql`
        create index if not exists admin_setting_revision_section_idx
        on admin.admin_setting_revision (section, id desc)
      `.execute(db)

      await db.schema
        .createTable('admin.admin_user_preference')
        .ifNotExists()
        .addColumn('did', 'text', (col) => col.primaryKey())
        .addColumn('preferences', 'jsonb', (col) => col.notNull())
        .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute()

      await db.schema
        .createTable('admin.admin_branding_asset')
        .ifNotExists()
        .addColumn('id', 'text', (col) => col.primaryKey())
        .addColumn('mime', 'text', (col) => col.notNull())
        .addColumn('bytes', 'bytea', (col) => col.notNull())
        .addColumn('version', 'integer', (col) => col.notNull())
        .addColumn('updated_by', 'text')
        .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute()

      await sql`alter table admin.admin_audit_event add column if not exists request_id text`.execute(db)
      await sql`alter table admin.admin_audit_event add column if not exists actor_ip text`.execute(db)
      await sql`alter table admin.admin_audit_event add column if not exists user_agent text`.execute(db)
      await sql`alter table admin.admin_audit_event add column if not exists before jsonb`.execute(db)
      await sql`alter table admin.admin_audit_event add column if not exists after jsonb`.execute(db)

      await db.schema
        .createIndex('admin_audit_event_target_idx')
        .ifNotExists()
        .on('admin.admin_audit_event')
        .column('target_id')
        .execute()

      await sql`alter table admin.indexer_cursor add column if not exists paused boolean not null default false`.execute(db)
      await sql`alter table admin.indexer_cursor add column if not exists paused_by text`.execute(db)
      await sql`alter table admin.indexer_cursor add column if not exists paused_at timestamptz`.execute(db)
      await sql`alter table admin.indexer_cursor add column if not exists last_indexed_at timestamptz`.execute(db)
      await sql`alter table admin.indexer_cursor add column if not exists last_event_at timestamptz`.execute(db)
      await sql`alter table admin.indexer_cursor add column if not exists connected boolean not null default false`.execute(db)
    },
    async down(db) {
      await sql`alter table admin.indexer_cursor drop column if exists connected`.execute(db)
      await sql`alter table admin.indexer_cursor drop column if exists last_event_at`.execute(db)
      await sql`alter table admin.indexer_cursor drop column if exists last_indexed_at`.execute(db)
      await sql`alter table admin.indexer_cursor drop column if exists paused_at`.execute(db)
      await sql`alter table admin.indexer_cursor drop column if exists paused_by`.execute(db)
      await sql`alter table admin.indexer_cursor drop column if exists paused`.execute(db)
      await db.schema.dropIndex('admin_audit_event_target_idx').ifExists().execute()
      await sql`alter table admin.admin_audit_event drop column if exists after`.execute(db)
      await sql`alter table admin.admin_audit_event drop column if exists before`.execute(db)
      await sql`alter table admin.admin_audit_event drop column if exists user_agent`.execute(db)
      await sql`alter table admin.admin_audit_event drop column if exists actor_ip`.execute(db)
      await sql`alter table admin.admin_audit_event drop column if exists request_id`.execute(db)
      await db.schema.dropTable('admin.admin_branding_asset').ifExists().execute()
      await db.schema.dropTable('admin.admin_user_preference').ifExists().execute()
      await db.schema.dropTable('admin.admin_setting_revision').ifExists().execute()
      await db.schema.dropTable('admin.admin_setting').ifExists().execute()
    },
  },
  '003_admin_operations': {
    async up(db) {
      await db.schema
        .createTable('admin.account_operation')
        .ifNotExists()
        .addColumn('did', 'text', (col) => col.primaryKey())
        .addColumn('note', 'text')
        .addColumn('tags', 'jsonb', (col) =>
          col.notNull().defaultTo(sql`'[]'::jsonb`),
        )
        .addColumn('sync_paused', 'boolean', (col) => col.notNull().defaultTo(false))
        .addColumn('sync_paused_at', 'timestamptz')
        .addColumn('sync_paused_by', 'text')
        .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addColumn('updated_by', 'text')
        .execute()

      await db.schema
        .createTable('admin.admin_access')
        .ifNotExists()
        .addColumn('did', 'text', (col) => col.notNull())
        .addColumn('ip', 'text', (col) => col.notNull())
        .addColumn('user_agent', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('first_seen_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addColumn('last_seen_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addColumn('request_count', 'integer', (col) => col.notNull().defaultTo(1))
        .addPrimaryKeyConstraint('admin_access_pkey', ['did', 'ip', 'user_agent'])
        .addCheckConstraint('admin_access_request_count_check', sql`request_count > 0`)
        .execute()

      await sql`
        create index if not exists admin_access_last_seen_idx
        on admin.admin_access (last_seen_at desc)
      `.execute(db)

      await db.schema
        .createTable('admin.admin_access_block')
        .ifNotExists()
        .addColumn('did', 'text', (col) => col.primaryKey())
        .addColumn('blocked_by', 'text', (col) => col.notNull())
        .addColumn('reason', 'text')
        .addColumn('blocked_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute()

      await db.schema
        .createTable('admin.admin_approval')
        .ifNotExists()
        .addColumn('id', 'text', (col) => col.primaryKey())
        .addColumn('action', 'text', (col) => col.notNull())
        .addColumn('target_type', 'text')
        .addColumn('target', 'text')
        .addColumn('summary', 'text')
        .addColumn('payload', 'jsonb', (col) => col.notNull())
        .addColumn('payload_hash', 'text', (col) => col.notNull())
        .addColumn('status', 'text', (col) => col.notNull().defaultTo('pending'))
        .addColumn('requested_by', 'text', (col) => col.notNull())
        .addColumn('requested_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addColumn('decided_by', 'text')
        .addColumn('decided_at', 'timestamptz')
        .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
        .addColumn('error', 'text')
        .addCheckConstraint(
          'admin_approval_action_check',
          sql`action in ('settings.resetAll', 'role.revoke', 'role.demote', 'role.import')`,
        )
        .addCheckConstraint(
          'admin_approval_status_check',
          sql`status in ('pending', 'executed', 'rejected', 'cancelled', 'expired', 'failed')`,
        )
        .execute()

      await sql`
        create index if not exists admin_approval_status_idx
        on admin.admin_approval (status, requested_at desc)
      `.execute(db)

      await db.schema
        .createTable('admin.daily_metric')
        .ifNotExists()
        .addColumn('day', 'text', (col) => col.primaryKey())
        .addColumn('accounts_total', 'integer', (col) => col.notNull().defaultTo(0))
        .addColumn('accounts_new', 'integer', (col) => col.notNull().defaultTo(0))
        .addColumn('accounts_active_24h', 'integer', (col) => col.notNull().defaultTo(0))
        .addColumn('status_counts', 'jsonb', (col) =>
          col.notNull().defaultTo(sql`'{}'::jsonb`),
        )
        .addColumn('audit_total', 'integer', (col) => col.notNull().defaultTo(0))
        .addColumn('audit_denied', 'integer', (col) => col.notNull().defaultTo(0))
        .addColumn('generated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addCheckConstraint('daily_metric_day_check', sql`day ~ '^\\d{4}-\\d{2}-\\d{2}$'`)
        .addCheckConstraint('daily_metric_accounts_total_check', sql`accounts_total >= 0`)
        .addCheckConstraint('daily_metric_accounts_new_check', sql`accounts_new >= 0`)
        .addCheckConstraint(
          'daily_metric_accounts_active_check',
          sql`accounts_active_24h >= 0`,
        )
        .addCheckConstraint('daily_metric_audit_total_check', sql`audit_total >= 0`)
        .addCheckConstraint('daily_metric_audit_denied_check', sql`audit_denied >= 0`)
        .execute()

      await sql`alter table admin.account_directory add column if not exists first_seen_at timestamptz`.execute(db)
      await sql`
        create index if not exists account_directory_first_seen_idx
        on admin.account_directory (first_seen_at)
      `.execute(db)
      await sql`alter table admin.admin_audit_event add column if not exists approval_id text`.execute(db)
      await sql`
        create index if not exists admin_audit_event_approval_idx
        on admin.admin_audit_event (approval_id)
      `.execute(db)

      // Bounded backfill: 5000 rows per batch, at most 10 batches per run.
      for (let batch = 0; batch < 10; batch++) {
        const result = await sql`
          update admin.account_directory
          set first_seen_at = coalesce(first_seen_at, indexed_at)
          where did in (
            select did from admin.account_directory
            where first_seen_at is null
            limit 5000
          )
        `.execute(db)
        if (!result.numAffectedRows) break
      }
    },
    async down(db) {
      await db.schema.dropIndex('admin_audit_event_approval_idx').ifExists().execute()
      await sql`alter table admin.admin_audit_event drop column if exists approval_id`.execute(db)
      await db.schema.dropIndex('account_directory_first_seen_idx').ifExists().execute()
      await sql`alter table admin.account_directory drop column if exists first_seen_at`.execute(db)
      await db.schema.dropTable('admin.daily_metric').ifExists().execute()
      await db.schema.dropTable('admin.admin_approval').ifExists().execute()
      await db.schema.dropTable('admin.admin_access_block').ifExists().execute()
      await db.schema.dropTable('admin.admin_access').ifExists().execute()
      await db.schema.dropTable('admin.account_operation').ifExists().execute()
    },
  },
  '004_moderation_roles': {
    async up(db) {
      await sql`alter table admin.admin_role drop constraint if exists admin_role_role_check`.execute(db)
      await sql`
        alter table admin.admin_role
        add constraint admin_role_role_check
        check (role in ('admin', 'moderator', 'operator', 'viewer'))
      `.execute(db)
      await sql`alter table admin.admin_approval drop constraint if exists admin_approval_action_check`.execute(db)
      await sql`
        alter table admin.admin_approval
        add constraint admin_approval_action_check
        check (action in (
          'settings.resetAll', 'role.revoke', 'role.demote', 'role.import',
          'moderation.takedown', 'moderation.batch',
          'verification.grant', 'verification.revoke',
          'account.admin.update', 'account.admin.delete',
          'notifications.send', 'policy.write'
        ))
      `.execute(db)
    },
    async down(db) {
      // Rollback requires removing moderator bindings and approvals for the new
      // actions first; the constraint swap fails otherwise instead of dropping data.
      await sql`alter table admin.admin_approval drop constraint if exists admin_approval_action_check`.execute(db)
      await sql`
        alter table admin.admin_approval
        add constraint admin_approval_action_check
        check (action in ('settings.resetAll', 'role.revoke', 'role.demote', 'role.import'))
      `.execute(db)
      await sql`alter table admin.admin_role drop constraint if exists admin_role_role_check`.execute(db)
      await sql`
        alter table admin.admin_role
        add constraint admin_role_role_check
        check (role in ('admin', 'operator', 'viewer'))
      `.execute(db)
    },
  },
  '005_announcements': {
    async up(db) {
      await db.schema
        .createTable('admin.admin_announcement')
        .ifNotExists()
        .addColumn('id', 'bigserial', (col) => col.primaryKey())
        .addColumn('title', 'text', (col) => col.notNull())
        .addColumn('body', 'text', (col) => col.notNull())
        .addColumn('level', 'text', (col) => col.notNull())
        .addColumn('placement', 'text', (col) => col.notNull())
        .addColumn('status', 'text', (col) => col.notNull().defaultTo('draft'))
        .addColumn('starts_at', 'timestamptz')
        .addColumn('ends_at', 'timestamptz')
        .addColumn('created_by', 'text', (col) => col.notNull())
        .addColumn('published_by', 'text')
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addCheckConstraint(
          'admin_announcement_level_check',
          sql`level in ('info', 'warning', 'critical')`,
        )
        .addCheckConstraint(
          'admin_announcement_placement_check',
          sql`placement in ('admin', 'app')`,
        )
        .addCheckConstraint(
          'admin_announcement_status_check',
          sql`status in ('draft', 'published', 'archived')`,
        )
        .addCheckConstraint(
          'admin_announcement_window_check',
          sql`ends_at is null or starts_at is null or ends_at > starts_at`,
        )
        .execute()

      await db.schema
        .createIndex('admin_announcement_window_idx')
        .ifNotExists()
        .on('admin.admin_announcement')
        .columns(['status', 'starts_at', 'ends_at'])
        .execute()

      await db.schema
        .createIndex('admin_announcement_created_idx')
        .ifNotExists()
        .on('admin.admin_announcement')
        .column('created_at')
        .execute()

      await sql`alter table admin.admin_approval drop constraint if exists admin_approval_action_check`.execute(db)
      await sql`
        alter table admin.admin_approval
        add constraint admin_approval_action_check
        check (action in (
          'settings.resetAll', 'role.revoke', 'role.demote', 'role.import',
          'moderation.takedown', 'moderation.batch', 'moderation.label',
          'verification.grant', 'verification.revoke',
          'account.admin.update', 'account.admin.delete',
          'notifications.send', 'policy.write',
          'announcement.publish', 'announcement.archive'
        ))
      `.execute(db)

      // The approvals scope lives in the runtime settings table, so the section
      // whitelist must allow that partition without exposing it to the generic
      // settings endpoints.
      await sql`alter table admin.admin_setting drop constraint if exists admin_setting_section_check`.execute(db)
      await sql`
        alter table admin.admin_setting
        add constraint admin_setting_section_check
        check (section in (
          'branding', 'theme', 'login', 'navigation', 'features', 'ui',
          'integrations', 'audit', 'indexer', 'approvals'
        ))
      `.execute(db)
    },
    async down(db) {
      await db.schema.dropIndex('admin_announcement_created_idx').ifExists().execute()
      await db.schema.dropIndex('admin_announcement_window_idx').ifExists().execute()
      await db.schema.dropTable('admin.admin_announcement').ifExists().execute()
      await sql`delete from admin.admin_setting where section = 'approvals'`.execute(db)
      await sql`alter table admin.admin_setting drop constraint if exists admin_setting_section_check`.execute(db)
      await sql`
        alter table admin.admin_setting
        add constraint admin_setting_section_check
        check (section in (
          'branding', 'theme', 'login', 'navigation', 'features', 'ui',
          'integrations', 'audit', 'indexer'
        ))
      `.execute(db)
      await sql`alter table admin.admin_approval drop constraint if exists admin_approval_action_check`.execute(db)
      await sql`
        alter table admin.admin_approval
        add constraint admin_approval_action_check
        check (action in (
          'settings.resetAll', 'role.revoke', 'role.demote', 'role.import',
          'moderation.takedown', 'moderation.batch',
          'verification.grant', 'verification.revoke',
          'account.admin.update', 'account.admin.delete',
          'notifications.send', 'policy.write'
        ))
      `.execute(db)
    },
  },
}

class StaticMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    return migrations
  }
}

export type MigrationOutcome = {
  applied: string[]
  error?: unknown
}

export async function migrateToLatest(db: Kysely<Database>): Promise<MigrationOutcome> {
  await sql`create schema if not exists admin`.execute(db)
  const migrator = new Migrator({
    db,
    provider: new StaticMigrationProvider(),
    migrationTableSchema: 'admin',
    migrationTableName: '_migration',
    migrationLockTableName: '_migration_lock',
  })
  const { error, results } = await migrator.migrateToLatest()
  const applied = (results ?? [])
    .filter((result) => result.status === 'Success')
    .map((result) => result.migrationName)
  return error ? { applied, error } : { applied }
}

export async function migrationStatus(
  db: Kysely<Database>,
): Promise<{ executed: string[]; pending: string[] }> {
  await sql`create schema if not exists admin`.execute(db)
  const migrator = new Migrator({
    db,
    provider: new StaticMigrationProvider(),
    migrationTableSchema: 'admin',
    migrationTableName: '_migration',
    migrationLockTableName: '_migration_lock',
  })
  const executed: string[] = []
  const pending: string[] = []
  for (const migration of await migrator.getMigrations()) {
    if (migration.executedAt) executed.push(migration.name)
    else pending.push(migration.name)
  }
  return { executed, pending }
}
