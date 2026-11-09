import { LexServerError } from '@atproto/lex-server'
import type { Kysely, Transaction } from 'kysely'
import type { AuditResult, Database } from './db/types.js'
import { redactString, type Logger } from './logger.js'
import { recordAuditFailure } from './metrics.js'

export type AuditExecutor = Kysely<Database> | Transaction<Database>

export type RequestMeta = {
  requestId?: string
  actorIp?: string
  userAgent?: string
}

export type AuditRecord = RequestMeta & {
  actor: string
  action: string
  targetType?: string
  target?: string
  result: AuditResult
  detail?: string
  approvalId?: string
  before?: unknown
  after?: unknown
}

function clamp(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value
}

function clampOptional(value: string | undefined, max: number): string | null {
  const trimmed = value?.trim()
  return trimmed ? clamp(trimmed, max) : null
}

export async function insertAudit(
  executor: AuditExecutor,
  record: AuditRecord,
): Promise<void> {
  await executor
    .insertInto('admin.admin_audit_event')
    .values({
      actor_did: record.actor,
      action: clamp(record.action, 128),
      target_type: record.targetType ? clamp(record.targetType, 64) : null,
      target_id: record.target ? clamp(record.target, 512) : null,
      result: record.result,
      detail: record.detail ? clamp(redactString(record.detail), 2000) : null,
      request_id: clampOptional(record.requestId, 128),
      actor_ip: clampOptional(record.actorIp, 64),
      user_agent: clampOptional(record.userAgent, 256),
      approval_id: clampOptional(record.approvalId, 64),
      before: record.before ?? null,
      after: record.after ?? null,
    })
    .execute()
}

export async function insertAuditSafely(
  db: Kysely<Database>,
  logger: Logger,
  record: AuditRecord,
): Promise<void> {
  try {
    await insertAudit(db, record)
  } catch (error) {
    recordAuditFailure()
    logger.error('audit write failed', {
      action: record.action,
      actor: record.actor,
      error,
    })
  }
}

export function requestMeta(request: Request): RequestMeta {
  const requestId = request.headers.get('x-request-id')?.trim()
  const actorIp = request.headers.get('x-admin-client-ip')?.trim()
  const userAgent = request.headers.get('user-agent')?.trim()
  return {
    ...(requestId ? { requestId: requestId.slice(0, 128) } : {}),
    ...(actorIp ? { actorIp: actorIp.slice(0, 64) } : {}),
    ...(userAgent ? { userAgent: userAgent.slice(0, 256) } : {}),
  }
}

export async function writeAudit(
  executor: AuditExecutor,
  logger: Logger,
  record: AuditRecord,
): Promise<void> {
  if ('isTransaction' in executor) {
    await insertAudit(executor, record)
    return
  }
  await insertAuditSafely(executor, logger, record)
}

export function auditErrorCode(error: unknown): string {
  return error instanceof LexServerError
    ? String(error.body.error ?? 'Error')
    : 'UpstreamUnavailable'
}
