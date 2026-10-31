import { com } from '@admin/lexicons'
import { LexServerError } from '@atproto/lex-server'
import { sql, type Kysely } from 'kysely'
import { insertAudit, insertAuditSafely, type RequestMeta } from '../audit.js'
import { isValidDid } from '../auth/roles.js'
import type { Database } from '../db/types.js'
import type { Logger } from '../logger.js'
import { decodeCursor, encodeCursor } from '../pagination.js'

export type AccessRecordView = com.selfcommand.admin.defs.AccessRecord
export type AccessBlockView = com.selfcommand.admin.defs.AccessBlock
export type AccessListResult = com.selfcommand.admin.security.access.list.$OutputBody
export type AccessBlockListResult = com.selfcommand.admin.security.blocked.list.$OutputBody
export type SelfAccessResult = com.selfcommand.admin.security.self.$OutputBody

const ACCESS_RETENTION_DAYS = 90

function invalid(message: string): LexServerError {
  return new LexServerError(400, { error: 'InvalidRequest', message })
}

function toRecordView(row: {
  did: string
  ip: string
  user_agent: string
  first_seen_at: Date
  last_seen_at: Date
  request_count: number
}): AccessRecordView {
  return {
    did: row.did as AccessRecordView['did'],
    ip: row.ip,
    ...(row.user_agent ? { userAgent: row.user_agent } : {}),
    firstSeenAt: row.first_seen_at.toISOString() as AccessRecordView['firstSeenAt'],
    lastSeenAt: row.last_seen_at.toISOString() as AccessRecordView['lastSeenAt'],
    requestCount: row.request_count,
  }
}

function toBlockView(row: {
  did: string
  blocked_by: string
  reason: string | null
  blocked_at: Date
}): AccessBlockView {
  return {
    did: row.did as AccessBlockView['did'],
    blockedBy: row.blocked_by as AccessBlockView['blockedBy'],
    ...(row.reason ? { reason: row.reason } : {}),
    blockedAt: row.blocked_at.toISOString() as AccessBlockView['blockedAt'],
  }
}

export async function recordAccess(
  db: Kysely<Database>,
  record: { did: string; ip?: string; userAgent?: string },
): Promise<void> {
  const ip = (record.ip ?? '').slice(0, 64) || 'unknown'
  const userAgent = (record.userAgent ?? '').slice(0, 256)
  await db
    .insertInto('admin.admin_access')
    .values({
      did: record.did,
      ip,
      user_agent: userAgent,
      first_seen_at: new Date(),
      last_seen_at: new Date(),
      request_count: 1,
    })
    .onConflict((oc) =>
      oc.columns(['did', 'ip', 'user_agent']).doUpdateSet({
        last_seen_at: sql`now()`,
        request_count: sql`admin.admin_access.request_count + 1`,
      }),
    )
    .execute()
}

export async function findAccessBlock(
  db: Kysely<Database>,
  did: string,
): Promise<AccessBlockView | null> {
  const row = await db
    .selectFrom('admin.admin_access_block')
    .selectAll()
    .where('did', '=', did)
    .executeTakeFirst()
  return row ? toBlockView(row) : null
}

export function blockedError(block: AccessBlockView): LexServerError {
  const reason = block.reason ? `原因：${block.reason}。` : ''
  return new LexServerError(403, {
    error: 'AccessBlocked',
    message: `你的后台访问已被封锁。${reason}请联系其他管理员处理。`,
  })
}

type AccessCursor = {
  v: string
  did: string
  ip: string
  ua: string
}

function decodeAccessCursor(value: string | undefined): AccessCursor | undefined {
  if (value === undefined) return undefined
  const decoded = decodeCursor(value)
  if (!decoded) throw invalid('invalid cursor')
  try {
    const parsed = JSON.parse(decoded) as AccessCursor
    if (
      typeof parsed.v !== 'string' ||
      typeof parsed.did !== 'string' ||
      typeof parsed.ip !== 'string' ||
      typeof parsed.ua !== 'string'
    ) {
      throw new Error('bad cursor')
    }
    return parsed
  } catch {
    throw invalid('invalid cursor')
  }
}

export async function listAccess(
  db: Kysely<Database>,
  params: { cursor?: string; limit: number; did?: string },
): Promise<AccessListResult> {
  if (params.did !== undefined && !isValidDid(params.did)) throw invalid('did must be a DID')
  const cursor = decodeAccessCursor(params.cursor)

  const build = (withCursor: boolean) => {
    let query = db.selectFrom('admin.admin_access')
    if (params.did) query = query.where('did', '=', params.did)
    if (withCursor && cursor) {
      query = query.where(
        sql<boolean>`(last_seen_at, did, ip, user_agent) < (${cursor.v}::timestamptz, ${cursor.did}, ${cursor.ip}, ${cursor.ua})`,
      )
    }
    return query
  }

  const rows = await build(true)
    .selectAll()
    .orderBy('last_seen_at', 'desc')
    .orderBy('did', 'desc')
    .orderBy('ip', 'desc')
    .orderBy('user_agent', 'desc')
    .limit(params.limit)
    .execute()

  const totalRow = await build(false)
    .select(sql<number>`count(*)::int`.as('count'))
    .executeTakeFirstOrThrow()

  const last = rows.at(-1)
  return {
    total: totalRow.count,
    records: rows.map(toRecordView),
    ...(rows.length === params.limit && last
      ? {
          cursor: encodeCursor(
            JSON.stringify({
              v: last.last_seen_at.toISOString(),
              did: last.did,
              ip: last.ip,
              ua: last.user_agent,
            } satisfies AccessCursor),
          ),
        }
      : {}),
  }
}

type BlockCursor = {
  v: string
  did: string
}

function decodeBlockCursor(value: string | undefined): BlockCursor | undefined {
  if (value === undefined) return undefined
  const decoded = decodeCursor(value)
  if (!decoded) throw invalid('invalid cursor')
  try {
    const parsed = JSON.parse(decoded) as BlockCursor
    if (typeof parsed.v !== 'string' || typeof parsed.did !== 'string') {
      throw new Error('bad cursor')
    }
    return parsed
  } catch {
    throw invalid('invalid cursor')
  }
}

export async function listBlocks(
  db: Kysely<Database>,
  params: { cursor?: string; limit: number },
): Promise<AccessBlockListResult> {
  const cursor = decodeBlockCursor(params.cursor)

  const build = (withCursor: boolean) => {
    let query = db.selectFrom('admin.admin_access_block')
    if (withCursor && cursor) {
      query = query.where(
        sql<boolean>`(blocked_at, did) < (${cursor.v}::timestamptz, ${cursor.did})`,
      )
    }
    return query
  }

  const rows = await build(true)
    .selectAll()
    .orderBy('blocked_at', 'desc')
    .orderBy('did', 'desc')
    .limit(params.limit)
    .execute()

  const totalRow = await build(false)
    .select(sql<number>`count(*)::int`.as('count'))
    .executeTakeFirstOrThrow()

  const last = rows.at(-1)
  return {
    total: totalRow.count,
    blocks: rows.map(toBlockView),
    ...(rows.length === params.limit && last
      ? {
          cursor: encodeCursor(
            JSON.stringify({
              v: last.blocked_at.toISOString(),
              did: last.did,
            } satisfies BlockCursor),
          ),
        }
      : {}),
  }
}

export async function selfAccess(
  db: Kysely<Database>,
  did: string,
): Promise<SelfAccessResult> {
  const block = await findAccessBlock(db, did)
  const rows = await db
    .selectFrom('admin.admin_access')
    .selectAll()
    .where('did', '=', did)
    .orderBy('last_seen_at', 'desc')
    .limit(10)
    .execute()
  return {
    blocked: block !== null,
    ...(block
      ? {
          blockedAt: block.blockedAt,
          blockedBy: block.blockedBy,
          ...(block.reason ? { reason: block.reason } : {}),
        }
      : {}),
    records: rows.map(toRecordView),
  }
}

export type SecurityContext = {
  db: Kysely<Database>
  logger: Logger
  actor: string
  meta: RequestMeta
}

export async function blockAccess(
  ctx: SecurityContext,
  input: { did: string; reason?: string },
): Promise<{ block: AccessBlockView }> {
  const action = 'com.selfcommand.admin.security.block'
  if (!isValidDid(input.did)) throw invalid('did must be a DID')
  if (input.did === ctx.actor) throw invalid('不能封锁自己的后台访问')
  const reason = input.reason?.trim()
  if (reason && reason.length > 200) throw invalid('reason must be at most 200 characters')

  try {
    const row = await ctx.db
      .insertInto('admin.admin_access_block')
      .values({
        did: input.did,
        blocked_by: ctx.actor,
        reason: reason ?? null,
        blocked_at: new Date(),
      })
      .onConflict((oc) =>
        oc.column('did').doUpdateSet({
          blocked_by: ctx.actor,
          reason: reason ?? null,
          blocked_at: sql`now()`,
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow()

    await insertAudit(ctx.db, {
      actor: ctx.actor,
      action,
      targetType: 'access',
      target: input.did,
      result: 'success',
      detail: reason ? `封锁后台访问（原因：${reason}）` : '封锁后台访问',
      ...ctx.meta,
    })
    return { block: toBlockView(row) }
  } catch (error) {
    if (error instanceof LexServerError) {
      await insertAuditSafely(ctx.db, ctx.logger, {
        actor: ctx.actor,
        action,
        targetType: 'access',
        target: input.did,
        result: 'error',
        detail: `封锁未完成（错误码：${error.body.error}）`,
        ...ctx.meta,
      })
    }
    throw error
  }
}

export async function unblockAccess(
  ctx: SecurityContext,
  input: { did: string },
): Promise<{ blocked: boolean }> {
  const action = 'com.selfcommand.admin.security.unblock'
  if (!isValidDid(input.did)) throw invalid('did must be a DID')
  if (input.did === ctx.actor) throw invalid('不能解除自己的后台封锁，请联系其他管理员')

  const deleted = await ctx.db
    .deleteFrom('admin.admin_access_block')
    .where('did', '=', input.did)
    .executeTakeFirst()
  const removed = Number(deleted.numDeletedRows ?? 0) > 0

  await insertAudit(ctx.db, {
    actor: ctx.actor,
    action,
    targetType: 'access',
    target: input.did,
    result: 'success',
    detail: removed ? '解除后台访问封锁' : '该账号当前未被封锁',
    ...ctx.meta,
  })
  return { blocked: false }
}

export async function pruneAccess(
  db: Kysely<Database>,
  now = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - ACCESS_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const result = await db
    .deleteFrom('admin.admin_access')
    .where('last_seen_at', '<', cutoff)
    .executeTakeFirst()
  return Number(result.numDeletedRows ?? 0)
}

export const ACCESS_RETENTION = ACCESS_RETENTION_DAYS