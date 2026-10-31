import type { com } from '@admin/lexicons'
import { isDidString } from '@atproto/lex-schema'
import { LexServerError } from '@atproto/lex-server'
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import type { Kysely } from 'kysely'
import { auditErrorCode, writeAudit, type AuditExecutor, type RequestMeta } from '../audit.js'
import { isSoleAdmin } from '../auth/roles.js'
import type { ApprovalActionName, Database } from '../db/types.js'
import type { Logger } from '../logger.js'
import {
  callUpstream,
  notConfigured,
  type XrpcClient,
} from '../upstream/client.js'
import {
  invalid,
  normalizeAccountDeletePayload,
  normalizeAccountUpdatePayload,
  type AccountDeletePayload,
  type AccountUpdatePayload,
} from './action-payloads.js'
import { approvalRequired, type ApprovalPayload } from './approvals.js'
import { bool, iso, list, nonNegative, rec, shape, str, type RecordLike } from './values.js'

export type AccountAdminInfo = com.selfcommand.admin.defs.AccountAdminInfo
export type InviteCodeView = com.selfcommand.admin.defs.InviteCodeView

const PDS = {
  accountInfo: 'com.atproto.admin.getAccountInfo',
  updateEmail: 'com.atproto.admin.updateAccountEmail',
  updateHandle: 'com.atproto.admin.updateAccountHandle',
  updatePassword: 'com.atproto.admin.updateAccountPassword',
  deleteAccount: 'com.atproto.admin.deleteAccount',
  disableInvites: 'com.atproto.admin.disableInviteCodes',
  disableAccountInvites: 'com.atproto.admin.disableAccountInvites',
} as const

export type AccountAdminWriteContext = {
  db: Kysely<Database>
  logger: Logger
  actor: string
  meta: RequestMeta
  pds: XrpcClient
}

export type AccountAdminRunContext = {
  db: AuditExecutor
  logger: Logger
  actor: string
  meta: RequestMeta
  pds: XrpcClient
  approvalId?: string
}

function notFound(): LexServerError {
  return new LexServerError(404, {
    error: 'NotFound',
    message: '账号不存在或已被删除。',
  })
}

function inviteView(value: unknown): InviteCodeView | undefined {
  const item = rec(value)
  if (!item) return undefined
  const code = str(item.code, 64)
  if (!code) return undefined
  const createdBy = str(item.createdBy, 2048)
  const createdAt = iso(item.createdAt)
  return {
    code,
    available: nonNegative(item.available) ?? 0,
    disabled: bool(item.disabled) ?? false,
    ...(createdBy ? { createdBy: createdBy as InviteCodeView['createdBy'] } : {}),
    ...(createdAt ? { createdAt: createdAt as InviteCodeView['createdAt'] } : {}),
    usesCount: list(item.uses).length,
  }
}

export async function fetchAccountView(pds: XrpcClient, did: string): Promise<RecordLike> {
  if (!isDidString(did)) throw invalid('did 必须是账号标识')
  let raw: unknown
  try {
    raw = await callUpstream(pds, PDS.accountInfo, { params: { did } })
  } catch (error) {
    // The PDS answers 400 for an unknown account instead of 404.
    if (error instanceof LexServerError && error.status === 400) throw notFound()
    throw error
  }
  const view = rec(raw)
  if (!view) throw shape('账号信息')
  return view
}

export async function getAccountAdminInfo(
  pds: XrpcClient,
  did: string,
): Promise<AccountAdminInfo> {
  const view = await fetchAccountView(pds, did)
  const viewDid = str(view.did, 2048)
  if (!viewDid || !isDidString(viewDid)) throw shape('账号信息')
  const handle = str(view.handle, 256)
  const email = str(view.email, 320)
  const emailConfirmedAt = iso(view.emailConfirmedAt)
  const invites = list(view.invites)
    .map(inviteView)
    .filter((entry): entry is InviteCodeView => entry !== undefined)
    .slice(0, 100)
  const invitedBy = inviteView(view.invitedBy)
  const invitesDisabled = bool(view.invitesDisabled)
  const deactivatedAt = iso(view.deactivatedAt)
  const indexedAt = iso(view.indexedAt)
  const takedown = bool(view.takedown)
  return {
    did: viewDid as AccountAdminInfo['did'],
    ...(handle ? { handle } : {}),
    ...(email ? { email } : {}),
    ...(email ? { emailConfirmed: emailConfirmedAt !== undefined } : {}),
    ...(invitesDisabled !== undefined ? { invitesDisabled } : {}),
    ...(invitedBy ? { invitedBy } : {}),
    ...(invites.length > 0 ? { invites } : {}),
    ...(deactivatedAt
      ? { deactivatedAt: deactivatedAt as AccountAdminInfo['deactivatedAt'] }
      : {}),
    ...(indexedAt ? { indexedAt: indexedAt as AccountAdminInfo['indexedAt'] } : {}),
    ...(takedown !== undefined ? { takedown } : {}),
  }
}

async function requireUpstreamAccount(pds: XrpcClient, did: string): Promise<void> {
  await fetchAccountView(pds, did)
}

export async function updateAccountAdmin(
  ctx: AccountAdminRunContext,
  input: AccountUpdatePayload,
): Promise<void> {
  await requireUpstreamAccount(ctx.pds, input.did)
  const changed: string[] = []
  if (input.email) {
    await callUpstream(ctx.pds, PDS.updateEmail, {
      body: { account: input.did, email: input.email },
    })
    changed.push('邮箱')
  }
  if (input.handle) {
    await callUpstream(ctx.pds, PDS.updateHandle, {
      body: { did: input.did, handle: input.handle },
    })
    changed.push('账号名')
  }
  if (input.password) {
    await callUpstream(ctx.pds, PDS.updatePassword, {
      body: { did: input.did, password: input.password },
    })
    changed.push('密码')
  }
  if (changed.length === 0) throw invalid('没有需要变更的账号资料')
  await writeAudit(ctx.db, ctx.logger, {
    actor: ctx.actor,
    action: 'com.selfcommand.admin.account.admin.update',
    targetType: 'account',
    target: input.did,
    result: 'success',
    detail: `通过上游服务更新账号资料：${changed.join('、')}`,
    ...(ctx.approvalId ? { approvalId: ctx.approvalId } : {}),
    ...ctx.meta,
  })
}

export async function deleteAccountAdmin(
  ctx: AccountAdminRunContext,
  input: AccountDeletePayload,
): Promise<void> {
  await requireUpstreamAccount(ctx.pds, input.did)
  await callUpstream(ctx.pds, PDS.deleteAccount, { body: { did: input.did } })
  await writeAudit(ctx.db, ctx.logger, {
    actor: ctx.actor,
    action: 'com.selfcommand.admin.account.admin.delete',
    targetType: 'account',
    target: input.did,
    result: 'success',
    detail: '通过上游服务删除账号',
    ...(ctx.approvalId ? { approvalId: ctx.approvalId } : {}),
    ...ctx.meta,
  })
}

export type DisableInvitesInput = { did?: string; codes?: string[] }

export function normalizeDisableInvitesInput(raw: unknown): DisableInvitesInput {
  const input = rec(raw)
  if (!input) throw invalid('请求内容必须是对象')
  for (const key of Object.keys(input)) {
    if (key !== 'did' && key !== 'codes') throw invalid(`请求内容包含未知字段：${key}`)
  }
  if (input.did !== undefined && (typeof input.did !== 'string' || !isDidString(input.did))) {
    throw invalid('did 必须是账号标识')
  }
  let codes: string[] | undefined
  if (input.codes !== undefined) {
    if (!Array.isArray(input.codes) || input.codes.length === 0 || input.codes.length > 1000) {
      throw invalid('codes 必须包含 1 到 1000 个邀请码')
    }
    codes = [...new Set(input.codes.map((entry, index) => {
      if (typeof entry !== 'string') throw invalid(`codes[${index}] 必须是文本`)
      const code = entry.trim()
      if (!code || code.length > 64) throw invalid(`codes[${index}] 不是有效的邀请码`)
      return code
    }))]
  }
  if (!input.did && !codes) throw invalid('请提供账号标识或邀请码')
  return {
    ...(typeof input.did === 'string' ? { did: input.did } : {}),
    ...(codes ? { codes } : {}),
  }
}

export async function disableAccountInvites(
  ctx: AccountAdminWriteContext,
  raw: unknown,
): Promise<void> {
  const input = normalizeDisableInvitesInput(raw)
  if (input.did) {
    await requireUpstreamAccount(ctx.pds, input.did)
    // disableInviteCodes 只作废已有邀请码，不会设置账号级停用标记；两者需同时调用。
    await callUpstream(ctx.pds, PDS.disableAccountInvites, {
      body: { account: input.did },
    })
  }
  await callUpstream(ctx.pds, PDS.disableInvites, {
    body: {
      ...(input.did ? { accounts: [input.did] } : {}),
      ...(input.codes ? { codes: input.codes } : {}),
    },
  })
  await writeAudit(ctx.db, ctx.logger, {
    actor: ctx.actor,
    action: 'com.selfcommand.admin.account.invites.disable',
    targetType: 'account',
    target: input.did ?? 'invite-codes',
    result: 'success',
    detail: input.did
      ? '停用该账号创建的全部邀请码'
      : `停用 ${input.codes?.length ?? 0} 个指定邀请码`,
    ...ctx.meta,
  })
}

export async function updateAccountAdminGuarded(
  ctx: AccountAdminWriteContext,
  raw: unknown,
): Promise<void> {
  const payload = normalizeAccountUpdatePayload(raw)
  if (!(await isSoleAdmin(ctx.db))) throw approvalRequired('account.admin.update')
  try {
    await updateAccountAdmin(
      { pds: ctx.pds, db: ctx.db, logger: ctx.logger, actor: ctx.actor, meta: ctx.meta },
      payload,
    )
  } catch (error) {
    await writeAudit(ctx.db, ctx.logger, {
      actor: ctx.actor,
      action: 'com.selfcommand.admin.account.admin.update',
      targetType: 'account',
      target: payload.did,
      result: 'error',
      detail: `操作未完成（错误码：${auditErrorCode(error)}）`,
      ...ctx.meta,
    })
    throw error
  }
}

export async function deleteAccountAdminGuarded(
  ctx: AccountAdminWriteContext,
  raw: unknown,
): Promise<void> {
  const payload = normalizeAccountDeletePayload(raw)
  if (!(await isSoleAdmin(ctx.db))) throw approvalRequired('account.admin.delete')
  try {
    await deleteAccountAdmin(
      { pds: ctx.pds, db: ctx.db, logger: ctx.logger, actor: ctx.actor, meta: ctx.meta },
      payload,
    )
  } catch (error) {
    await writeAudit(ctx.db, ctx.logger, {
      actor: ctx.actor,
      action: 'com.selfcommand.admin.account.admin.delete',
      targetType: 'account',
      target: payload.did,
      result: 'error',
      detail: `操作未完成（错误码：${auditErrorCode(error)}）`,
      ...ctx.meta,
    })
    throw error
  }
}

export type PasswordSealer = {
  seal(did: string, password: string): string
  open(did: string, sealed: string): string
}

// A dedicated key is derived from the PDS administrator credential so the
// credential itself is never used directly as a cipher key and the approval
// payload can travel through the database without plaintext passwords.
export function createPasswordSealer(secret: string): PasswordSealer {
  const key = Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(secret, 'utf8'),
      Buffer.from('com.selfcommand.admin.approval-secrets', 'utf8'),
      Buffer.from('account.admin.password.v1', 'utf8'),
      32,
    ),
  )
  return {
    seal(did, password) {
      const nonce = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, nonce)
      cipher.setAAD(Buffer.from(did, 'utf8'))
      const sealed = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()])
      return [
        'v1',
        nonce.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
        sealed.toString('base64url'),
      ].join('.')
    },
    open(did, value) {
      const parts = value.split('.')
      if (parts.length !== 4 || parts[0] !== 'v1') {
        throw invalid('审批请求中的密码无法解密，请重新发起审批')
      }
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(parts[1] as string, 'base64url'),
      )
      decipher.setAAD(Buffer.from(did, 'utf8'))
      decipher.setAuthTag(Buffer.from(parts[2] as string, 'base64url'))
      try {
        const plain = Buffer.concat([
          decipher.update(Buffer.from(parts[3] as string, 'base64url')),
          decipher.final(),
        ])
        return plain.toString('utf8')
      } catch {
        throw invalid('审批请求中的密码无法解密，可能已更换上游凭据，请重新发起审批')
      }
    },
  }
}

export function createApprovalSeal(
  sealer: PasswordSealer | undefined,
): (action: ApprovalActionName, payload: ApprovalPayload) => ApprovalPayload {
  return (action, payload) => {
    if (action !== 'account.admin.update') return payload
    const password = payload.password
    if (typeof password !== 'string') return payload
    if (!sealer) throw notConfigured('PDS')
    const rest = { ...payload }
    delete rest.password
    return { ...rest, passwordSealed: sealer.seal(String(payload.did), password) }
  }
}
