import { randomUUID } from 'node:crypto'
import { com } from '@admin/lexicons'
import { LexServerError } from '@atproto/lex-server'
import { sql, type Kysely, type Selectable, type Transaction } from 'kysely'
import { insertAudit, insertAuditSafely, type RequestMeta } from '../audit.js'
import { isValidDid, lockRoleTable, parseRole } from '../auth/roles.js'
import type { AdminRoleTable, Database } from '../db/types.js'
import type { Logger } from '../logger.js'
import { decodeCursor, encodeCursor } from '../pagination.js'

export type RoleBindingView = com.selfcommand.admin.defs.RoleBinding

export type RoleSort = 'subject' | 'role' | 'createdAt' | 'updatedAt'

export type RoleListParams = {
  cursor?: string
  limit: number
  role?: string
  search?: string
  sort?: string
  order?: string
}

export type RoleListResult = com.selfcommand.admin.role.list.$OutputBody
export type RoleImportInput = com.selfcommand.admin.role.import.$InputBody
export type RoleImportResult = com.selfcommand.admin.role.import.$OutputBody
export type RoleExportResult = com.selfcommand.admin.role.export.$OutputBody

const ROLE_LABELS: Record<string, string> = {
  admin: '管理员',
  operator: '运营员',
  viewer: '只读成员',
}

function roleLabel(value: string): string {
  return ROLE_LABELS[value] ?? value
}

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

const ROLE_SORTS: readonly RoleSort[] = ['subject', 'role', 'createdAt', 'updatedAt']

type RoleCursor = { v: string; did: string; s: RoleSort; o: 'asc' | 'desc' }

function readSort(params: RoleListParams): { sort: RoleSort; order: 'asc' | 'desc' } {
  const sort = (params.sort ?? 'updatedAt') as RoleSort
  if (!ROLE_SORTS.includes(sort)) throw invalidRequest('unknown sort field')
  const order = (params.order ?? 'desc') as 'asc' | 'desc'
  if (order !== 'asc' && order !== 'desc') throw invalidRequest('order must be asc or desc')
  return { sort, order }
}

function decodeRoleCursor(cursor: string | undefined): RoleCursor | undefined {
  const decoded = decodeListCursor(cursor)
  if (decoded === undefined) return undefined
  try {
    const parsed = JSON.parse(decoded) as RoleCursor
    if (
      typeof parsed.v !== 'string' ||
      typeof parsed.did !== 'string' ||
      typeof parsed.s !== 'string' ||
      (parsed.o !== 'asc' && parsed.o !== 'desc')
    ) {
      throw new Error('bad cursor')
    }
    return parsed
  } catch {
    throw invalidRequest('invalid cursor')
  }
}

function roleSortValue(row: Selectable<AdminRoleTable>, sort: RoleSort): string {
  if (sort === 'subject') return row.did
  if (sort === 'role') return row.role
  if (sort === 'createdAt') return row.created_at.toISOString()
  return row.updated_at.toISOString()
}

export async function listRoles(
  db: Kysely<Database>,
  params: RoleListParams,
): Promise<RoleListResult> {
  const cursor = decodeRoleCursor(params.cursor)
  const { sort, order } = readSort(params)
  if (cursor && (cursor.s !== sort || cursor.o !== order)) {
    throw invalidRequest('cursor does not match the requested sort order')
  }
  const search = params.search?.trim()
  const role = params.role === undefined ? undefined : parseRole(params.role)
  if (params.role !== undefined && !role) {
    throw invalidRequest('role must be admin, operator or viewer')
  }

  const column =
    sort === 'subject'
      ? sql`r.did`
      : sort === 'role'
        ? sql`r.role`
        : sort === 'createdAt'
          ? sql`r.created_at`
          : sql`r.updated_at`
  const op = order === 'asc' ? sql`>` : sql`<`

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
    if (withCursor && cursor) {
      const value =
        sort === 'createdAt' || sort === 'updatedAt'
          ? sql`${cursor.v}::timestamptz`
          : sql`${cursor.v}`
      query = query.where(sql<boolean>`(${column}, r.did) ${op} (${value}, ${cursor.did})`)
    }
    return query
  }

  const rows = await build(true)
    .selectAll()
    .orderBy(column, order)
    .orderBy('r.did', order)
    .limit(params.limit)
    .execute()

  const totalRow = await build(false)
    .select(sql<number>`count(*)::int`.as('count'))
    .executeTakeFirstOrThrow()

  const last = rows.at(-1)
  const nextCursor = last
    ? encodeCursor(
        JSON.stringify({
          v: roleSortValue(last, sort),
          did: last.did,
          s: sort,
          o: order,
        } satisfies RoleCursor),
      )
    : undefined
  return {
    total: totalRow.count,
    roles: rows.map(toView),
    ...(rows.length === params.limit && nextCursor ? { cursor: nextCursor } : {}),
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
  meta?: RequestMeta
  trx?: Transaction<Database>
  approvalId?: string
}

async function withTransaction<T>(
  ctx: RoleMutationContext,
  run: (trx: Transaction<Database>) => Promise<T>,
): Promise<T> {
  if (ctx.trx) return run(ctx.trx)
  return ctx.db.transaction().execute(run)
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
    detail: `操作未完成（错误码：${error.body.error}）`,
    ...ctx.meta,
    ...(ctx.approvalId ? { approvalId: ctx.approvalId } : {}),
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

    return await withTransaction(ctx, async (trx) => {
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
        detail: `授予角色：${roleLabel(role)}`,
        after: { role, note: note ?? null },
        ...ctx.meta,
        ...(ctx.approvalId ? { approvalId: ctx.approvalId } : {}),
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

    return await withTransaction(ctx, async (trx) => {
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
        detail: `角色由${roleLabel(existing.role)}变更为${roleLabel(role)}`,
        before: { role: existing.role, note: existing.note },
        after: { role, note: note === undefined ? existing.note : note },
        ...ctx.meta,
        ...(ctx.approvalId ? { approvalId: ctx.approvalId } : {}),
      })

      return toView(row)
    })
  } catch (error) {
    await auditFailure(ctx, action, input.subject, error)
    throw error
  }
}

const BATCH_ID = /^[A-Za-z0-9._-]{1,64}$/

export async function importRoles(
  ctx: RoleMutationContext,
  input: RoleImportInput,
): Promise<RoleImportResult> {
  const action = 'com.selfcommand.admin.role.import'
  const batchId = input.batchId?.trim() || randomUUID()
  try {
    if (!BATCH_ID.test(batchId)) {
      throw invalidRequest('batchId may only contain letters, digits, dots, dashes and underscores')
    }
    const bindings = input.bindings
    if (bindings.length === 0) throw invalidRequest('bindings must not be empty')
    if (bindings.length > 500) throw invalidRequest('at most 500 bindings can be imported at once')

    const seen = new Set<string>()
    const prepared = bindings.map((binding) => {
      if (!isValidDid(binding.subject)) {
        throw invalidRequest(`subject is not a DID: ${binding.subject}`)
      }
      if (seen.has(binding.subject)) {
        throw invalidRequest(`subject appears more than once in the batch: ${binding.subject}`)
      }
      seen.add(binding.subject)
      const role = parseRole(binding.role)
      if (!role) throw invalidRequest(`role must be admin, operator or viewer: ${binding.role}`)
      return { subject: binding.subject, role, note: normalizeNote(binding.note) ?? null }
    })

    return await withTransaction(ctx, async (trx) => {
      await lockRoleTable(trx)
      const existing = await trx
        .selectFrom('admin.admin_role')
        .select('did')
        .where('did', 'in', [...seen])
        .execute()
      if (existing.length > 0) {
        throw new LexServerError(409, {
          error: 'RoleExists',
          message: `${existing.length} account(s) already hold a role binding`,
        })
      }

      await trx
        .insertInto('admin.admin_role')
        .values(
          prepared.map((item) => ({
            did: item.subject,
            role: item.role,
            granted_by: ctx.actor,
            note: item.note,
          })),
        )
        .execute()

      await insertAudit(trx, {
        actor: ctx.actor,
        action,
        targetType: 'role',
        target: batchId,
        result: 'success',
        detail: `批量导入 ${prepared.length} 条角色绑定（批次 ${batchId}）`,
        after: { batchId, imported: prepared.length },
        ...ctx.meta,
        ...(ctx.approvalId ? { approvalId: ctx.approvalId } : {}),
      })

      return { imported: prepared.length, batchId }
    })
  } catch (error) {
    await auditFailure(ctx, action, batchId, error)
    throw error
  }
}

export async function exportRoles(
  db: Kysely<Database>,
): Promise<RoleExportResult> {
  const rows = await db
    .selectFrom('admin.admin_role')
    .selectAll()
    .orderBy('did', 'asc')
    .execute()
  return {
    bindings: rows.map(toView),
    total: rows.length,
    exportedAt: new Date().toISOString() as RoleExportResult['exportedAt'],
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

    await withTransaction(ctx, async (trx) => {
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
        detail: `撤销角色：${roleLabel(existing.role)}`,
        before: { role: existing.role, note: existing.note },
        ...ctx.meta,
        ...(ctx.approvalId ? { approvalId: ctx.approvalId } : {}),
      })
    })
  } catch (error) {
    await auditFailure(ctx, action, input.subject, error)
    throw error
  }
}
