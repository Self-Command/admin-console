import { com } from '@admin/lexicons'
import { LexServerError } from '@atproto/lex-server'
import { sql, type Kysely, type Selectable } from 'kysely'
import type { AdminAuditEventTable, AuditResult, Database } from '../db/types.js'
import { decodeCursor, encodeCursor } from '../pagination.js'

export type AuditEventView = com.selfcommand.admin.defs.AuditEvent

export type AuditListParams = {
  cursor?: string
  limit: number
  actor?: string
  action?: string
  target?: string
  result?: string
  since?: string
  until?: string
  sort?: string
  order?: string
}

export type AuditListResult = com.selfcommand.admin.audit.list.$OutputBody
export type AuditExportParams = com.selfcommand.admin.audit.export.$Params
export type AuditExportResult = com.selfcommand.admin.audit.export.$OutputBody

const AUDIT_RESULTS: readonly AuditResult[] = ['success', 'denied', 'error']

const AUDIT_SORTS = ['createdAt', 'actor', 'action', 'result'] as const
type AuditSort = (typeof AUDIT_SORTS)[number]

type AuditCursor = { v: string; id: string; s: AuditSort; o: 'asc' | 'desc' }

function parseAuditResult(value: string): AuditResult | null {
  return (AUDIT_RESULTS as readonly string[]).includes(value)
    ? (value as AuditResult)
    : null
}

function invalidRequest(message: string): LexServerError {
  return new LexServerError(400, { error: 'InvalidRequest', message })
}

function parseDate(name: string, value: string | undefined): Date | undefined {
  if (value === undefined) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw invalidRequest(`${name} must be an ISO datetime`)
  return date
}

function readSort(params: { sort?: string; order?: string }): {
  sort: AuditSort
  order: 'asc' | 'desc'
} {
  const sort = (params.sort ?? 'createdAt') as AuditSort
  if (!(AUDIT_SORTS as readonly string[]).includes(sort)) {
    throw invalidRequest('unknown sort field')
  }
  const order = (params.order ?? 'desc') as 'asc' | 'desc'
  if (order !== 'asc' && order !== 'desc') throw invalidRequest('order must be asc or desc')
  return { sort, order }
}

function decodeAuditCursor(cursor: string | undefined): AuditCursor | undefined {
  if (cursor === undefined) return undefined
  const decoded = decodeCursor(cursor)
  if (!decoded) throw invalidRequest('invalid cursor')
  try {
    const parsed = JSON.parse(decoded) as AuditCursor
    if (
      typeof parsed.v !== 'string' ||
      !/^\d{1,19}$/.test(parsed.id) ||
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

function toView(row: Selectable<AdminAuditEventTable>): AuditEventView {
  return {
    id: Number(row.id),
    createdAt: row.created_at.toISOString() as AuditEventView['createdAt'],
    actor: row.actor_did as AuditEventView['actor'],
    action: row.action,
    ...(row.target_type ? { targetType: row.target_type } : {}),
    ...(row.target_id ? { target: row.target_id } : {}),
    result: row.result,
    ...(row.detail ? { detail: row.detail } : {}),
    ...(row.request_id ? { requestId: row.request_id } : {}),
    ...(row.actor_ip ? { actorIp: row.actor_ip } : {}),
    ...(row.user_agent ? { userAgent: row.user_agent } : {}),
    ...(row.before ? { before: row.before as AuditEventView['before'] } : {}),
    ...(row.after ? { after: row.after as AuditEventView['after'] } : {}),
  }
}

function sortValue(row: Selectable<AdminAuditEventTable>, sort: AuditSort): string {
  if (sort === 'createdAt') return row.created_at.toISOString()
  if (sort === 'actor') return row.actor_did
  if (sort === 'action') return row.action
  return row.result
}

type Filters = {
  actor?: string
  action?: string
  target?: string
  result?: AuditResult
  since?: Date
  until?: Date
}

function buildQuery(
  db: Kysely<Database>,
  filters: Filters,
  sort: AuditSort,
  order: 'asc' | 'desc',
  cursor?: AuditCursor,
) {
  let query = db.selectFrom('admin.admin_audit_event as e')
  if (filters.actor) query = query.where('e.actor_did', '=', filters.actor)
  if (filters.action) query = query.where('e.action', '=', filters.action)
  if (filters.target) query = query.where('e.target_id', '=', filters.target)
  if (filters.result) query = query.where('e.result', '=', filters.result)
  if (filters.since) query = query.where('e.created_at', '>=', filters.since)
  if (filters.until) query = query.where('e.created_at', '<=', filters.until)

  const column =
    sort === 'createdAt'
      ? sql`e.created_at`
      : sort === 'actor'
        ? sql`e.actor_did`
        : sort === 'action'
          ? sql`e.action`
          : sql`e.result`
  if (cursor) {
    const op = order === 'asc' ? sql`>` : sql`<`
    const value = sort === 'createdAt' ? sql`${cursor.v}::timestamptz` : sql`${cursor.v}`
    query = query.where(
      sql<boolean>`(${column}, e.id) ${op} (${value}, ${cursor.id}::bigint)`,
    )
  }
  return { query, column, op: order }
}

type AuditFilterParams = {
  actor?: string
  action?: string
  target?: string
  result?: string
  since?: string
  until?: string
}

function readFilters(params: AuditFilterParams): Filters {
  const result = params.result === undefined ? undefined : parseAuditResult(params.result)
  if (params.result !== undefined && !result) {
    throw invalidRequest('result must be success, denied or error')
  }
  return {
    actor: params.actor,
    action: params.action,
    target: params.target,
    result: result ?? undefined,
    since: parseDate('since', params.since),
    until: parseDate('until', params.until),
  }
}

export async function listAuditEvents(
  db: Kysely<Database>,
  params: AuditListParams,
): Promise<AuditListResult> {
  const cursor = decodeAuditCursor(params.cursor)
  const { sort, order } = readSort(params)
  if (cursor && (cursor.s !== sort || cursor.o !== order)) {
    throw invalidRequest('cursor does not match the requested sort order')
  }
  const filters = readFilters(params)

  const page = buildQuery(db, filters, sort, order, cursor)
  const rows = await page.query
    .selectAll()
    .orderBy(page.column, order)
    .orderBy('e.id', order)
    .limit(params.limit)
    .execute()

  const totalRow = await buildQuery(db, filters, sort, order).query
    .select(sql<number>`count(*)::int`.as('count'))
    .executeTakeFirstOrThrow()

  const last = rows.at(-1)
  const nextCursor = last
    ? encodeCursor(
        JSON.stringify({
          v: sortValue(last, sort),
          id: String(last.id),
          s: sort,
          o: order,
        } satisfies AuditCursor),
      )
    : undefined

  return {
    total: totalRow.count,
    events: rows.map(toView),
    ...(rows.length === params.limit && nextCursor ? { cursor: nextCursor } : {}),
  }
}

function csvField(value: unknown): string {
  if (value === undefined || value === null) return ''
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const CSV_COLUMNS = [
  'id',
  'createdAt',
  'actor',
  'action',
  'targetType',
  'target',
  'result',
  'detail',
  'requestId',
  'actorIp',
  'userAgent',
] as const

export async function exportAuditEvents(
  db: Kysely<Database>,
  params: AuditExportParams,
  maxRows: number,
): Promise<AuditExportResult> {
  const filters = readFilters(params)
  const totalRow = await buildQuery(db, filters, 'createdAt', 'desc').query
    .select(sql<number>`count(*)::int`.as('count'))
    .executeTakeFirstOrThrow()
  if (totalRow.count > maxRows) {
    throw new LexServerError(413, {
      error: 'ExportTooLarge',
      message: `The export contains ${totalRow.count} events; narrow the filters to ${maxRows} or fewer`,
    })
  }

  const rows = await buildQuery(db, filters, 'createdAt', 'desc').query
    .selectAll()
    .orderBy('e.id', 'desc')
    .limit(maxRows)
    .execute()
  const events = rows.map(toView)
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')

  if (params.format === 'json') {
    return {
      filename: `audit-${stamp}.json`,
      contentType: 'application/json; charset=utf-8',
      content: JSON.stringify({ exportedAt: new Date().toISOString(), total: events.length, events }, null, 2),
      rows: events.length,
    }
  }

  const header = CSV_COLUMNS.join(',')
  const body = events
    .map((event) =>
      CSV_COLUMNS.map((column) => csvField(event[column])).join(','),
    )
    .join('\r\n')
  return {
    filename: `audit-${stamp}.csv`,
    contentType: 'text/csv; charset=utf-8',
    content: `\ufeff${header}\r\n${body}${body ? '\r\n' : ''}`,
    rows: events.length,
  }
}
