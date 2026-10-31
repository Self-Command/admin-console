import { createHash, randomUUID } from 'node:crypto'
import { com } from '@admin/lexicons'
import { LexServerError } from '@atproto/lex-server'
import { sql, type Kysely, type Transaction } from 'kysely'
import { insertAudit, insertAuditSafely, type RequestMeta } from '../audit.js'
import { isValidDid, parseRole } from '../auth/roles.js'
import type { ApprovalActionName, ApprovalStatus, Database } from '../db/types.js'
import { redactString, type Logger } from '../logger.js'
import { decodeCursor, encodeCursor } from '../pagination.js'
import {
  normalizeAccountDeletePayload,
  normalizeAccountUpdatePayload,
  normalizeModerationActPayload,
  normalizeNotificationSendPayload,
  normalizePolicyWritePayload,
  normalizeVerificationGrantPayload,
  normalizeVerificationRevokePayload,
} from './action-payloads.js'

export type ApprovalView = com.selfcommand.admin.defs.Approval
export type ApprovalCreateResult = com.selfcommand.admin.approval.create.$OutputBody
export type ApprovalListResult = com.selfcommand.admin.approval.list.$OutputBody
export type ApprovalApproveResult = com.selfcommand.admin.approval.approve.$OutputBody
export type ApprovalRejectResult = com.selfcommand.admin.approval.reject.$OutputBody
export type ApprovalCancelResult = com.selfcommand.admin.approval.cancel.$OutputBody

export type ApprovalPayload = Record<string, unknown>

export const APPROVAL_ACTIONS: readonly ApprovalActionName[] = [
  'settings.resetAll',
  'role.revoke',
  'role.demote',
  'role.import',
  'moderation.takedown',
  'moderation.batch',
  'moderation.label',
  'verification.grant',
  'verification.revoke',
  'account.admin.update',
  'account.admin.delete',
  'notifications.send',
  'policy.write',
  'announcement.publish',
  'announcement.archive',
]

export const APPROVAL_ACTION_LABELS: Record<ApprovalActionName, string> = {
  'settings.resetAll': '全部恢复默认设置',
  'role.revoke': '撤销管理员角色',
  'role.demote': '降级管理员角色',
  'role.import': '批量导入角色',
  'moderation.takedown': '下架或限制内容',
  'moderation.batch': '批量处置内容',
  'moderation.label': '为内容添加标签',
  'verification.grant': '发放认证',
  'verification.revoke': '撤销认证',
  'account.admin.update': '修改账号资料',
  'account.admin.delete': '删除账号',
  'notifications.send': '批量发送通知',
  'policy.write': '修改审核策略',
  'announcement.publish': '发布站内公告',
  'announcement.archive': '下线站内公告',
}

const STATUSES: readonly ApprovalStatus[] = [
  'pending',
  'executed',
  'rejected',
  'cancelled',
  'expired',
  'failed',
]

function invalid(message: string): LexServerError {
  return new LexServerError(400, { error: 'InvalidRequest', message })
}

function stateError(message: string): LexServerError {
  return new LexServerError(409, { error: 'ApprovalState', message })
}

function forbidden(message: string): LexServerError {
  return new LexServerError(403, { error: 'Forbidden', message })
}

export function approvalRequired(action: ApprovalActionName): LexServerError {
  return new LexServerError(409, {
    error: 'ApprovalRequired',
    message: `「${APPROVAL_ACTION_LABELS[action]}」需要另一位管理员批准，请先发起审批请求。`,
  })
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stableValue(item))
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const sorted: ApprovalPayload = {}
    for (const key of Object.keys(record).sort()) sorted[key] = stableValue(record[key])
    return sorted
  }
  return value
}

export function approvalHash(action: ApprovalActionName, payload: unknown): string {
  const canonical = JSON.stringify(stableValue({ action, payload }))
  return createHash('sha256').update(canonical).digest('hex')
}

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(`${name} must be an object`)
  }
  return value as Record<string, unknown>
}

function rejectUnknown(
  value: Record<string, unknown>,
  allowed: readonly string[],
  name: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw invalid(`${name} has an unknown field: ${key}`)
  }
}

function readOptionalText(value: unknown, name: string, max: number): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw invalid(`${name} must be a string`)
  const trimmed = value.trim()
  if (trimmed.length > max) throw invalid(`${name} must be at most ${max} characters`)
  return trimmed || undefined
}

export function normalizeApprovalPayload(
  action: ApprovalActionName,
  raw: unknown,
): ApprovalPayload {
  const payload = asRecord(raw, 'payload')
  if (action === 'settings.resetAll') {
    rejectUnknown(payload, ['reason'], 'payload')
    const reason = readOptionalText(payload.reason, 'payload.reason', 200)
    return reason ? { reason } : {}
  }
  if (action === 'role.revoke') {
    rejectUnknown(payload, ['subject'], 'payload')
    if (!isValidDid(payload.subject)) throw invalid('payload.subject must be a DID')
    return { subject: payload.subject }
  }
  if (action === 'role.demote') {
    rejectUnknown(payload, ['subject', 'role', 'note'], 'payload')
    if (!isValidDid(payload.subject)) throw invalid('payload.subject must be a DID')
    const role = parseRole(payload.role)
    if (!role || role === 'admin') throw invalid('payload.role must be operator or viewer')
    const note = readOptionalText(payload.note, 'payload.note', 200)
    return { subject: payload.subject, role, ...(note ? { note } : {}) }
  }
  if (action === 'moderation.takedown' || action === 'moderation.batch') {
    const normalized = normalizeModerationActPayload(payload)
    if (action === 'moderation.takedown') {
      if (normalized.subjects.length !== 1) {
        throw invalid('下架审批只允许一个对象；多个对象请使用批量处置审批')
      }
      if (!['takedown', 'mute'].includes(normalized.action)) {
        throw invalid('该审批动作只支持单个对象的下架或账号限制')
      }
      if (normalized.action === 'mute' && normalized.durationInHours === undefined) {
        throw invalid('账号限制必须提供持续时长（小时）')
      }
    } else {
      if (normalized.subjects.length < 2) {
        throw invalid('批量处置审批至少需要两个对象')
      }
      if (!['takedown', 'label', 'mute'].includes(normalized.action)) {
        throw invalid('批量处置审批只支持下架、标签或静音')
      }
      if (normalized.action === 'mute' && normalized.durationInHours === undefined) {
        throw invalid('账号限制必须提供持续时长（小时）')
      }
    }
    return { ...normalized }
  }
  if (action === 'moderation.label') {
    const normalized = normalizeModerationActPayload(payload)
    if (normalized.action !== 'label') throw invalid('该审批动作只支持内容标签')
    if (normalized.subjects.length !== 1) {
      throw invalid('单个对象的内容标签审批只允许一个对象；多个对象请使用批量处置审批')
    }
    return { ...normalized }
  }
  if (action === 'announcement.publish' || action === 'announcement.archive') {
    rejectUnknown(payload, ['announcementId'], 'payload')
    const id = payload.announcementId
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) {
      throw invalid('payload.announcementId must be a positive integer')
    }
    return { announcementId: id }
  }
  if (action === 'verification.grant') {
    return { ...normalizeVerificationGrantPayload(payload) }
  }
  if (action === 'verification.revoke') {
    return { ...normalizeVerificationRevokePayload(payload) }
  }
  if (action === 'account.admin.update') {
    return { ...normalizeAccountUpdatePayload(payload) }
  }
  if (action === 'account.admin.delete') {
    return { ...normalizeAccountDeletePayload(payload) }
  }
  if (action === 'notifications.send') {
    return { ...normalizeNotificationSendPayload(payload) }
  }
  if (action === 'policy.write') {
    return { ...normalizePolicyWritePayload(payload) }
  }

  rejectUnknown(payload, ['bindings', 'batchId'], 'payload')
  const bindings = payload.bindings
  if (!Array.isArray(bindings) || bindings.length === 0 || bindings.length > 500) {
    throw invalid('payload.bindings must contain between 1 and 500 entries')
  }
  const prepared = bindings.map((entry, index) => {
    const binding = asRecord(entry, `payload.bindings[${index}]`)
    rejectUnknown(binding, ['subject', 'role', 'note'], `payload.bindings[${index}]`)
    if (!isValidDid(binding.subject)) {
      throw invalid(`payload.bindings[${index}].subject must be a DID`)
    }
    const role = parseRole(binding.role)
    if (!role) throw invalid(`payload.bindings[${index}].role must be admin, operator or viewer`)
    const note = readOptionalText(binding.note, `payload.bindings[${index}].note`, 200)
    return { subject: binding.subject, role, ...(note ? { note } : {}) }
  })
  const batchId = readOptionalText(payload.batchId, 'payload.batchId', 64)
  return { bindings: prepared, ...(batchId ? { batchId } : {}) }
}

function toView(row: {
  id: string
  action: string
  target_type: string | null
  target: string | null
  summary: string | null
  status: string
  requested_by: string
  requested_at: Date
  decided_by: string | null
  decided_at: Date | null
  expires_at: Date
  error: string | null
}): ApprovalView {
  return {
    id: row.id,
    action: row.action as ApprovalView['action'],
    ...(row.target_type ? { targetType: row.target_type } : {}),
    ...(row.target ? { target: row.target as ApprovalView['target'] } : {}),
    ...(row.summary ? { summary: row.summary as ApprovalView['summary'] } : {}),
    status: row.status as ApprovalView['status'],
    requestedBy: row.requested_by as ApprovalView['requestedBy'],
    requestedAt: row.requested_at.toISOString() as ApprovalView['requestedAt'],
    ...(row.decided_by ? { decidedBy: row.decided_by as ApprovalView['decidedBy'] } : {}),
    ...(row.decided_at
      ? { decidedAt: row.decided_at.toISOString() as ApprovalView['decidedAt'] }
      : {}),
    expiresAt: row.expires_at.toISOString() as ApprovalView['expiresAt'],
    ...(row.error ? { error: row.error as ApprovalView['error'] } : {}),
  }
}

export type ApprovalSeal = (
  action: ApprovalActionName,
  payload: ApprovalPayload,
) => ApprovalPayload

export type ApprovalContext = {
  db: Kysely<Database>
  logger: Logger
  actor: string
  meta: RequestMeta
  ttlHours: number
  seal?: ApprovalSeal
}

export async function expireOverdueApprovals(db: Kysely<Database>): Promise<void> {
  await db
    .updateTable('admin.admin_approval')
    .set({ status: 'expired' })
    .where('status', '=', 'pending')
    .where('expires_at', '<=', new Date())
    .execute()
}

export async function createApproval(
  ctx: ApprovalContext,
  input: { action: unknown; targetType?: unknown; target?: unknown; summary?: unknown; payload: unknown },
): Promise<ApprovalCreateResult> {
  const action = APPROVAL_ACTIONS.includes(input.action as ApprovalActionName)
    ? (input.action as ApprovalActionName)
    : null
  if (!action) throw invalid('action is not a supported approval action')
  const normalized = normalizeApprovalPayload(action, input.payload)
  const payload = ctx.seal ? ctx.seal(action, normalized) : normalized
  const targetType = readOptionalText(input.targetType, 'targetType', 64)
  const target = readOptionalText(input.target, 'target', 512)
  const summary =
    readOptionalText(input.summary, 'summary', 200) ??
    `${APPROVAL_ACTION_LABELS[action]}${target ? `（${target}）` : ''}`

  const id = randomUUID()
  const expiresAt = new Date(Date.now() + ctx.ttlHours * 60 * 60 * 1000)
  const row = await ctx.db
    .insertInto('admin.admin_approval')
    .values({
      id,
      action,
      target_type: targetType ?? null,
      target: target ?? null,
      summary,
      payload: JSON.stringify(payload),
      payload_hash: approvalHash(action, payload),
      status: 'pending',
      requested_by: ctx.actor,
      expires_at: expiresAt,
    })
    .returningAll()
    .executeTakeFirstOrThrow()

  await insertAuditSafely(ctx.db, ctx.logger, {
    actor: ctx.actor,
    action: 'com.selfcommand.admin.approval.create',
    targetType: 'approval',
    target: id,
    result: 'success',
    detail: `发起审批请求：${APPROVAL_ACTION_LABELS[action]}`,
    ...ctx.meta,
  })
  return { approval: toView(row) }
}

type ApprovalCursor = { v: string; id: string }

function decodeApprovalCursor(value: string | undefined): ApprovalCursor | undefined {
  if (value === undefined) return undefined
  const decoded = decodeCursor(value)
  if (!decoded) throw invalid('invalid cursor')
  try {
    const parsed = JSON.parse(decoded) as ApprovalCursor
    if (typeof parsed.v !== 'string' || typeof parsed.id !== 'string') throw new Error('bad')
    return parsed
  } catch {
    throw invalid('invalid cursor')
  }
}

export async function listApprovals(
  db: Kysely<Database>,
  params: { status?: string; cursor?: string; limit: number },
): Promise<ApprovalListResult> {
  if (params.status !== undefined && !STATUSES.includes(params.status as ApprovalStatus)) {
    throw invalid('status is not a known approval status')
  }
  await expireOverdueApprovals(db)
  const cursor = decodeApprovalCursor(params.cursor)

  const build = (withCursor: boolean) => {
    let query = db.selectFrom('admin.admin_approval')
    if (params.status) query = query.where('status', '=', params.status as ApprovalStatus)
    if (withCursor && cursor) {
      query = query.where(
        sql<boolean>`(requested_at, id) < (${cursor.v}::timestamptz, ${cursor.id})`,
      )
    }
    return query
  }

  const rows = await build(true)
    .selectAll()
    .orderBy('requested_at', 'desc')
    .orderBy('id', 'desc')
    .limit(params.limit)
    .execute()
  const totalRow = await build(false)
    .select(sql<number>`count(*)::int`.as('count'))
    .executeTakeFirstOrThrow()
  const last = rows.at(-1)
  return {
    total: totalRow.count,
    approvals: rows.map(toView),
    ...(rows.length === params.limit && last
      ? {
          cursor: encodeCursor(
            JSON.stringify({
              v: last.requested_at.toISOString(),
              id: last.id,
            } satisfies ApprovalCursor),
          ),
        }
      : {}),
  }
}

function lockedState(trx: Transaction<Database>, id: string) {
  return trx
    .selectFrom('admin.admin_approval')
    .selectAll()
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst()
}

type PendingRow = NonNullable<Awaited<ReturnType<typeof lockedState>>>

async function requirePending(
  trx: Transaction<Database>,
  row: PendingRow | undefined,
  actor: string,
  action?: ApprovalActionName,
  payloadHash?: string,
): Promise<{ row: PendingRow; payload: ApprovalPayload }> {
  if (!row) {
    throw new LexServerError(404, { error: 'ApprovalNotFound', message: '审批请求不存在' })
  }
  if (action && row.action !== action) {
    throw stateError('审批请求的动作与本次调用不一致')
  }
  if (payloadHash && row.payload_hash !== payloadHash) {
    throw stateError('审批请求的内容与本次调用不一致，请重新发起请求')
  }
  if (row.requested_by === actor) {
    throw forbidden('请求人不能批准或执行自己的审批请求')
  }
  if (row.status !== 'pending') {
    throw stateError(`审批请求当前状态为 ${row.status}，不能再次执行`)
  }
  if (row.expires_at.getTime() <= Date.now()) {
    await trx
      .updateTable('admin.admin_approval')
      .set({ status: 'expired' })
      .where('id', '=', row.id)
      .execute()
    throw stateError('审批请求已过期，请重新发起')
  }
  return { row, payload: asPayload(row.payload) }
}

function asPayload(value: unknown): ApprovalPayload {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value), 'payload')
    } catch {
      throw stateError('审批请求内容已损坏，请重新发起')
    }
  }
  return asRecord(value, 'payload')
}

const SAVEPOINT = 'approval_execution'

export type ApprovalExecutor = (
  trx: Transaction<Database>,
  action: ApprovalActionName,
  payload: ApprovalPayload,
) => Promise<void>

async function runGuarded(
  trx: Transaction<Database>,
  run: () => Promise<void>,
): Promise<unknown | null> {
  await sql.raw(`savepoint ${SAVEPOINT}`).execute(trx)
  try {
    await run()
    await sql.raw(`release savepoint ${SAVEPOINT}`).execute(trx)
    return null
  } catch (error) {
    await sql.raw(`rollback to savepoint ${SAVEPOINT}`).execute(trx)
    return error
  }
}

// A terminal approval never needs the sealed password again; dropping it keeps
// the secret out of long-lived rows regardless of the execution outcome.
async function scrubSealedPayload(
  trx: Transaction<Database>,
  id: string,
  action: string,
): Promise<void> {
  if (action !== 'account.admin.update') return
  await trx
    .updateTable('admin.admin_approval')
    .set({ payload: sql`${sql.ref('payload')} - 'passwordSealed'` })
    .where('id', '=', id)
    .execute()
}

async function markExecuted(
  trx: Transaction<Database>,
  id: string,
  actor: string,
  action: string,
): Promise<void> {
  await trx
    .updateTable('admin.admin_approval')
    .set({
      status: 'executed',
      decided_by: actor,
      decided_at: new Date(),
      error: null,
    })
    .where('id', '=', id)
    .execute()
  await scrubSealedPayload(trx, id, action)
}

async function markFailed(
  trx: Transaction<Database>,
  id: string,
  actor: string,
  action: string,
  error: unknown,
): Promise<void> {
  const message = redactString(
    error instanceof LexServerError ? error.message : String(error),
  ).slice(0, 500)
  await trx
    .updateTable('admin.admin_approval')
    .set({
      status: 'failed',
      decided_by: actor,
      decided_at: new Date(),
      error: message,
    })
    .where('id', '=', id)
    .execute()
  await scrubSealedPayload(trx, id, action)
}

export async function approveApproval(
  ctx: ApprovalContext,
  id: string,
  execute: ApprovalExecutor,
): Promise<ApprovalApproveResult> {
  const outcome = await ctx.db.transaction().execute(async (trx) => {
    const locked = await lockedState(trx, id)
    const { row, payload } = await requirePending(trx, locked, ctx.actor)
    const failure = await runGuarded(trx, async () => {
      await execute(trx, row.action, payload)
    })
    if (failure !== null) {
      await markFailed(trx, id, ctx.actor, row.action, failure)
      await insertAudit(trx, {
        actor: ctx.actor,
        action: 'com.selfcommand.admin.approval.approve',
        targetType: 'approval',
        target: id,
        result: 'error',
        detail: `批准后执行失败：${APPROVAL_ACTION_LABELS[row.action]}`,
        approvalId: id,
        ...ctx.meta,
      })
      return { error: failure }
    }
    await markExecuted(trx, id, ctx.actor, row.action)
    const updated = await trx
      .selectFrom('admin.admin_approval')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow()
    await insertAudit(trx, {
      actor: ctx.actor,
      action: 'com.selfcommand.admin.approval.approve',
      targetType: 'approval',
      target: id,
      result: 'success',
      detail: `批准并执行：${APPROVAL_ACTION_LABELS[row.action]}`,
      approvalId: id,
      ...ctx.meta,
    })
    return { approval: toView(updated) }
  })
  if ('error' in outcome) throw outcome.error
  return outcome
}

export async function executeWithApproval(
  ctx: ApprovalContext,
  opts: {
    id: string
    action: ApprovalActionName
    payload: ApprovalPayload
    run: (trx: Transaction<Database>) => Promise<void>
  },
): Promise<void> {
  const failure = await ctx.db.transaction().execute(async (trx) => {
    const locked = await lockedState(trx, opts.id)
    await requirePending(
      trx,
      locked,
      ctx.actor,
      opts.action,
      approvalHash(opts.action, opts.payload),
    )
    const runFailure = await runGuarded(trx, () => opts.run(trx))
    if (runFailure !== null) {
      await markFailed(trx, opts.id, ctx.actor, opts.action, runFailure)
      await insertAudit(trx, {
        actor: ctx.actor,
        action: 'com.selfcommand.admin.approval.approve',
        targetType: 'approval',
        target: opts.id,
        result: 'error',
        detail: `批准后执行失败：${APPROVAL_ACTION_LABELS[opts.action]}`,
        approvalId: opts.id,
        ...ctx.meta,
      })
      return runFailure
    }
    await markExecuted(trx, opts.id, ctx.actor, opts.action)
    await insertAudit(trx, {
      actor: ctx.actor,
      action: 'com.selfcommand.admin.approval.approve',
      targetType: 'approval',
      target: opts.id,
      result: 'success',
      detail: `批准并执行：${APPROVAL_ACTION_LABELS[opts.action]}`,
      approvalId: opts.id,
      ...ctx.meta,
    })
    return null
  })
  if (failure !== null) throw failure
}

export async function rejectApproval(
  ctx: ApprovalContext,
  id: string,
  reason: string | undefined,
): Promise<ApprovalRejectResult> {
  const note = readOptionalText(reason, 'reason', 200)
  return await ctx.db.transaction().execute(async (trx) => {
    const locked = await lockedState(trx, id)
    const { row } = await requirePending(trx, locked, ctx.actor)
    const updated = await trx
      .updateTable('admin.admin_approval')
      .set({
        status: 'rejected',
        decided_by: ctx.actor,
        decided_at: new Date(),
        error: note ?? null,
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow()
    await insertAudit(trx, {
      actor: ctx.actor,
      action: 'com.selfcommand.admin.approval.reject',
      targetType: 'approval',
      target: id,
      result: 'success',
      detail: `拒绝审批请求：${APPROVAL_ACTION_LABELS[row.action]}${note ? `（原因：${note}）` : ''}`,
      approvalId: id,
      ...ctx.meta,
    })
    return { approval: toView(updated) }
  })
}

export async function cancelApproval(
  ctx: ApprovalContext,
  id: string,
): Promise<ApprovalCancelResult> {
  return await ctx.db.transaction().execute(async (trx) => {
    const row = await lockedState(trx, id)
    if (!row) {
      throw new LexServerError(404, { error: 'ApprovalNotFound', message: '审批请求不存在' })
    }
    if (row.requested_by !== ctx.actor) {
      throw forbidden('只有请求人可以撤回审批请求')
    }
    if (row.status !== 'pending') {
      throw stateError(`审批请求当前状态为 ${row.status}，不能撤回`)
    }
    const updated = await trx
      .updateTable('admin.admin_approval')
      .set({ status: 'cancelled', decided_by: ctx.actor, decided_at: new Date() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow()
    await insertAudit(trx, {
      actor: ctx.actor,
      action: 'com.selfcommand.admin.approval.cancel',
      targetType: 'approval',
      target: id,
      result: 'success',
      detail: `撤回审批请求：${APPROVAL_ACTION_LABELS[row.action]}`,
      approvalId: id,
      ...ctx.meta,
    })
    return { approval: toView(updated) }
  })
}