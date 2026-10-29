import { com } from '@admin/lexicons'
import { LexServerError } from '@atproto/lex-server'
import { sql, type Kysely } from 'kysely'
import type { AuditResult, Database } from '../db/types.js'
import { decodeCursor, encodeCursor } from '../pagination.js'

export type AuditEventView = com.selfcommand.admin.defs.AuditEvent

export type AuditListParams = {
  cursor?: string
  limit: number
  actor?: string
  action?: string
  result?: string
  since?: string
  until?: string
}

export type AuditListResult = com.selfcommand.admin.audit.list.$OutputBody

const AUDIT_RESULTS: readonly AuditResult[] = ['success', 'denied', 'error']

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

function decodeIdCursor(cursor: string | undefined): string | undefined {
  if (cursor === undefined) return undefined
  const decoded = decodeCursor(cursor)
  if (!decoded || !/^\d{1,19}$/.test(decoded)) throw invalidRequest('invalid cursor')
  return decoded
}

export async function listAuditEvents(
  db: Kysely<Database>,
  params: AuditListParams,
): Promise<AuditListResult> {
  const cursor = decodeIdCursor(params.cursor)
  const since = parseDate('since', params.since)
  const until = parseDate('until', params.until)
  const result = params.result === undefined ? undefined : parseAuditResult(params.result)
  if (params.result !== undefined && !result) {
    throw invalidRequest('result must be success, denied or error')
  }

  const build = (withCursor: boolean) => {
    let query = db.selectFrom('admin.admin_audit_event as e')
    if (params.actor) query = query.where('e.actor_did', '=', params.actor)
    if (params.action) query = query.where('e.action', '=', params.action)
    if (result) query = query.where('e.result', '=', result)
    if (since) query = query.where('e.created_at', '>=', since)
    if (until) query = query.where('e.created_at', '<=', until)
    if (withCursor && cursor) {
      query = query.where(sql<boolean>`e.id < ${cursor}::bigint`)
    }
    return query
  }

  const rows = await build(true)
    .selectAll()
    .orderBy('e.id', 'desc')
    .limit(params.limit)
    .execute()

  const totalRow = await build(false)
    .select(sql<number>`count(*)::int`.as('count'))
    .executeTakeFirstOrThrow()

  const last = rows.at(-1)
  return {
    total: totalRow.count,
    events: rows.map((row) => ({
      id: Number(row.id),
      createdAt: row.created_at.toISOString() as AuditEventView['createdAt'],
      actor: row.actor_did as AuditEventView['actor'],
      action: row.action,
      ...(row.target_type ? { targetType: row.target_type } : {}),
      ...(row.target_id ? { target: row.target_id } : {}),
      result: row.result,
      ...(row.detail ? { detail: row.detail } : {}),
    })),
    ...(rows.length === params.limit && last
      ? { cursor: encodeCursor(String(last.id)) }
      : {}),
  }
}
