import { com } from '@admin/lexicons'
import {
  LexRouter,
  type LexRouterAuth,
  type ServiceAuthCredentials,
} from '@atproto/lex-server'
import type { Kysely } from 'kysely'
import { createGuard, createIdentityGuard, type Caller, type GuardDeps } from './auth/guard.js'
import { sessionView } from './auth/roles.js'
import type { Config } from './config.js'
import type { Database } from './db/types.js'
import type { DirectoryIndexer } from './directory/indexer.js'
import type { DirectoryStore } from './directory/store.js'
import type { Logger } from './logger.js'
import { getAccount, listAccounts } from './services/accounts.js'
import { listAuditEvents } from './services/audit.js'
import {
  createRole,
  getRole,
  listRoles,
  revokeRole,
  updateRole,
  type RoleMutationContext,
} from './services/roles.js'

export type RouterDeps = {
  config: Config
  logger: Logger
  db: Kysely<Database>
  store: DirectoryStore
  indexer: DirectoryIndexer
  verifier: LexRouterAuth<ServiceAuthCredentials>
  didResolver: GuardDeps['didResolver']
}

export function createRouter(deps: RouterDeps): LexRouter {
  const guardDeps: GuardDeps = {
    db: deps.db,
    logger: deps.logger,
    config: deps.config,
    verifier: deps.verifier,
    didResolver: deps.didResolver,
  }
  const mutationContext = (caller: Caller): RoleMutationContext => ({
    db: deps.db,
    logger: deps.logger,
    actor: caller.did,
  })

  const router = new LexRouter({
    onHandlerError: ({ error, method }) => {
      deps.logger.error('xrpc handler error', {
        method: method.nsid,
        error,
        status: error.status,
        code: error.body.error,
      })
    },
  })

  router.add(com.selfcommand.admin.session.get.main, {
    auth: createIdentityGuard(guardDeps),
    handler: async (ctx) => ({
      body: sessionView(ctx.credentials.did, ctx.credentials.role),
    }),
  })

  router.add(com.selfcommand.admin.role.list.main, {
    auth: createGuard('role.read', guardDeps),
    handler: async (ctx) => ({
      body: await listRoles(deps.db, {
        cursor: ctx.params.cursor,
        limit: ctx.params.limit ?? 50,
        role: ctx.params.role,
        search: ctx.params.search,
      }),
    }),
  })

  router.add(com.selfcommand.admin.role.get.main, {
    auth: createGuard('role.read', guardDeps),
    handler: async (ctx) => ({
      body: { role: await getRole(deps.db, ctx.params.subject) },
    }),
  })

  router.add(com.selfcommand.admin.role.create.main, {
    auth: createGuard('role.write', guardDeps),
    handler: async (ctx) => ({
      body: {
        role: await createRole(mutationContext(ctx.credentials), ctx.input.body),
      },
    }),
  })

  router.add(com.selfcommand.admin.role.update.main, {
    auth: createGuard('role.write', guardDeps),
    handler: async (ctx) => ({
      body: {
        role: await updateRole(mutationContext(ctx.credentials), ctx.input.body),
      },
    }),
  })

  router.add(com.selfcommand.admin.role.revoke.main, {
    auth: createGuard('role.write', guardDeps),
    handler: async (ctx) => {
      await revokeRole(mutationContext(ctx.credentials), ctx.input.body)
      return {}
    },
  })

  router.add(com.selfcommand.admin.audit.list.main, {
    auth: createGuard('audit.read', guardDeps),
    handler: async (ctx) => ({
      body: await listAuditEvents(deps.db, {
        cursor: ctx.params.cursor,
        limit: ctx.params.limit ?? 50,
        actor: ctx.params.actor,
        action: ctx.params.action,
        result: ctx.params.result,
        since: ctx.params.since,
        until: ctx.params.until,
      }),
    }),
  })

  router.add(com.selfcommand.admin.account.list.main, {
    auth: createGuard('directory.read', guardDeps),
    handler: async (ctx) => ({
      body: await listAccounts(
        deps.store,
        {
          cursor: ctx.params.cursor,
          limit: ctx.params.limit ?? 50,
          search: ctx.params.search,
          status: ctx.params.status,
        },
        deps.indexer.snapshot(),
      ),
    }),
  })

  router.add(com.selfcommand.admin.account.get.main, {
    auth: createGuard('directory.read', guardDeps),
    handler: async (ctx) => ({
      body: await getAccount(deps.store, ctx.params.did, deps.indexer.snapshot()),
    }),
  })

  return router
}
