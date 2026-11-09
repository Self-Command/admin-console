import { com } from '@admin/lexicons'
import { LexServerError } from '@atproto/lex-server'
import { sql, type Kysely, type Selectable, type Transaction } from 'kysely'
import { insertAudit, type RequestMeta } from '../audit.js'
import { isSoleAdmin } from '../auth/roles.js'
import type { AdminAnnouncementTable, Database } from '../db/types.js'
import type { Logger } from '../logger.js'
import { decodeCursor, encodeCursor } from '../pagination.js'
import { invalid } from './action-payloads.js'
import {
  approvalRequired,
  executeWithApproval,
  type ApprovalContext,
  type ApprovalPayload,
} from './approvals.js'
import { oneOf } from './values.js'

export type AnnouncementView = com.selfcommand.admin.defs.AnnouncementView
export type PublicAnnouncementView = com.selfcommand.admin.defs.PublicAnnouncementView
export type AnnouncementListResult = com.selfcommand.admin.announcement.list.$OutputBody
export type AnnouncementGetResult = com.selfcommand.admin.announcement.get.$OutputBody
export type AnnouncementMutationResult =
  com.selfcommand.admin.announcement.create.$OutputBody
export type PublicAnnouncementResult =
  com.selfcommand.admin.announcement.public.$OutputBody

export type AnnouncementContext = {
  db: Kysely<Database>
  logger: Logger
  actor: string
  meta: RequestMeta
  ttlHours: number
}

type AnnouncementRow = Selectable<AdminAnnouncementTable>

const LEVELS = ['info', 'warning', 'critical'] as const
const PLACEMENTS = ['admin', 'app'] as const
const STATUSES = ['draft', 'published', 'archived'] as const
const SORTS = ['createdAt', 'updatedAt', 'startsAt'] as const

const TITLE_LIMIT = 120
const BODY_LIMIT = 5000
const HTML_TAG = /<[a-zA-Z!/?][^>]*>/

function notFound(): LexServerError {
  return new LexServerError(404, {
    error: 'NotFound',
    message: '公告不存在或已被移除。',
  })
}

function invalidState(message: string): LexServerError {
  return new LexServerError(409, { error: 'InvalidState', message })
}

function hasControlCharacters(text: string, allowNewlines: boolean): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    if (code >= 0x20) continue
    if (allowNewlines && (code === 0x09 || code === 0x0a || code === 0x0d)) continue
    return true
  }
  return false
}

function cleanText(
  value: unknown,
  name: string,
  max: number,
  allowNewlines: boolean,
): string {
  if (typeof value !== 'string') throw invalid(`${name} 必须是文本`)
  const text = value.trim()
  if (!text) throw invalid(`${name} 不能为空`)
  if (text.length > max) throw invalid(`${name} 不能超过 ${max} 个字符`)
  if (HTML_TAG.test(text)) throw invalid(`${name} 只能包含纯文本，不支持 HTML`)
  if (hasControlCharacters(text, allowNewlines)) {
    throw invalid(`${name} 包含不支持的控制字符`)
  }
  return text
}

function parseTime(value: unknown, name: string): Date | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw invalid(`${name} 时间格式不正确`)
  const time = new Date(value)
  if (Number.isNaN(time.getTime())) throw invalid(`${name} 时间格式不正确`)
  return time
}

function readWindow(input: {
  startsAt?: string
  endsAt?: string
}): { startsAt?: Date; endsAt?: Date } {
  const startsAt = parseTime(input.startsAt, '开始时间')
  const endsAt = parseTime(input.endsAt, '结束时间')
  if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
    throw invalid('结束时间必须晚于开始时间')
  }
  return {
    ...(startsAt ? { startsAt } : {}),
    ...(endsAt ? { endsAt } : {}),
  }
}

function toView(row: AnnouncementRow): AnnouncementView {
  return {
    id: Number(row.id),
    title: row.title,
    body: row.body,
    level: row.level as AnnouncementView['level'],
    placement: row.placement as AnnouncementView['placement'],
    status: row.status as AnnouncementView['status'],
    ...(row.starts_at ? { startsAt: row.starts_at.toISOString() as AnnouncementView['startsAt'] } : {}),
    ...(row.ends_at ? { endsAt: row.ends_at.toISOString() as AnnouncementView['endsAt'] } : {}),
    createdBy: row.created_by as AnnouncementView['createdBy'],
    ...(row.published_by ? { publishedBy: row.published_by as AnnouncementView['publishedBy'] } : {}),
    createdAt: row.created_at.toISOString() as AnnouncementView['createdAt'],
    updatedAt: row.updated_at.toISOString() as AnnouncementView['updatedAt'],
  }
}

function toPublicView(row: AnnouncementRow): PublicAnnouncementView {
  return {
    title: row.title,
    body: row.body,
    level: row.level as PublicAnnouncementView['level'],
    placement: row.placement as PublicAnnouncementView['placement'],
    ...(row.starts_at ? { startsAt: row.starts_at.toISOString() as PublicAnnouncementView['startsAt'] } : {}),
    ...(row.ends_at ? { endsAt: row.ends_at.toISOString() as PublicAnnouncementView['endsAt'] } : {}),
  }
}

export async function getAnnouncement(
  db: Kysely<Database>,
  id: number,
): Promise<AnnouncementGetResult> {
  const row = await db
    .selectFrom('admin.admin_announcement')
    .selectAll()
    .where('id', '=', String(id))
    .executeTakeFirst()
  if (!row) throw notFound()
  return { announcement: toView(row) }
}

type AnnouncementCursor = { v: string; id: string }

function sortExpression(sort: (typeof SORTS)[number]) {
  if (sort === 'startsAt') return sql`coalesce(starts_at, to_timestamp(0))`
  return sql`${sql.ref(sort === 'updatedAt' ? 'updated_at' : 'created_at')}`
}

function sortValue(row: AnnouncementRow, sort: (typeof SORTS)[number]): string {
  if (sort === 'startsAt') {
    return (row.starts_at ?? new Date(0)).toISOString()
  }
  return (sort === 'updatedAt' ? row.updated_at : row.created_at).toISOString()
}

export async function listAnnouncements(
  db: Kysely<Database>,
  params: {
    status?: string
    placement?: string
    q?: string
    startsAfter?: string
    startsBefore?: string
    endsAfter?: string
    endsBefore?: string
    sort?: string
    direction?: string
    limit: number
    cursor?: string
  },
): Promise<AnnouncementListResult> {
  const sort = oneOf(params.sort, SORTS) ?? 'createdAt'
  const direction = params.direction === 'asc' ? 'asc' : 'desc'
  const status = params.status === undefined ? undefined : oneOf(params.status, STATUSES)
  if (params.status !== undefined && !status) throw invalid('公告状态不正确')
  const placement =
    params.placement === undefined ? undefined : oneOf(params.placement, PLACEMENTS)
  if (params.placement !== undefined && !placement) throw invalid('展示位置不正确')
  const keyword = params.q?.trim()
  if (keyword && keyword.length > TITLE_LIMIT) throw invalid('搜索关键词过长')
  const startsAfter = parseTime(params.startsAfter, '开始时间')
  const startsBefore = parseTime(params.startsBefore, '开始时间')
  const endsAfter = parseTime(params.endsAfter, '结束时间')
  const endsBefore = parseTime(params.endsBefore, '结束时间')

  let cursor: AnnouncementCursor | undefined
  if (params.cursor) {
    const decoded = decodeCursor(params.cursor)
    if (!decoded) throw invalid('分页参数无效')
    try {
      const parsed = JSON.parse(decoded) as AnnouncementCursor
      if (typeof parsed.v !== 'string' || typeof parsed.id !== 'string') throw new Error('bad')
      cursor = parsed
    } catch {
      throw invalid('分页参数无效')
    }
  }

  const expression = sortExpression(sort)
  const build = (withCursor: boolean) => {
    let query = db.selectFrom('admin.admin_announcement').selectAll()
    if (status) query = query.where('status', '=', status)
    if (placement) query = query.where('placement', '=', placement)
    if (keyword) {
      query = query.where(
        sql<boolean>`(position(lower(${keyword}) in lower(title)) > 0 or position(lower(${keyword}) in lower(body)) > 0)`,
      )
    }
    if (startsAfter) query = query.where('starts_at', '>=', startsAfter)
    if (startsBefore) query = query.where('starts_at', '<=', startsBefore)
    if (endsAfter) query = query.where('ends_at', '>=', endsAfter)
    if (endsBefore) query = query.where('ends_at', '<=', endsBefore)
    if (withCursor && cursor) {
      const operator = direction === 'asc' ? sql`>` : sql`<`
      query = query.where(
        sql<boolean>`(${expression}, id) ${operator} (${cursor.v}::timestamptz, ${cursor.id}::bigint)`,
      )
    }
    return query
  }

  const rows = await build(true)
    .orderBy(expression, direction)
    .orderBy('id', direction)
    .limit(params.limit)
    .execute()
  const last = rows.at(-1)
  return {
    announcements: rows.map(toView),
    ...(rows.length === params.limit && last
      ? {
          cursor: encodeCursor(
            JSON.stringify({
              v: sortValue(last, sort),
              id: last.id,
            } satisfies AnnouncementCursor),
          ),
        }
      : {}),
  }
}

export async function createAnnouncement(
  ctx: AnnouncementContext,
  input: {
    title: string
    body: string
    level: string
    placement: string
    startsAt?: string
    endsAt?: string
  },
): Promise<AnnouncementMutationResult> {
  const title = cleanText(input.title, '标题', TITLE_LIMIT, false)
  const body = cleanText(input.body, '正文', BODY_LIMIT, true)
  const level = oneOf(input.level, LEVELS)
  if (!level) throw invalid('公告级别不正确')
  const placement = oneOf(input.placement, PLACEMENTS)
  if (!placement) throw invalid('展示位置不正确')
  const window = readWindow(input)

  const row = await ctx.db.transaction().execute(async (trx) => {
    const inserted = await trx
      .insertInto('admin.admin_announcement')
      .values({
        title,
        body,
        level,
        placement,
        status: 'draft',
        starts_at: window.startsAt ?? null,
        ends_at: window.endsAt ?? null,
        created_by: ctx.actor,
      })
      .returningAll()
      .executeTakeFirstOrThrow()
    await insertAudit(trx, {
      actor: ctx.actor,
      action: 'com.selfcommand.admin.announcement.create',
      targetType: 'announcement',
      target: inserted.id,
      result: 'success',
      detail: `创建公告草稿：${title}`,
      ...ctx.meta,
    })
    return inserted
  })
  return { announcement: toView(row) }
}

export async function updateAnnouncement(
  ctx: AnnouncementContext,
  input: {
    id: number
    title: string
    body: string
    level: string
    placement: string
    startsAt?: string
    endsAt?: string
  },
): Promise<AnnouncementMutationResult> {
  const title = cleanText(input.title, '标题', TITLE_LIMIT, false)
  const body = cleanText(input.body, '正文', BODY_LIMIT, true)
  const level = oneOf(input.level, LEVELS)
  if (!level) throw invalid('公告级别不正确')
  const placement = oneOf(input.placement, PLACEMENTS)
  if (!placement) throw invalid('展示位置不正确')
  const window = readWindow(input)

  const row = await ctx.db.transaction().execute(async (trx) => {
    const existing = await trx
      .selectFrom('admin.admin_announcement')
      .selectAll()
      .where('id', '=', String(input.id))
      .forUpdate()
      .executeTakeFirst()
    if (!existing) throw notFound()
    if (existing.status !== 'draft') throw invalidState('只有草稿可以编辑。')
    const updated = await trx
      .updateTable('admin.admin_announcement')
      .set({
        title,
        body,
        level,
        placement,
        starts_at: window.startsAt ?? null,
        ends_at: window.endsAt ?? null,
        updated_at: sql`now()`,
      })
      .where('id', '=', String(input.id))
      .returningAll()
      .executeTakeFirstOrThrow()
    await insertAudit(trx, {
      actor: ctx.actor,
      action: 'com.selfcommand.admin.announcement.update',
      targetType: 'announcement',
      target: String(input.id),
      result: 'success',
      detail: `修改公告草稿：${title}`,
      ...ctx.meta,
    })
    return updated
  })
  return { announcement: toView(row) }
}

async function applyStatusChange(
  trx: Transaction<Database>,
  opts: {
    id: number
    from: 'draft' | 'published'
    to: 'published' | 'archived'
    actor: string
    meta: RequestMeta
    approvalId?: string
    title: string
    action: string
    detail: string
  },
): Promise<void> {
  const existing = await trx
    .selectFrom('admin.admin_announcement')
    .selectAll()
    .where('id', '=', String(opts.id))
    .forUpdate()
    .executeTakeFirst()
  if (!existing) throw notFound()
  if (existing.status !== opts.from) {
    throw invalidState(
      opts.to === 'published' ? '只有草稿可以发布。' : '只有已发布的公告可以下线。',
    )
  }
  await trx
    .updateTable('admin.admin_announcement')
    .set({
      status: opts.to,
      ...(opts.to === 'published' ? { published_by: opts.actor } : {}),
      updated_at: sql`now()`,
    })
    .where('id', '=', String(opts.id))
    .execute()
  await insertAudit(trx, {
    actor: opts.actor,
    action: opts.action,
    targetType: 'announcement',
    target: String(opts.id),
    result: 'success',
    detail: `${opts.detail}：${opts.title}`,
    ...(opts.approvalId ? { approvalId: opts.approvalId } : {}),
    ...opts.meta,
  })
}

export async function applyAnnouncementPublish(
  trx: Transaction<Database>,
  ctx: { actor: string; meta: RequestMeta },
  id: number,
  approvalId?: string,
): Promise<void> {
  const row = await trx
    .selectFrom('admin.admin_announcement')
    .select(['title'])
    .where('id', '=', String(id))
    .executeTakeFirst()
  if (!row) throw notFound()
  await applyStatusChange(trx, {
    id,
    from: 'draft',
    to: 'published',
    actor: ctx.actor,
    meta: ctx.meta,
    title: row.title,
    action: 'com.selfcommand.admin.announcement.publish',
    detail: '发布公告',
    ...(approvalId ? { approvalId } : {}),
  })
}

export async function applyAnnouncementArchive(
  trx: Transaction<Database>,
  ctx: { actor: string; meta: RequestMeta },
  id: number,
  approvalId?: string,
): Promise<void> {
  const row = await trx
    .selectFrom('admin.admin_announcement')
    .select(['title'])
    .where('id', '=', String(id))
    .executeTakeFirst()
  if (!row) throw notFound()
  await applyStatusChange(trx, {
    id,
    from: 'published',
    to: 'archived',
    actor: ctx.actor,
    meta: ctx.meta,
    title: row.title,
    action: 'com.selfcommand.admin.announcement.archive',
    detail: '下线公告',
    ...(approvalId ? { approvalId } : {}),
  })
}

function approvalContext(ctx: AnnouncementContext): ApprovalContext {
  return {
    db: ctx.db,
    logger: ctx.logger,
    actor: ctx.actor,
    meta: ctx.meta,
    ttlHours: ctx.ttlHours,
  }
}

async function runStatusChange(
  ctx: AnnouncementContext,
  input: { id: number; approvalId?: string },
  action: 'announcement.publish' | 'announcement.archive',
): Promise<AnnouncementMutationResult> {
  const approvalId = input.approvalId?.trim() || undefined
  const payload: ApprovalPayload = { announcementId: input.id }
  const apply = action === 'announcement.publish'
    ? applyAnnouncementPublish
    : applyAnnouncementArchive

  if (approvalId) {
    await executeWithApproval(approvalContext(ctx), {
      id: approvalId,
      action,
      payload,
      run: async (trx) => {
        await apply(trx, { actor: ctx.actor, meta: ctx.meta }, input.id, approvalId)
      },
    })
  } else if (await isSoleAdmin(ctx.db)) {
    await ctx.db.transaction().execute(async (trx) => {
      await apply(trx, { actor: ctx.actor, meta: ctx.meta }, input.id)
    })
  } else {
    throw approvalRequired(action)
  }

  return getAnnouncement(ctx.db, input.id)
}

export async function publishAnnouncement(
  ctx: AnnouncementContext,
  input: { id: number; approvalId?: string; reason?: string },
): Promise<AnnouncementMutationResult> {
  return runStatusChange(ctx, input, 'announcement.publish')
}

export async function archiveAnnouncement(
  ctx: AnnouncementContext,
  input: { id: number; approvalId?: string; reason?: string },
): Promise<AnnouncementMutationResult> {
  return runStatusChange(ctx, input, 'announcement.archive')
}

export async function listPublicAnnouncements(
  db: Kysely<Database>,
  params: { placement?: string; limit: number },
): Promise<PublicAnnouncementResult> {
  const placement =
    params.placement === undefined ? undefined : oneOf(params.placement, PLACEMENTS)
  if (params.placement !== undefined && !placement) throw invalid('展示位置不正确')
  const now = new Date()
  let query = db
    .selectFrom('admin.admin_announcement')
    .selectAll()
    .where('status', '=', 'published')
    .where((eb) =>
      eb.or([eb('starts_at', 'is', null), eb('starts_at', '<=', now)]),
    )
    .where((eb) =>
      eb.or([eb('ends_at', 'is', null), eb('ends_at', '>', now)]),
    )
  if (placement) query = query.where('placement', '=', placement)
  const rows = await query.orderBy('created_at', 'desc').limit(params.limit).execute()
  return { announcements: rows.map(toPublicView) }
}
