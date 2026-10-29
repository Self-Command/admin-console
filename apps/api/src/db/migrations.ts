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
