import type { Kysely, Transaction } from 'kysely'
import type { AuditResult, Database } from './db/types.js'
import { redactString, type Logger } from './logger.js'

export type AuditExecutor = Kysely<Database> | Transaction<Database>

export type AuditRecord = {
  actor: string
  action: string
  targetType?: string
  target?: string
  result: AuditResult
  detail?: string
}

function clamp(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value
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
    logger.error('audit write failed', {
      action: record.action,
      actor: record.actor,
      error,
    })
  }
}
