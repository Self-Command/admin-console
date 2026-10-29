import {
  LexServerAuthError,
  LexServerError,
  type LexRouterAuth,
  type LexRouterAuthContext,
  type ServiceAuthCredentials,
} from '@atproto/lex-server'
import type { Kysely } from 'kysely'
import { insertAuditSafely } from '../audit.js'
import type { Config } from '../config.js'
import type { Database, RoleName } from '../db/types.js'
import type { Logger } from '../logger.js'
import { loadRole, roleAllows, type Permission } from './roles.js'
import {
  requireLxm,
  resolveRejectedTokenDid,
  type DidResolver,
} from './service-auth.js'

export type Caller = { did: string; role: RoleName }
export type CallerIdentity = { did: string; role: RoleName | null }

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
    detail: `service token rejected: ${error.body.error}`,
    ...readTarget(ctx),
  })
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
      detail: 'service token did not declare the invoked method',
      ...readTarget(ctx),
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
  permission: Permission,
  deps: GuardDeps,
): LexRouterAuth<Caller> {
  return async (ctx) => {
    const credentials = await verifyServiceCredentials(deps, ctx)

    const role = await loadRole(deps.db, credentials.did)
    if (!role || !roleAllows(role, permission)) {
      await insertAuditSafely(deps.db, deps.logger, {
        actor: credentials.did,
        action: ctx.method.nsid,
        result: 'denied',
        detail: role
          ? `role ${role} does not grant ${permission}`
          : 'caller holds no role binding',
        ...readTarget(ctx),
      })
      throw new LexServerError(403, {
        error: 'Forbidden',
        message: 'The caller is not allowed to perform this action',
      })
    }

    return { did: credentials.did, role }
  }
}

/**
 * Session self-read: verifies the service JWT and method declaration but does
 * not require a role binding, so an account without one can learn its status.
 */
export function createIdentityGuard(deps: GuardDeps): LexRouterAuth<CallerIdentity> {
  return async (ctx) => {
    const credentials = await verifyServiceCredentials(deps, ctx)
    return { did: credentials.did, role: await loadRole(deps.db, credentials.did) }
  }
}
