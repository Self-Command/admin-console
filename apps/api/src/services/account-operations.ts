import { com } from '@admin/lexicons'
import { LexServerError } from '@atproto/lex-server'
import { sql, type Kysely, type Transaction } from 'kysely'
import { insertAudit, insertAuditSafely, type RequestMeta } from '../audit.js'
import { isValidDid } from '../auth/roles.js'
import type { Database } from '../db/types.js'
import type { DirectoryStore } from '../directory/store.js'
import type { Logger } from '../logger.js'

export type AccountOperationView = com.selfcommand.admin.defs.AccountOperation
export type AccountProfileGetResult = com.selfcommand.admin.account.profile.get.$OutputBody
export type AccountProfileUpdateInput = com.selfcommand.admin.account.profile.update.$InputBody
export type AccountExportResult = com.selfcommand.admin.account.export.$OutputBody
export type AccountBatchExportResult = com.selfcommand.admin.account.batch.export.$OutputBody

export const BATCH_EXPORT_LIMIT = 500
const NOTE_MAX = 500
const TAG_MAX = 10
const TAG_LENGTH_MAX = 24
const AUDIT_EXPORT_LIMIT = 100

function invalid(message: string): LexServerError {
  return new LexServerError(400, { error: 'InvalidRequest', message })
}

function notFound(): LexServerError {
  return new LexServerError(404, {
    error: 'AccountNotFound',
    message: 'The DID is not present in the indexed directory',
  })
}

function emptyOperation(did: string): AccountOperationView {
  return {
    did: did as AccountOperationView['did'],
    tags: [],
    syncPaused: false,
  }
}

function readNote(value: unknown): string | null {
  if (value === undefined) return null
  if (typeof value !== 'string') throw invalid('note must be a string')
  const trimmed = value.trim()
  if (trimmed.length > NOTE_MAX) {
    throw invalid(`note must be at most ${NOTE_MAX} characters`)
  }
  return trimmed || null
}

function readTags(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw invalid('tags must be an array of strings')
  if (value.length > TAG_MAX) throw invalid(`tags must contain at most ${TAG_MAX} entries`)
  const seen = new Set<string>()
  const tags: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') throw invalid('tags must be an array of strings')
    const tag = entry.trim()
    if (!tag) throw invalid('tags must not contain empty entries')
    if (tag.length > TAG_LENGTH_MAX) {
      throw invalid(`each tag must be at most ${TAG_LENGTH_MAX} characters`)
    }
    if (seen.has(tag)) continue
    seen.add(tag)
    tags.push(tag)
  }
  return tags
}

function toView(row: {
  did: string
  note: string | null
  tags: unknown
  sync_paused: boolean
  sync_paused_at: Date | null
  sync_paused_by: string | null
  updated_at: Date
  updated_by: string | null
}): AccountOperationView {
  const tags = Array.isArray(row.tags) ? row.tags.filter((item) => typeof item === 'string') : []
  return {
    did: row.did as AccountOperationView['did'],
    ...(row.note ? { note: row.note } : {}),
    tags,
    syncPaused: row.sync_paused,
    ...(row.sync_paused_at
      ? { syncPausedAt: row.sync_paused_at.toISOString() as AccountOperationView['syncPausedAt'] }
      : {}),
    ...(row.sync_paused_by
      ? { syncPausedBy: row.sync_paused_by as AccountOperationView['syncPausedBy'] }
      : {}),
    updatedAt: row.updated_at.toISOString() as AccountOperationView['updatedAt'],
    ...(row.updated_by
      ? { updatedBy: row.updated_by as AccountOperationView['updatedBy'] }
      : {}),
  }
}

async function loadOperation(
  db: Kysely<Database> | Transaction<Database>,
  did: string,
): Promise<AccountOperationView | null> {
  const row = await db
    .selectFrom('admin.account_operation')
    .selectAll()
    .where('did', '=', did)
    .executeTakeFirst()
  return row ? toView(row) : null
}

export async function getAccountProfile(
  db: Kysely<Database>,
  store: DirectoryStore,
  did: string,
): Promise<AccountProfileGetResult> {
  if (!isValidDid(did)) throw invalid('did must be a DID')
  const account = await store.getAccount(did)
  if (!account) throw notFound()
  const operation = (await loadOperation(db, did)) ?? emptyOperation(did)
  return { operation, account }
}

export type AccountOperationContext = {
  db: Kysely<Database>
  logger: Logger
  actor: string
  meta: RequestMeta
}

export async function updateAccountProfile(
  ctx: AccountOperationContext,
  input: AccountProfileUpdateInput,
): Promise<{ operation: AccountOperationView }> {
  const action = 'com.selfcommand.admin.account.profile.update'
  const did = input.did
  if (!isValidDid(did)) throw invalid('did must be a DID')
  const hasNote = input.note !== undefined
  const hasTags = input.tags !== undefined
  const hasPause = input.syncPaused !== undefined
  if (!hasNote && !hasTags && !hasPause) {
    throw invalid('at least one of note, tags or syncPaused must be provided')
  }
  const note = readNote(input.note)
  const tags = readTags(input.tags)

  const existingDirectory = await ctx.db
    .selectFrom('admin.account_directory')
    .select('did')
    .where('did', '=', did)
    .executeTakeFirst()
  if (!existingDirectory) throw notFound()

  try {
    return await ctx.db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom('admin.account_operation')
        .selectAll()
        .where('did', '=', did)
        .forUpdate()
        .executeTakeFirst()
      const before = existing ? toView(existing) : emptyOperation(did)
      const nextNote = hasNote ? note : (before.note ?? null)
      const nextTags = hasTags ? tags : (before.tags ?? [])
      const nextPaused = hasPause ? (input.syncPaused ?? false) : before.syncPaused
      const pausedAt = nextPaused
        ? nextPaused === before.syncPaused
          ? (existing?.sync_paused_at ?? null)
          : new Date()
        : null
      const pausedBy = nextPaused
        ? nextPaused === before.syncPaused
          ? (existing?.sync_paused_by ?? null)
          : ctx.actor
        : null

      const row = await trx
        .insertInto('admin.account_operation')
        .values({
          did,
          note: nextNote,
          tags: JSON.stringify(nextTags),
          sync_paused: nextPaused,
          sync_paused_at: pausedAt,
          sync_paused_by: pausedBy,
          updated_by: ctx.actor,
          updated_at: new Date(),
        })
        .onConflict((oc) =>
          oc.column('did').doUpdateSet({
            note: nextNote,
            tags: JSON.stringify(nextTags),
            sync_paused: nextPaused,
            sync_paused_at: pausedAt,
            sync_paused_by: pausedBy,
            updated_by: ctx.actor,
            updated_at: sql`now()`,
          }),
        )
        .returningAll()
        .executeTakeFirstOrThrow()

      const changes: string[] = []
      if (hasNote && (before.note ?? null) !== nextNote) {
        changes.push(nextNote ? '更新运营备注' : '清除运营备注')
      }
      if (hasTags && JSON.stringify(before.tags) !== JSON.stringify(nextTags)) {
        changes.push(`更新标签（${nextTags.length} 个）`)
      }
      if (nextPaused !== before.syncPaused) {
        changes.push(nextPaused ? '暂停目录同步' : '恢复目录同步')
      }

      await insertAudit(trx, {
        actor: ctx.actor,
        action,
        targetType: 'account',
        target: did,
        result: 'success',
        detail: changes.length > 0 ? changes.join('；') : '运营记录未发生变化',
        before,
        after: toView(row),
        ...ctx.meta,
      })

      return { operation: toView(row) }
    })
  } catch (error) {
    if (error instanceof LexServerError) {
      await insertAuditSafely(ctx.db, ctx.logger, {
        actor: ctx.actor,
        action,
        targetType: 'account',
        target: did,
        result: 'error',
        detail: `运营记录未保存（错误码：${error.body.error}）`,
        ...ctx.meta,
      })
    }
    throw error
  }
}

type AuditRow = {
  id: unknown
  created_at: Date
  actor_did: string
  action: string
  result: string
  detail: string | null
}

function toAuditView(row: AuditRow) {
  return {
    id: String(row.id),
    createdAt: row.created_at.toISOString(),
    actor: row.actor_did,
    action: row.action,
    result: row.result,
    ...(row.detail ? { detail: row.detail } : {}),
  }
}

export async function exportAccount(
  db: Kysely<Database>,
  store: DirectoryStore,
  did: string,
): Promise<AccountExportResult> {
  if (!isValidDid(did)) throw invalid('did must be a DID')
  const account = await store.getAccount(did)
  if (!account) throw notFound()
  const operation = (await loadOperation(db, did)) ?? emptyOperation(did)
  const role = await db
    .selectFrom('admin.admin_role')
    .select(['role', 'granted_by', 'created_at', 'updated_at'])
    .where('did', '=', did)
    .executeTakeFirst()
  const audit = await db
    .selectFrom('admin.admin_audit_event')
    .select(['id', 'created_at', 'actor_did', 'action', 'result', 'detail'])
    .where('target_id', '=', did)
    .orderBy('id', 'desc')
    .limit(AUDIT_EXPORT_LIMIT)
    .execute()

  return {
    document: {
      exportedAt: new Date().toISOString(),
      account,
      operation,
      role: role
        ? {
            role: role.role,
            grantedBy: role.granted_by,
            createdAt: role.created_at.toISOString(),
            updatedAt: role.updated_at.toISOString(),
          }
        : null,
      recentAudit: audit.map((row) => toAuditView(row as AuditRow)),
    },
  }
}

function csvCell(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ''
      : Array.isArray(value)
        ? value.join('|')
        : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export async function batchExportAccounts(
  db: Kysely<Database>,
  rawDids: readonly string[],
  format: string,
): Promise<AccountBatchExportResult> {
  const dids = [...new Set(rawDids.map((did) => did.trim()).filter(Boolean))]
  if (dids.length === 0) throw invalid('at least one account identifier is required')
  if (dids.length > BATCH_EXPORT_LIMIT) {
    throw invalid(`at most ${BATCH_EXPORT_LIMIT} accounts can be exported at once`)
  }
  for (const did of dids) {
    if (!isValidDid(did)) throw invalid(`did is not valid: ${did}`)
  }
  if (format !== 'json' && format !== 'csv') throw invalid('format must be json or csv')

  const accounts = await db
    .selectFrom('admin.account_directory')
    .selectAll()
    .where('did', 'in', dids)
    .orderBy('did', 'asc')
    .execute()
  const operations = await db
    .selectFrom('admin.account_operation')
    .selectAll()
    .where('did', 'in', dids)
    .execute()
  const operationByDid = new Map(operations.map((row) => [row.did, toView(row)]))

  const rows = accounts.map((row) => {
    const operation = operationByDid.get(row.did)
    return {
      did: row.did,
      handle: row.handle ?? '',
      status: row.status,
      note: operation?.note ?? '',
      tags: operation?.tags ?? [],
      syncPaused: operation?.syncPaused ?? false,
      lastEventAt: row.last_event_at?.toISOString() ?? '',
      indexedAt: row.indexed_at.toISOString(),
    }
  })

  if (format === 'csv') {
    const header = [
      'did',
      'handle',
      'status',
      'note',
      'tags',
      'syncPaused',
      'lastEventAt',
      'indexedAt',
    ]
    const lines = [header.join(',')]
    for (const row of rows) {
      lines.push(
        [
          row.did,
          row.handle,
          row.status,
          row.note,
          row.tags,
          row.syncPaused ? 'true' : 'false',
          row.lastEventAt,
          row.indexedAt,
        ]
          .map(csvCell)
          .join(','),
      )
    }
    return { count: rows.length, format: 'csv', content: `${lines.join('\r\n')}\r\n` }
  }

  return {
    count: rows.length,
    format: 'json',
    content: JSON.stringify({ exportedAt: new Date().toISOString(), accounts: rows }, null, 2),
  }
}