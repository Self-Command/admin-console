import type { com } from '@admin/lexicons'
import { LexServerError } from '@atproto/lex-server'
import type { Kysely } from 'kysely'
import { insertAuditSafely, type RequestMeta } from '../audit.js'
import { isSoleAdmin, isValidDid, loadRole, parseRole } from '../auth/roles.js'
import type { ApprovalActionName, Database } from '../db/types.js'
import type { Logger } from '../logger.js'
import { resetSettings, type SettingsContext } from '../settings/service.js'
import {
  approvalRequired,
  executeWithApproval,
  normalizeApprovalPayload,
  type ApprovalContext,
  type ApprovalPayload,
} from './approvals.js'
import { importRoles, revokeRole, updateRole, type RoleMutationContext } from './roles.js'

export type GuardedActionContext = {
  db: Kysely<Database>
  logger: Logger
  actor: string
  meta: RequestMeta
  ttlHours: number
}

function approvals(ctx: GuardedActionContext): ApprovalContext {
  return {
    db: ctx.db,
    logger: ctx.logger,
    actor: ctx.actor,
    meta: ctx.meta,
    ttlHours: ctx.ttlHours,
  }
}

function roles(ctx: GuardedActionContext): RoleMutationContext {
  return { db: ctx.db, logger: ctx.logger, actor: ctx.actor, meta: ctx.meta }
}

function settings(ctx: GuardedActionContext): SettingsContext {
  return { db: ctx.db, logger: ctx.logger, actor: ctx.actor, meta: ctx.meta }
}

function invalid(message: string): LexServerError {
  return new LexServerError(400, { error: 'InvalidRequest', message })
}

function lastAdmin(): LexServerError {
  return new LexServerError(409, {
    error: 'LastAdmin',
    message: '工作区必须保留至少一位管理员',
  })
}

// The last-admin rule is enforced before the role service runs, so the denial
// has to be audited here; otherwise a blocked demotion leaves no trail.
async function rejectLastAdmin(
  ctx: GuardedActionContext,
  action: string,
  target: string,
): Promise<never> {
  await insertAuditSafely(ctx.db, ctx.logger, {
    actor: ctx.actor,
    action,
    targetType: 'role',
    target,
    result: 'error',
    detail: '操作未完成（错误码：LastAdmin）',
    ...ctx.meta,
  })
  throw lastAdmin()
}

function requirePayload(
  action: ApprovalActionName,
  value: unknown,
): ApprovalPayload {
  return normalizeApprovalPayload(action, value)
}

export type RevokeRoleInput = { subject: string; approvalId?: string }

export async function revokeRoleGuarded(
  ctx: GuardedActionContext,
  input: RevokeRoleInput,
): Promise<void> {
  if (!isValidDid(input.subject)) throw invalid('subject must be a DID')
  const existing = await loadRole(ctx.db, input.subject)
  const highRisk = existing === 'admin'

  if (input.approvalId) {
    if (!highRisk) throw invalid('该审批动作只用于撤销管理员角色')
    if (await isSoleAdmin(ctx.db)) {
      return rejectLastAdmin(ctx, 'com.selfcommand.admin.role.revoke', input.subject)
    }
    const payload = requirePayload('role.revoke', { subject: input.subject })
    await executeWithApproval(approvals(ctx), {
      id: input.approvalId,
      action: 'role.revoke',
      payload,
      run: async (trx) => {
        await revokeRole(
          { ...roles(ctx), trx, approvalId: input.approvalId },
          { subject: input.subject },
        )
      },
    })
    return
  }

  if (!highRisk) {
    await revokeRole(roles(ctx), { subject: input.subject })
    return
  }
  if (await isSoleAdmin(ctx.db)) {
    return rejectLastAdmin(ctx, 'com.selfcommand.admin.role.revoke', input.subject)
  }
  throw approvalRequired('role.revoke')
}

export type UpdateRoleGuardedInput = {
  subject: string
  role: string
  note?: string
  approvalId?: string
}

export async function updateRoleGuarded(
  ctx: GuardedActionContext,
  input: UpdateRoleGuardedInput,
): Promise<Awaited<ReturnType<typeof updateRole>>> {
  if (!isValidDid(input.subject)) throw invalid('subject must be a DID')
  const role = parseRole(input.role)
  if (!role) throw invalid('role must be admin, operator or viewer')
  const existing = await loadRole(ctx.db, input.subject)
  const demotion = existing === 'admin' && role !== 'admin'

  if (input.approvalId) {
    if (!demotion) throw invalid('该审批动作只用于降级管理员角色')
    if (await isSoleAdmin(ctx.db)) {
      return rejectLastAdmin(ctx, 'com.selfcommand.admin.role.update', input.subject)
    }
    const payload = requirePayload('role.demote', {
      subject: input.subject,
      role,
      ...(input.note !== undefined ? { note: input.note } : {}),
    })
    let result: Awaited<ReturnType<typeof updateRole>> | undefined
    await executeWithApproval(approvals(ctx), {
      id: input.approvalId,
      action: 'role.demote',
      payload,
      run: async (trx) => {
        result = await updateRole(
          { ...roles(ctx), trx, approvalId: input.approvalId },
          { subject: input.subject, role, ...(payload.note ? { note: String(payload.note) } : {}) },
        )
      },
    })
    if (!result) throw invalid('审批执行未返回角色信息')
    return result
  }

  if (!demotion) {
    return updateRole(roles(ctx), input)
  }
  if (await isSoleAdmin(ctx.db)) {
    return rejectLastAdmin(ctx, 'com.selfcommand.admin.role.update', input.subject)
  }
  throw approvalRequired('role.demote')
}

export type ImportRolesGuardedInput = {
  bindings: com.selfcommand.admin.defs.RoleImportItem[]
  batchId?: string
  approvalId?: string
}

export async function importRolesGuarded(
  ctx: GuardedActionContext,
  input: ImportRolesGuardedInput,
): Promise<Awaited<ReturnType<typeof importRoles>>> {
  if (input.approvalId) {
    const payload = requirePayload('role.import', {
      bindings: input.bindings,
      ...(input.batchId ? { batchId: input.batchId } : {}),
    })
    let result: Awaited<ReturnType<typeof importRoles>> | undefined
    await executeWithApproval(approvals(ctx), {
      id: input.approvalId,
      action: 'role.import',
      payload,
      run: async (trx) => {
        result = await importRoles(
          { ...roles(ctx), trx, approvalId: input.approvalId },
          {
            bindings: payload.bindings as com.selfcommand.admin.defs.RoleImportItem[],
            ...(typeof payload.batchId === 'string' ? { batchId: payload.batchId } : {}),
          },
        )
      },
    })
    if (!result) throw invalid('审批执行未返回导入结果')
    return result
  }

  if (await isSoleAdmin(ctx.db)) {
    return importRoles(roles(ctx), input)
  }
  throw approvalRequired('role.import')
}

export type ResetSettingsGuardedInput = {
  section?: string
  reason?: string
  approvalId?: string
}

export async function resetSettingsGuarded(
  ctx: GuardedActionContext,
  input: ResetSettingsGuardedInput,
): Promise<Awaited<ReturnType<typeof resetSettings>>> {
  if (input.section !== undefined) {
    return resetSettings(settings(ctx), {
      section: input.section as Parameters<typeof resetSettings>[1]['section'],
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
    })
  }

  if (input.approvalId) {
    const payload = requirePayload('settings.resetAll', {
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
    })
    let result: Awaited<ReturnType<typeof resetSettings>> | undefined
    await executeWithApproval(approvals(ctx), {
      id: input.approvalId,
      action: 'settings.resetAll',
      payload,
      run: async (trx) => {
        result = await resetSettings(
          { ...settings(ctx), trx, approvalId: input.approvalId },
          { ...(payload.reason ? { reason: String(payload.reason) } : {}) },
        )
      },
    })
    if (!result) throw invalid('审批执行未返回设置结果')
    return result
  }

  if (await isSoleAdmin(ctx.db)) {
    return resetSettings(settings(ctx), {
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
    })
  }
  throw approvalRequired('settings.resetAll')
}