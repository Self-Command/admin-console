import {
  LexServerAuthError,
  LexServerError,
  type LexRouterAuth,
  type LexRouterAuthContext,
  type ServiceAuthCredentials,
} from '@atproto/lex-server'
import type { Kysely } from 'kysely'
import { insertAuditSafely, requestMeta, type RequestMeta } from '../audit.js'
import { isIpAllowed, normalizeIp } from '../client-ip.js'
import type { Config } from '../config.js'
import type { Database, RoleName } from '../db/types.js'
import type { Logger } from '../logger.js'
import { blockedError, findAccessBlock, recordAccess } from '../services/security.js'
import { loadRole, roleAllows, type Permission } from './roles.js'
import {
  requireLxm,
  resolveRejectedTokenDid,
  type DidResolver,
} from './service-auth.js'

export type Caller = { did: string; role: RoleName } & RequestMeta
export type CallerIdentity = { did: string; role: RoleName | null } & RequestMeta

const PERMISSION_LABELS: Record<Permission, string> = {
  'directory.read': '查看账号目录',
  'content.read': '查看内容',
  'content.write': '处置内容',
  'moderation.read': '查看审核信息',
  'moderation.write': '执行审核处置',
  'moderation.queue.manage': '管理举报队列',
  'verification.read': '查看认证',
  'verification.write': '管理认证',
  'notification.read': '查看通知模板',
  'notification.write': '管理通知与发送',
  'policy.read': '查看审核策略',
  'policy.write': '修改审核策略',
  'account.write': '管理账号运营记录',
  'account.admin': '管理账号账号信息',
  'analytics.read': '查看审核分析',
  'role.read': '查看角色',
  'role.write': '管理角色',
  'audit.read': '查看审计日志',
  'settings.read': '查看系统设置',
  'settings.write': '修改系统设置',
  'security.read': '查看后台安全',
  'security.write': '管理后台安全',
  'chat.read': '查看聊天审核',
  'announcement.read': '查看站内公告',
  'announcement.write': '创建与编辑公告草稿',
  'announcement.publish': '发布与下线公告',
}

export type GuardDeps = {
  db: Kysely<Database>
  logger: Logger
  config: Config
  verifier: LexRouterAuth<ServiceAuthCredentials>
  didResolver: DidResolver
}

function readTarget(
  ctx: LexRouterAuthContext,
): { targetType?: string; target?: string } {
  const nsid = ctx.method.nsid
  if (nsid.startsWith('com.selfcommand.admin.role.')) {
    // Mutation targets live in the request body, which the router only parses
    // after authentication, so those denials are recorded without a target.
    const params = ctx.params as { subject?: unknown } | undefined
    return typeof params?.subject === 'string'
      ? { targetType: 'role', target: params.subject }
      : { targetType: 'role' }
  }
  if (nsid === 'com.selfcommand.admin.account.get') {
    const params = ctx.params as { did?: unknown } | undefined
    return typeof params?.did === 'string'
      ? { targetType: 'account', target: params.did }
      : { targetType: 'account' }
  }
  if (nsid === 'com.selfcommand.admin.moderation.report.get') {
    const params = ctx.params as { id?: unknown } | undefined
    return typeof params?.id === 'number'
      ? { targetType: 'report', target: String(params.id) }
      : { targetType: 'report' }
  }
  if (nsid === 'com.selfcommand.admin.moderation.event.get') {
    const params = ctx.params as { id?: unknown } | undefined
    return typeof params?.id === 'number'
      ? { targetType: 'event', target: String(params.id) }
      : { targetType: 'event' }
  }
  if (nsid === 'com.selfcommand.admin.moderation.account.overview') {
    const params = ctx.params as { did?: unknown } | undefined
    return typeof params?.did === 'string'
      ? { targetType: 'account', target: params.did }
      : { targetType: 'account' }
  }
  if (nsid.startsWith('com.selfcommand.admin.content.')) {
    const params = ctx.params as { uri?: unknown } | undefined
    return typeof params?.uri === 'string'
      ? { targetType: 'content', target: params.uri }
      : { targetType: 'content' }
  }
  if (nsid.startsWith('com.selfcommand.admin.moderation.')) {
    return { targetType: 'moderation', target: nsid.slice('com.selfcommand.admin.moderation.'.length) }
  }
  if (nsid.startsWith('com.selfcommand.admin.verification.')) {
    return { targetType: 'verification', target: '认证' }
  }
  if (nsid.startsWith('com.selfcommand.admin.notifications.')) {
    return { targetType: 'notification', target: '通知' }
  }
  if (nsid.startsWith('com.selfcommand.admin.policy.')) {
    return { targetType: 'policy', target: nsid.slice('com.selfcommand.admin.policy.'.length) }
  }
  if (nsid.startsWith('com.selfcommand.admin.account.admin.')) {
    const params = ctx.params as { did?: unknown } | undefined
    return typeof params?.did === 'string'
      ? { targetType: 'account', target: params.did }
      : { targetType: 'account' }
  }
  if (nsid.startsWith('com.selfcommand.admin.settings.')) {
    return { targetType: 'settings', target: nsid.slice('com.selfcommand.admin.settings.'.length) }
  }
  if (nsid.startsWith('com.selfcommand.admin.indexer.')) {
    return { targetType: 'indexer', target: '账号目录' }
  }
  return {}
}

async function recordRejectedToken(
  deps: GuardDeps,
  ctx: LexRouterAuthContext,
  error: unknown,
): Promise<void> {
  if (!(error instanceof LexServerAuthError)) return
  const did = await resolveRejectedTokenDid(deps.config, ctx.request, deps.didResolver)
  if (!did) {
    deps.logger.warn('rejected service token without verified identity', {
      method: ctx.method.nsid,
      code: error.body.error,
    })
    return
  }
  await insertAuditSafely(deps.db, deps.logger, {
    actor: did,
    action: ctx.method.nsid,
    result: 'denied',
    detail: `服务令牌校验未通过（错误码：${error.body.error}）`,
    ...readTarget(ctx),
    ...requestMeta(ctx.request),
  })
}

async function recordCallerAccess(
  deps: GuardDeps,
  ctx: LexRouterAuthContext,
  did: string,
): Promise<void> {
  const meta = requestMeta(ctx.request)
  try {
    await recordAccess(deps.db, { did, ip: meta.actorIp, userAgent: meta.userAgent })
  } catch (error) {
    deps.logger.warn('access record failed', { method: ctx.method.nsid, error })
  }
}

async function enforceAllowList(
  deps: GuardDeps,
  ctx: LexRouterAuthContext,
  did: string,
): Promise<void> {
  const rules = deps.config.allowedIps
  if (rules.length === 0) return
  const meta = requestMeta(ctx.request)
  if (meta.actorIp && isIpAllowed(normalizeIp(meta.actorIp), rules)) return

  deps.logger.warn('request rejected by address allow list', {
    method: ctx.method.nsid,
    actor: did,
  })
  await insertAuditSafely(deps.db, deps.logger, {
    actor: did,
    action: ctx.method.nsid,
    result: 'denied',
    detail: '来源地址不在后台访问白名单内',
    requestId: meta.requestId,
    userAgent: meta.userAgent,
    ...readTarget(ctx),
  })
  throw new LexServerError(403, {
    error: 'Forbidden',
    message: '来源地址不在后台访问白名单内，请联系管理员。',
  })
}

async function enforceAccessBlock(
  deps: GuardDeps,
  ctx: LexRouterAuthContext,
  did: string,
): Promise<void> {
  const block = await findAccessBlock(deps.db, did)
  if (!block) return
  await insertAuditSafely(deps.db, deps.logger, {
    actor: did,
    action: ctx.method.nsid,
    result: 'denied',
    detail: '后台访问已被封锁，请求被拒绝',
    ...readTarget(ctx),
    ...requestMeta(ctx.request),
  })
  throw blockedError(block)
}

async function verifyServiceCredentials(
  deps: GuardDeps,
  ctx: LexRouterAuthContext,
): Promise<ServiceAuthCredentials> {
  let credentials: ServiceAuthCredentials
  try {
    credentials = await deps.verifier(ctx)
  } catch (error) {
    await recordRejectedToken(deps, ctx, error)
    throw error
  }

  try {
    requireLxm(credentials, ctx.method.nsid)
  } catch (error) {
    await insertAuditSafely(deps.db, deps.logger, {
      actor: credentials.did,
      action: ctx.method.nsid,
      result: 'denied',
      detail: '服务令牌未声明所调用的方法',
      ...readTarget(ctx),
      ...requestMeta(ctx.request),
    })
    throw error
  }

  return credentials
}

/**
 * Builds the per-method auth handler: service JWT verification, then the role
 * binding is re-read from the database on every request so role changes apply
 * to the very next call.
 */
export function createGuard(
  permission: Permission | readonly Permission[],
  deps: GuardDeps,
  options?: { label?: string },
): LexRouterAuth<Caller> {
  const permissions: readonly Permission[] =
    typeof permission === 'string' ? [permission] : permission
  const labels =
    options?.label ?? permissions.map((item) => PERMISSION_LABELS[item]).join('或')
  return async (ctx) => {
    const credentials = await verifyServiceCredentials(deps, ctx)
    await recordCallerAccess(deps, ctx, credentials.did)
    await enforceAllowList(deps, ctx, credentials.did)
    await enforceAccessBlock(deps, ctx, credentials.did)

    const role = await loadRole(deps.db, credentials.did)
    if (!role || !permissions.some((item) => roleAllows(role, item))) {
      await insertAuditSafely(deps.db, deps.logger, {
        actor: credentials.did,
        action: ctx.method.nsid,
        result: 'denied',
        detail: role
          ? `当前角色未授予「${labels}」权限`
          : '账号未绑定任何后台角色',
        ...readTarget(ctx),
        ...requestMeta(ctx.request),
      })
      throw new LexServerError(403, {
        error: 'Forbidden',
        message: 'The caller is not allowed to perform this action',
      })
    }

    return { did: credentials.did, role, ...requestMeta(ctx.request) }
  }
}

/**
 * Session self-read: verifies the service JWT and method declaration but does
 * not require a role binding, so an account without one can learn its status.
 */
export function createIdentityGuard(deps: GuardDeps): LexRouterAuth<CallerIdentity> {
  return async (ctx) => {
    const credentials = await verifyServiceCredentials(deps, ctx)
    await recordCallerAccess(deps, ctx, credentials.did)
    await enforceAllowList(deps, ctx, credentials.did)
    return {
      did: credentials.did,
      role: await loadRole(deps.db, credentials.did),
      ...requestMeta(ctx.request),
    }
  }
}
