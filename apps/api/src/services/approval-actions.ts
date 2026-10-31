import type { com } from '@admin/lexicons'
import { LexServerError } from '@atproto/lex-server'
import type { Kysely, Transaction } from 'kysely'
import type { RequestMeta } from '../audit.js'
import type { ApprovalActionName, Database } from '../db/types.js'
import type { Logger } from '../logger.js'
import { resetSettings } from '../settings/service.js'
import { notConfigured, type XrpcClient } from '../upstream/client.js'
import {
  normalizeAccountDeletePayload,
  normalizeModerationActPayload,
  normalizeNotificationSendPayload,
  normalizePolicyWritePayload,
  normalizeStoredAccountUpdatePayload,
  normalizeVerificationGrantPayload,
  normalizeVerificationRevokePayload,
} from './action-payloads.js'
import {
  deleteAccountAdmin,
  updateAccountAdmin,
  type PasswordSealer,
} from './account-admin.js'
import {
  applyAnnouncementArchive,
  applyAnnouncementPublish,
} from './announcements.js'
import type { ApprovalPayload } from './approvals.js'
import { emitModerationEvents } from './moderation.js'
import { deliverNotification } from './notifications.js'
import { runPolicyWrite } from './policy.js'
import { importRoles, revokeRole, updateRole } from './roles.js'
import { runVerificationAction } from './verification.js'

export type ApprovalExecutionState = {
  db: Kysely<Database>
  logger: Logger
  actor: string
  meta: RequestMeta
  approvalId: string
  ozone: XrpcClient
  appview: XrpcClient
  pds: XrpcClient
  senderDid: string
  sealer?: PasswordSealer
}

export type RoleBindingInput = com.selfcommand.admin.defs.RoleImportItem

export async function executeApprovedAction(
  trx: Transaction<Database>,
  action: ApprovalActionName,
  payload: ApprovalPayload,
  ctx: ApprovalExecutionState,
): Promise<void> {
  const base = { ...ctx, trx }

  if (action === 'role.revoke') {
    await revokeRole(base, { subject: String(payload.subject) })
    return
  }
  if (action === 'role.demote') {
    await updateRole(base, {
      subject: String(payload.subject),
      role: String(payload.role),
      ...(typeof payload.note === 'string' ? { note: payload.note } : {}),
    })
    return
  }
  if (action === 'role.import') {
    await importRoles(base, {
      bindings: payload.bindings as RoleBindingInput[],
      ...(typeof payload.batchId === 'string' ? { batchId: payload.batchId } : {}),
    })
    return
  }
  if (action === 'settings.resetAll') {
    await resetSettings(base, {
      ...(typeof payload.reason === 'string' ? { reason: payload.reason } : {}),
    })
    return
  }
  if (action === 'moderation.takedown' || action === 'moderation.batch') {
    const normalized = normalizeModerationActPayload(payload)
    await emitModerationEvents(
      {
        ozone: ctx.ozone,
        logger: ctx.logger,
        db: trx,
        actor: ctx.actor,
        meta: ctx.meta,
      },
      normalized,
      { approvalId: ctx.approvalId, requireAll: true },
    )
    return
  }
  if (action === 'moderation.label') {
    const normalized = normalizeModerationActPayload(payload)
    if (normalized.action !== 'label') {
      throw new LexServerError(400, {
        error: 'InvalidRequest',
        message: '审批载荷与内容标签动作不匹配。',
      })
    }
    await emitModerationEvents(
      {
        ozone: ctx.ozone,
        logger: ctx.logger,
        db: trx,
        actor: ctx.actor,
        meta: ctx.meta,
      },
      normalized,
      { approvalId: ctx.approvalId, requireAll: true },
    )
    return
  }
  if (action === 'verification.grant') {
    const normalized = normalizeVerificationGrantPayload(payload)
    await runVerificationAction(
      {
        ozone: ctx.ozone,
        logger: ctx.logger,
        db: trx,
        actor: ctx.actor,
        meta: ctx.meta,
        approvalId: ctx.approvalId,
      },
      { action: 'grant', verifications: normalized.verifications },
      { requireAll: true },
    )
    return
  }
  if (action === 'verification.revoke') {
    const normalized = normalizeVerificationRevokePayload(payload)
    await runVerificationAction(
      {
        ozone: ctx.ozone,
        logger: ctx.logger,
        db: trx,
        actor: ctx.actor,
        meta: ctx.meta,
        approvalId: ctx.approvalId,
      },
      {
        action: 'revoke',
        uris: normalized.uris,
        ...(normalized.reason ? { reason: normalized.reason } : {}),
      },
      { requireAll: true },
    )
    return
  }
  if (action === 'notifications.send') {
    const normalized = normalizeNotificationSendPayload(payload)
    await deliverNotification(
      {
        pds: ctx.pds,
        logger: ctx.logger,
        senderDid: ctx.senderDid,
        db: trx,
        actor: ctx.actor,
        meta: ctx.meta,
        approvalId: ctx.approvalId,
      },
      normalized,
      { requireAll: true },
    )
    return
  }
  if (action === 'account.admin.update') {
    const stored = normalizeStoredAccountUpdatePayload(payload)
    let password: string | undefined
    if (stored.passwordSealed) {
      if (!ctx.sealer) throw notConfigured('PDS')
      password = ctx.sealer.open(stored.did, stored.passwordSealed)
    }
    await updateAccountAdmin(
      {
        pds: ctx.pds,
        db: trx,
        logger: ctx.logger,
        actor: ctx.actor,
        meta: ctx.meta,
        approvalId: ctx.approvalId,
      },
      {
        did: stored.did,
        ...(stored.email ? { email: stored.email } : {}),
        ...(stored.handle ? { handle: stored.handle } : {}),
        ...(password ? { password } : {}),
      },
    )
    return
  }
  if (action === 'account.admin.delete') {
    await deleteAccountAdmin(
      {
        pds: ctx.pds,
        db: trx,
        logger: ctx.logger,
        actor: ctx.actor,
        meta: ctx.meta,
        approvalId: ctx.approvalId,
      },
      normalizeAccountDeletePayload(payload),
    )
    return
  }
  if (action === 'policy.write') {
    const normalized = normalizePolicyWritePayload(payload)
    await runPolicyWrite(
      {
        ozone: ctx.ozone,
        appview: ctx.appview,
        logger: ctx.logger,
        db: trx,
        actor: ctx.actor,
        meta: ctx.meta,
        approvalId: ctx.approvalId,
      },
      normalized,
    )
    return
  }

  if (action === 'announcement.publish' || action === 'announcement.archive') {
    const id = payload.announcementId
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) {
      throw new LexServerError(400, {
        error: 'InvalidRequest',
        message: '审批载荷缺少有效的公告编号。',
      })
    }
    const apply =
      action === 'announcement.publish'
        ? applyAnnouncementPublish
        : applyAnnouncementArchive
    await apply(
      trx,
      { actor: ctx.actor, meta: ctx.meta },
      id,
      ctx.approvalId,
    )
    return
  }

  throw new LexServerError(501, {
    error: 'NotImplemented',
    message: '该审批动作尚未开放，请联系系统管理员。',
  })
}
