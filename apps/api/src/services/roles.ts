import { com } from '@admin/lexicons'
import { LexServerError } from '@atproto/lex-server'
import { sql, type Kysely, type Selectable } from 'kysely'
import { insertAudit, insertAuditSafely } from '../audit.js'
import { isValidDid, lockRoleTable, parseRole } from '../auth/roles.js'
import type { AdminRoleTable, Database } from '../db/types.js'
import type { Logger } from '../logger.js'
import { decodeCursor, encodeCursor } from '../pagination.js'

export type RoleBindingView = com.selfcommand.admin.defs.RoleBinding

export type RoleListParams = {
  cursor?: string
  limit: number
  role?: string
  search?: string
}

export type RoleListResult = com.selfcommand.admin.role.list.$OutputBody

function toView(row: Selectable<AdminRoleTable>): RoleBindingView {
  return {
    subject: row.did as RoleBindingView['subject'],
    role: row.role,
    grantedBy: row.granted_by as RoleBindingView['grantedBy'],
    ...(row.note ? { note: row.note } : {}),
    createdAt: row.created_at.toISOString() as RoleBindingView['createdAt'],
    updatedAt: row.updated_at.toISOString() as RoleBindingView['updatedAt'],
  }
}

function invalidRequest(message: string): LexServerError {
  return new LexServerError(400, { error: 'InvalidRequest', message })
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`)
}

function decodeListCursor(cursor: string | undefined): string | undefined {
  if (cursor === undefined) return undefined
  const decoded = decodeCursor(cursor)
  if (!decoded) throw invalidRequest('invalid cursor')
  return decoded
}

export async function listRoles(
  db: Kysely<Database>,
  params: RoleListParams,
): Promise<RoleListResult> {
  const cursor = decodeListCursor(params.cursor)
  const search = params.search?.trim()
  const role = params.role === undefined ? undefined : parseRole(params.role)
  if (params.role !== undefined && !role) {
    throw invalidRequest('role must be admin, operator or viewer')
  }

  const build = (withCursor: boolean) => {
    let query = db.selectFrom('admin.admin_role as r')
    if (role) query = query.where('r.role', '=', role)
    if (search) {
      const prefix = `${escapeLike(search)}%`
      const contains = `%${escapeLike(search)}%`
      query = query.where(
        sql<boolean>`(
          r.did like ${prefix}
          or exists (
            select 1 from admin.account_directory d
            where d.did = r.did and d.handle ilike ${contains}
          )
        )`,
      )
    }
    if (withCursor && cursor) query = query.where('r.did', '>', cursor)
    return query
  }

  const rows = await build(true)
    .selectAll()
    .orderBy('r.did', 'asc')
    .limit(params.limit)
    .execute()

  const totalRow = await build(false)
    .select(sql<number>`count(*)::int`.as('count'))
    .executeTakeFirstOrThrow()

  const last = rows.at(-1)
  return {
    total: totalRow.count,
    roles: rows.map(toView),
    ...(rows.length === params.limit && last ? { cursor: encodeCursor(last.did) } : {}),
  }
}

export async function getRole(
  db: Kysely<Database>,
  subject: string,
): Promise<RoleBindingView> {
  const row = await db
    .selectFrom('admin.admin_role')
    .selectAll()
    .where('did', '=', subject)
    .executeTakeFirst()
  if (!row) {
    throw new LexServerError(404, {
      error: 'RoleNotFound',
      message: 'The subject holds no role binding',
    })
  }
  return toView(row)
}

export type RoleMutationContext = {
  db: Kysely<Database>
  logger: Logger
  actor: string
}

export type CreateRoleInput = {
  subject: string
  role: string
  note?: string
}

function normalizeNote(note: string | undefined): string | undefined {
  const trimmed = note?.trim()
  return trimmed ? trimmed.slice(0, 200) : undefined
}

async function auditFailure(
  ctx: RoleMutationContext,
  action: string,
  subject: string,
  error: unknown,
): Promise<void> {
  if (!(error instanceof LexServerError)) return
  await insertAuditSafely(ctx.db, ctx.logger, {
    actor: ctx.actor,
    action,
    targetType: 'role',
    target: subject,
    result: 'error',
    detail: `${error.body.error}: ${error.body.message ?? ''}`.trim(),
  })
}

export async function createRole(
  ctx: RoleMutationContext,
  input: CreateRoleInput,
): Promise<RoleBindingView> {
  const action = 'com.selfcommand.admin.role.create'
  try {
    if (!isValidDid(input.subject)) throw invalidRequest('subject must be a DID')
    const role = parseRole(input.role)
    if (!role) throw invalidRequest('role must be admin, operator or viewer')
    const note = normalizeNote(input.note)

    return await ctx.db.transaction().execute(async (trx) => {
      await lockRoleTable(trx)
      const existing = await trx
        .selectFrom('admin.admin_role')
        .select('role')
        .where('did', '=', input.subject)
        .executeTakeFirst()
      if (existing) {
        throw new LexServerError(409, {
          error: 'RoleExists',
          message: 'The subject already holds a role binding',
        })
      }

      const row = await trx
        .insertInto('admin.admin_role')
        .values({
          did: input.subject,
          role,
          granted_by: ctx.actor,
          note: note ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      await insertAudit(trx, {
        actor: ctx.actor,
        action,
        targetType: 'role',
        target: input.subject,
        result: 'success',
        detail: `granted ${role}`,
      })

      return toView(row)
    })
  } catch (error) {
    await auditFailure(ctx, action, input.subject, error)
    throw error
  }
}

export type UpdateRoleInput = CreateRoleInput

export async function updateRole(
  ctx: RoleMutationContext,
  input: UpdateRoleInput,
): Promise<RoleBindingView> {
  const action = 'com.selfcommand.admin.role.update'
  try {
    if (!isValidDid(input.subject)) throw invalidRequest('subject must be a DID')
    const role = parseRole(input.role)
    if (!role) throw invalidRequest('role must be admin, operator or viewer')
    const note = normalizeNote(input.note)

    return await ctx.db.transaction().execute(async (trx) => {
      await lockRoleTable(trx)
      const existing = await trx
        .selectFrom('admin.admin_role')
        .selectAll()
        .where('did', '=', input.subject)
        .forUpdate()
        .executeTakeFirst()
      if (!existing) {
        throw new LexServerError(404, {
          error: 'RoleNotFound',
          message: 'The subject holds no role binding',
        })
      }

      if (existing.role === 'admin' && role !== 'admin') {
        const admins = await trx
          .selectFrom('admin.admin_role')
          .select(sql<number>`count(*)::int`.as('count'))
          .where('role', '=', 'admin')
          .executeTakeFirstOrThrow()
        if (admins.count <= 1) {
          throw new LexServerError(409, {
            error: 'LastAdmin',
            message: 'The workspace must keep at least one admin',
          })
        }
      }

      const row = await trx
        .updateTable('admin.admin_role')
        .set({
          role,
          granted_by: ctx.actor,
          note: note === undefined ? existing.note : note,
          updated_at: sql`now()`,
        })
        .where('did', '=', input.subject)
        .returningAll()
        .executeTakeFirstOrThrow()

      await insertAudit(trx, {
        actor: ctx.actor,
        action,
        targetType: 'role',
        target: input.subject,
        result: 'success',
        detail: `role changed from ${existing.role} to ${role}`,
      })

      return toView(row)
    })
  } catch (error) {
    await auditFailure(ctx, action, input.subject, error)
    throw error
  }
}

export type RevokeRoleInput = { subject: string }

export async function revokeRole(
  ctx: RoleMutationContext,
  input: RevokeRoleInput,
): Promise<void> {
  const action = 'com.selfcommand.admin.role.revoke'
  try {
    if (!isValidDid(input.subject)) throw invalidRequest('subject must be a DID')

    await ctx.db.transaction().execute(async (trx) => {
      await lockRoleTable(trx)
      const existing = await trx
        .selectFrom('admin.admin_role')
        .selectAll()
        .where('did', '=', input.subject)
        .forUpdate()
        .executeTakeFirst()
      if (!existing) {
        throw new LexServerError(404, {
          error: 'RoleNotFound',
          message: 'The subject holds no role binding',
        })
      }

      if (existing.role === 'admin') {
        const admins = await trx
          .selectFrom('admin.admin_role')
          .select(sql<number>`count(*)::int`.as('count'))
          .where('role', '=', 'admin')
          .executeTakeFirstOrThrow()
        if (admins.count <= 1) {
          throw new LexServerError(409, {
            error: 'LastAdmin',
            message: 'The workspace must keep at least one admin',
          })
        }
      }

      await trx.deleteFrom('admin.admin_role').where('did', '=', input.subject).execute()

      await insertAudit(trx, {
        actor: ctx.actor,
        action,
        targetType: 'role',
        target: input.subject,
        result: 'success',
        detail: `revoked ${existing.role}`,
      })
    })
  } catch (error) {
    await auditFailure(ctx, action, input.subject, error)
    throw error
  }
}
