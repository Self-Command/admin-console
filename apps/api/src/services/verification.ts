import { com } from '@admin/lexicons'
import { isDidString } from '@atproto/lex-schema'
import { LexServerError } from '@atproto/lex-server'
import type { Kysely } from 'kysely'
import {
  auditErrorCode,
  writeAudit,
  type AuditExecutor,
  type RequestMeta,
} from '../audit.js'
import { isSoleAdmin } from '../auth/roles.js'
import type { ApprovalActionName, Database } from '../db/types.js'
import type { Logger } from '../logger.js'
import { callUpstream, type XrpcClient } from '../upstream/client.js'
import {
  invalid,
  normalizeVerificationGrantPayload,
  normalizeVerificationRevokePayload,
  type VerificationGrantPayload,
} from './action-payloads.js'
import {
  approvalRequired,
  executeWithApproval,
  type ApprovalContext,
  type ApprovalPayload,
} from './approvals.js'
import { bool, iso, list, rec, shape, str } from './values.js'

export type VerificationView = com.selfcommand.admin.defs.VerificationView
export type VerificationActResult = com.selfcommand.admin.verification.act.$OutputBody
export type VerificationFailure = {
  subject?: string
  uri?: string
  message: string
}

export type VerificationDeps = {
  ozone: XrpcClient
  logger: Logger
}

export type VerificationWriteContext = VerificationDeps & {
  db: Kysely<Database>
  actor: string
  meta: RequestMeta
  ttlHours: number
}

export type VerificationAction =
  | { action: 'grant'; verifications: VerificationGrantPayload['verifications'] }
  | { action: 'revoke'; uris: string[]; reason?: string }

export type VerificationRunContext = VerificationDeps & {
  db: AuditExecutor
  actor: string
  meta: RequestMeta
  approvalId?: string
}

const OZONE = {
  list: 'tools.ozone.verification.listVerifications',
  grant: 'tools.ozone.verification.grantVerifications',
  revoke: 'tools.ozone.verification.revokeVerifications',
} as const

export function normalizeVerificationView(raw: unknown): VerificationView {
  const item = rec(raw)
  const uri = str(item?.uri)
  const issuer = str(item?.issuer)
  const subject = str(item?.subject)
  const createdAt = iso(item?.createdAt)
  if (
    !item ||
    !uri ||
    !uri.startsWith('at://') ||
    !issuer ||
    !isDidString(issuer) ||
    !subject ||
    !isDidString(subject) ||
    !createdAt
  ) {
    throw shape('认证记录')
  }
  const revokeReason = str(item.revokeReason, 500)
  const revokedAt = iso(item.revokedAt)
  const isActive = bool(item.isActive) ?? !(revokeReason || revokedAt)
  const handle = str(item.handle, 256)
  const displayName = str(item.displayName, 200)
  return {
    uri: uri as VerificationView['uri'],
    issuer: issuer as VerificationView['issuer'],
    subject: subject as VerificationView['subject'],
    ...(handle ? { handle } : {}),
    ...(displayName ? { displayName } : {}),
    createdAt: createdAt as VerificationView['createdAt'],
    isActive,
    ...(revokeReason ? { revokeReason } : {}),
  }
}

export async function listVerifications(
  deps: VerificationDeps,
  params: {
    subject?: string
    isRevoked?: boolean
    createdAfter?: string
    createdBefore?: string
    sortDirection?: string
    limit: number
    cursor?: string
  },
): Promise<{ verifications: VerificationView[]; cursor?: string }> {
  if (params.subject !== undefined && !isDidString(params.subject)) {
    throw invalid('账号标识格式不正确')
  }
  const result = await callUpstream<{
    verifications?: unknown[]
    cursor?: string
  }>(deps.ozone, OZONE.list, {
    params: {
      cursor: params.cursor,
      limit: params.limit,
      createdAfter: params.createdAfter,
      createdBefore: params.createdBefore,
      subjects: params.subject ? [params.subject] : undefined,
      sortDirection: params.sortDirection ?? 'desc',
      isRevoked: params.isRevoked,
    },
  })
  return {
    verifications: list(result.verifications).map(normalizeVerificationView),
    ...(typeof result.cursor === 'string' ? { cursor: result.cursor } : {}),
  }
}

function normalizeAction(
  raw: com.selfcommand.admin.verification.act.$InputBody,
): VerificationAction {
  if (raw.action === 'grant') {
    if (raw.uris !== undefined) throw invalid('发放认证不能携带认证记录地址')
    const payload = normalizeVerificationGrantPayload({
      verifications: raw.verifications,
    })
    return { action: 'grant', verifications: payload.verifications }
  }
  if (raw.action === 'revoke') {
    if (raw.verifications !== undefined) {
      throw invalid('撤销认证只需提供认证记录地址')
    }
    const payload = normalizeVerificationRevokePayload({
      uris: raw.uris,
      ...(raw.reason !== undefined ? { reason: raw.reason } : {}),
    })
    return {
      action: 'revoke',
      uris: payload.uris,
      ...(payload.reason ? { reason: payload.reason } : {}),
    }
  }
  throw invalid('认证操作不是受支持的动作')
}

function auditTarget(action: VerificationAction): string {
  if (action.action === 'grant') {
    const first = action.verifications.length === 1 ? action.verifications[0] : undefined
    return first ? first.subject : `batch:${action.verifications.length}`
  }
  const first = action.uris.length === 1 ? action.uris[0] : undefined
  return first ?? `batch:${action.uris.length}`
}

function auditDetail(
  action: VerificationAction,
  verified: number,
  revoked: number,
  failed: number,
): string {
  if (action.action === 'grant') {
    return `发放认证：成功 ${verified} 个，失败 ${failed} 个`
  }
  return `撤销认证：成功 ${revoked} 个，失败 ${failed} 个`
}

export async function runVerificationAction(
  ctx: VerificationRunContext,
  action: VerificationAction,
  options: { requireAll?: boolean } = {},
): Promise<VerificationActResult> {
  let verified: VerificationView[] = []
  let revoked: string[] = []
  let failed: VerificationFailure[] = []

  try {
    if (action.action === 'grant') {
      const result = await callUpstream<{
        verifications?: unknown[]
        failedVerifications?: unknown[]
      }>(ctx.ozone, OZONE.grant, {
        method: 'POST',
        body: { verifications: action.verifications },
      })
      verified = list(result.verifications).map(normalizeVerificationView)
      failed = list(result.failedVerifications).map((entry) => {
        const item = rec(entry)
        const subject = str(item?.subject)
        return {
          ...(subject ? { subject } : {}),
          message: str(item?.error, 500) ?? '上游服务未返回失败原因。',
        }
      })
    } else {
      const result = await callUpstream<{
        revokedVerifications?: unknown[]
        failedRevocations?: unknown[]
      }>(ctx.ozone, OZONE.revoke, {
        method: 'POST',
        body: {
          uris: action.uris,
          ...(action.reason ? { revokeReason: action.reason } : {}),
        },
      })
      revoked = list(result.revokedVerifications)
        .map((entry) => str(entry))
        .filter((entry): entry is string => entry !== undefined)
      failed = list(result.failedRevocations).map((entry) => {
        const item = rec(entry)
        const uri = str(item?.uri)
        return {
          ...(uri ? { uri } : {}),
          message: str(item?.error, 500) ?? '上游服务未返回失败原因。',
        }
      })
    }
  } catch (error) {
    await writeAudit(ctx.db, ctx.logger, {
      actor: ctx.actor,
      action: 'com.selfcommand.admin.verification.act',
      targetType: 'verification',
      target: auditTarget(action),
      result: 'error',
      detail: `认证操作未完成（错误码：${auditErrorCode(error)}）`,
      ...(ctx.approvalId ? { approvalId: ctx.approvalId } : {}),
      ...ctx.meta,
    })
    throw error
  }

  await writeAudit(ctx.db, ctx.logger, {
    actor: ctx.actor,
    action: 'com.selfcommand.admin.verification.act',
    targetType: 'verification',
    target: auditTarget(action),
    result: failed.length ? 'error' : 'success',
    detail: auditDetail(action, verified.length, revoked.length, failed.length),
    ...(ctx.approvalId ? { approvalId: ctx.approvalId } : {}),
    ...ctx.meta,
  })

  if (options.requireAll && failed.length) {
    throw new LexServerError(502, {
      error: 'UpstreamUnavailable',
      message: `有 ${failed.length} 条认证未完成，请在认证列表中核对后重试。`,
    })
  }
  return {
    verified,
    revoked: revoked as VerificationActResult['revoked'],
    failed,
  }
}

function approvalContext(ctx: VerificationWriteContext): ApprovalContext {
  return {
    db: ctx.db,
    logger: ctx.logger,
    actor: ctx.actor,
    meta: ctx.meta,
    ttlHours: ctx.ttlHours,
  }
}

export async function actOnVerifications(
  ctx: VerificationWriteContext,
  input: com.selfcommand.admin.verification.act.$InputBody,
): Promise<VerificationActResult> {
  const action = normalizeAction(input)
  const required: ApprovalActionName =
    action.action === 'grant' ? 'verification.grant' : 'verification.revoke'
  const payload: ApprovalPayload =
    action.action === 'grant'
      ? { verifications: action.verifications }
      : { uris: action.uris, ...(action.reason ? { reason: action.reason } : {}) }
  const approvalId = str(input.approvalId, 64)

  if (approvalId) {
    let result: VerificationActResult | undefined
    await executeWithApproval(approvalContext(ctx), {
      id: approvalId,
      action: required,
      payload,
      run: async (trx) => {
        result = await runVerificationAction(
          { ...ctx, db: trx, approvalId },
          action,
          { requireAll: true },
        )
      },
    })
    if (!result) throw invalid('审批执行未返回认证结果')
    return result
  }

  if (!(await isSoleAdmin(ctx.db))) throw approvalRequired(required)
  return runVerificationAction(ctx, action)
}
