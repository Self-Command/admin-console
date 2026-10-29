import { isDidString } from '@atproto/lex-schema'
import { sql, type Kysely, type Transaction } from 'kysely'
import { insertAudit } from '../audit.js'
import type { Database, RoleName } from '../db/types.js'
import type { Logger } from '../logger.js'
import type { Config } from '../config.js'

export type Permission = 'directory.read' | 'role.read' | 'role.write' | 'audit.read'

const ROLE_PERMISSIONS: Record<RoleName, readonly Permission[]> = {
  admin: ['directory.read', 'role.read', 'role.write', 'audit.read'],
  operator: ['directory.read'],
  viewer: ['directory.read'],
}

const ROLE_NAMES: readonly RoleName[] = ['admin', 'operator', 'viewer']

const ADMIN_ROLE_LOCK = 741236901

export function parseRole(value: unknown): RoleName | null {
  return typeof value === 'string' && (ROLE_NAMES as readonly string[]).includes(value)
    ? (value as RoleName)
    : null
}

export function isRoleName(value: unknown): value is RoleName {
  return parseRole(value) !== null
}

export function roleAllows(role: RoleName, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission)
}

export function rolePermissions(role: RoleName): readonly Permission[] {
  return ROLE_PERMISSIONS[role]
}

export function permissionsFor(role: RoleName | null): Permission[] {
  return role ? [...ROLE_PERMISSIONS[role]] : []
}

export type SessionView = {
  did: `did:${string}:${string}`
  role?: RoleName
  permissions: Permission[]
}

export function sessionView(did: string, role: RoleName | null): SessionView {
  return {
    did: did as `did:${string}:${string}`,
    ...(role ? { role } : {}),
    permissions: permissionsFor(role),
  }
}

export function isValidDid(value: unknown): value is string {
  return typeof value === 'string' && isDidString(value)
}

export async function loadRole(
  db: Kysely<Database>,
  did: string,
): Promise<RoleName | null> {
  const row = await db
    .selectFrom('admin.admin_role')
    .select('role')
    .where('did', '=', did)
    .executeTakeFirst()
  return row ? parseRole(row.role) : null
}

export async function countAdmins(
  executor: Kysely<Database> | Transaction<Database>,
): Promise<number> {
  const row = await executor
    .selectFrom('admin.admin_role')
    .select(sql<number>`count(*)::int`.as('count'))
    .where('role', '=', 'admin')
    .executeTakeFirstOrThrow()
  return row.count
}

export async function lockRoleTable(
  trx: Transaction<Database>,
): Promise<void> {
  await sql`select pg_advisory_xact_lock(${ADMIN_ROLE_LOCK})`.execute(trx)
}

export async function bootstrapAdmin(
  db: Kysely<Database>,
  config: Config,
  logger: Logger,
): Promise<boolean> {
  const did = config.bootstrapAdminDid
  if (!did) return false
  if (!isValidDid(did)) {
    logger.error('bootstrap admin skipped: ADMIN_API_BOOTSTRAP_ADMIN_DID is not a DID')
    return false
  }

  return await db.transaction().execute(async (trx) => {
    await lockRoleTable(trx)
    const existing = await trx
      .selectFrom('admin.admin_role')
      .select(sql<number>`count(*)::int`.as('count'))
      .executeTakeFirstOrThrow()
    if (existing.count > 0) return false

    await trx
      .insertInto('admin.admin_role')
      .values({
        did,
        role: 'admin',
        granted_by: config.serviceDid,
        note: 'bootstrapped from ADMIN_API_BOOTSTRAP_ADMIN_DID',
      })
      .execute()

    await insertAudit(trx, {
      actor: config.serviceDid,
      action: 'com.selfcommand.admin.role.bootstrap',
      targetType: 'role',
      target: did,
      result: 'success',
      detail: 'first admin bootstrapped from environment on an empty role table',
    })

    logger.info('bootstrap admin created', { did })
    return true
  })
}
