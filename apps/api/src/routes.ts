import { com } from '@admin/lexicons'
import {
  LexRouter,
  LexServerError,
  type LexRouterAuth,
  type ServiceAuthCredentials,
} from '@atproto/lex-server'
import type { Kysely } from 'kysely'
import { insertAuditSafely } from './audit.js'
import { createGuard, createIdentityGuard, type Caller, type GuardDeps } from './auth/guard.js'
import { roleAllows, sessionView, type Permission } from './auth/roles.js'
import type { Config } from './config.js'
import type { ApprovalActionName, Database } from './db/types.js'
import type { DirectoryIndexer } from './directory/indexer.js'
import type { DirectoryStore } from './directory/store.js'
import type { Logger } from './logger.js'
import {
  batchExportAccounts,
  exportAccount,
  getAccountProfile,
  updateAccountProfile,
  type AccountOperationContext,
} from './services/account-operations.js'
import { getAccount, listAccounts } from './services/accounts.js'
import {
  getAccountGraph,
  getAccountPosts,
} from './services/account-browse.js'
import {
  archiveAnnouncement,
  createAnnouncement,
  getAnnouncement,
  listAnnouncements,
  listPublicAnnouncements,
  publishAnnouncement,
  updateAnnouncement,
  type AnnouncementContext,
} from './services/announcements.js'
import { exportAuditEvents, listAuditEvents } from './services/audit.js'
import { chatMetadataBody } from './services/chat.js'
import { getContent, searchContent, searchImages } from './services/content.js'
import { exportAnalytics, exportContent } from './services/exports.js'
import {
  createApprovalSeal,
  createPasswordSealer,
  deleteAccountAdminGuarded,
  disableAccountInvites,
  getAccountAdminInfo,
  updateAccountAdminGuarded,
  type AccountAdminWriteContext,
} from './services/account-admin.js'
import { executeApprovedAction } from './services/approval-actions.js'
import {
  approveApproval,
  cancelApproval,
  createApproval,
  listApprovals,
  rejectApproval,
  type ApprovalContext,
} from './services/approvals.js'
import { dashboardSeries } from './services/dashboard.js'
import {
  importRolesGuarded,
  resetSettingsGuarded,
  revokeRoleGuarded,
  updateRoleGuarded,
  type GuardedActionContext,
} from './services/guarded-actions.js'
import {
  getIndexerStatus,
  pauseIndexer,
  resumeIndexer,
} from './services/indexer-admin.js'
import {
  actOnQueue,
  actOnReport,
  actOnSubjects,
  cancelScheduledActions,
  getAccountOverview,
  getEvent,
  getEventBatch,
  getReport,
  listEvents,
  listQueues,
  listReports,
  listScheduledActions,
  moderationAnalytics,
  queryStatuses,
  randomAccount,
  type ModerationWriteContext,
} from './services/moderation.js'
import {
  actOnTemplate,
  listTemplates,
  sendNotification,
  type NotificationWriteContext,
} from './services/notifications.js'
import {
  actOnPolicyOption,
  actOnPolicySafelink,
  actOnPolicySet,
  getLabelerConfig,
  getPolicySet,
  listPolicyOptions,
  listPolicySets,
  listSafelinkEvents,
  listSafelinkRules,
  type PolicyDeps,
  type PolicyWriteContext,
} from './services/policy.js'
import {
  createRole,
  exportRoles,
  getRole,
  listRoles,
  type RoleMutationContext,
} from './services/roles.js'
import {
  blockAccess,
  listAccess,
  listBlocks,
  selfAccess,
  unblockAccess,
  type SecurityContext,
} from './services/security.js'
import { getSystemStatus } from './services/system.js'
import {
  findRelatedSignatureAccounts,
  findSignatureCorrelation,
  searchSignatureAccounts,
} from './services/signature.js'
import {
  getUserNotificationPreferences,
  getUserUnreadCount,
  listUserNotifications,
} from './services/inbox.js'
import {
  actOnVerifications,
  listVerifications,
  type VerificationWriteContext,
} from './services/verification.js'
import type { XrpcClient } from './upstream/client.js'
import {
  loadApprovalScope,
  updateApprovalScope,
  type ApprovalScopeContext,
} from './settings/approvals.js'
import { getPreferences, updatePreferences } from './settings/preferences.js'
import { uploadLogo } from './settings/logo.js'
import {
  exportSettings,
  importSettings,
  loadPublicSettings,
  loadSettings,
  settingsHistory,
  updateSettings,
  type SettingsContext,
} from './settings/service.js'

const GRAPH_KINDS = ['follows', 'followers', 'blocks', 'lists'] as const
const POST_FILTERS = ['posts', 'withReplies', 'withMedia'] as const
const INBOX_SECTIONS = ['reports', 'subjects', 'accountStatus'] as const

function requireKnownOption<T extends string>(
  value: string,
  allowed: readonly T[],
  label: string,
): T {
  const match = allowed.find((option) => option === value)
  if (!match) {
    throw new LexServerError(400, {
      error: 'InvalidRequest',
      message: `${label}不受支持。`,
    })
  }
  return match
}

function knownOption<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  label: string,
): T | undefined {
  return value === undefined ? undefined : requireKnownOption(value, allowed, label)
}

export type RouterDeps = {
  config: Config
  logger: Logger
  db: Kysely<Database>
  store: DirectoryStore
  indexer: DirectoryIndexer
  verifier: LexRouterAuth<ServiceAuthCredentials>
  didResolver: GuardDeps['didResolver']
  ozone: XrpcClient
  appview: XrpcClient
  pds: XrpcClient
  senderDid: string
  startedAt: number
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
    meta: caller,
  })
  const settingsContext = (caller: Caller): SettingsContext => ({
    db: deps.db,
    logger: deps.logger,
    actor: caller.did,
    meta: caller,
  })
  const announcementContext = (caller: Caller): AnnouncementContext => ({
    db: deps.db,
    logger: deps.logger,
    actor: caller.did,
    meta: caller,
    ttlHours: deps.config.approvalTtlHours,
  })
  const approvalScopeContext = (caller: Caller): ApprovalScopeContext =>
    settingsContext(caller)
  const accountContext = (caller: Caller): AccountOperationContext => ({
    db: deps.db,
    logger: deps.logger,
    actor: caller.did,
    meta: caller,
  })
  const securityContext = (caller: Caller): SecurityContext => ({
    db: deps.db,
    logger: deps.logger,
    actor: caller.did,
    meta: caller,
  })
  const passwordSealer = deps.config.pdsAdminPassword
    ? createPasswordSealer(deps.config.pdsAdminPassword)
    : undefined
  const approvalSeal = createApprovalSeal(passwordSealer)
  const approvalContext = (caller: Caller): ApprovalContext => ({
    db: deps.db,
    logger: deps.logger,
    actor: caller.did,
    meta: caller,
    ttlHours: deps.config.approvalTtlHours,
    seal: approvalSeal,
  })
  const accountAdminContext = (caller: Caller): AccountAdminWriteContext => ({
    db: deps.db,
    logger: deps.logger,
    actor: caller.did,
    meta: caller,
    pds: deps.pds,
  })
  const guardedContext = (caller: Caller): GuardedActionContext => ({
    db: deps.db,
    logger: deps.logger,
    actor: caller.did,
    meta: caller,
    ttlHours: deps.config.approvalTtlHours,
  })
  const moderationDeps = { ozone: deps.ozone, logger: deps.logger }
  const signatureDeps = { ozone: deps.ozone, logger: deps.logger }
  const accountBrowseDeps = { appview: deps.appview, logger: deps.logger }
  const inboxDeps = { ozone: deps.ozone, logger: deps.logger }
  const contentDeps = {
    appview: deps.appview,
    ozone: deps.ozone,
    logger: deps.logger,
  }
  const moderationContext = (caller: Caller): ModerationWriteContext => ({
    ozone: deps.ozone,
    logger: deps.logger,
    db: deps.db,
    actor: caller.did,
    meta: caller,
    ttlHours: deps.config.approvalTtlHours,
  })
  const verificationDeps = { ozone: deps.ozone, logger: deps.logger }
  const verificationContext = (caller: Caller): VerificationWriteContext => ({
    ...verificationDeps,
    db: deps.db,
    actor: caller.did,
    meta: caller,
    ttlHours: deps.config.approvalTtlHours,
  })
  const notificationDeps = {
    ozone: deps.ozone,
    pds: deps.pds,
    logger: deps.logger,
    senderDid: deps.senderDid,
  }
  const notificationContext = (caller: Caller): NotificationWriteContext => ({
    ...notificationDeps,
    db: deps.db,
    actor: caller.did,
    meta: caller,
    ttlHours: deps.config.approvalTtlHours,
  })
  const policyDeps: PolicyDeps = {
    ozone: deps.ozone,
    appview: deps.appview,
    logger: deps.logger,
  }
  const policyContext = (caller: Caller): PolicyWriteContext => ({
    ...policyDeps,
    db: deps.db,
    actor: caller.did,
    meta: caller,
    ttlHours: deps.config.approvalTtlHours,
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

  router.add(com.selfcommand.admin.navigation.get.main, {
    auth: createIdentityGuard(guardDeps),
    handler: async () => {
      const { settings, meta } = await loadSettings(deps.db)
      const navMeta = meta.find((item) => item.section === 'navigation')
      return {
        body: {
          groups: settings.navigation.groups,
          features: settings.features,
          version: navMeta?.version ?? 0,
        },
      }
    },
  })

  router.add(com.selfcommand.admin.preferences.get.main, {
    auth: createIdentityGuard(guardDeps),
    handler: async (ctx) => ({
      body: await getPreferences(deps.db, ctx.credentials.did),
    }),
  })

  router.add(com.selfcommand.admin.preferences.update.main, {
    auth: createIdentityGuard(guardDeps),
    handler: async (ctx) => ({
      body: await updatePreferences(deps.db, ctx.credentials.did, ctx.input.body),
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
        sort: ctx.params.sort,
        order: ctx.params.order,
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
        role: await updateRoleGuarded(guardedContext(ctx.credentials), ctx.input.body),
      },
    }),
  })

  router.add(com.selfcommand.admin.role.revoke.main, {
    auth: createGuard('role.write', guardDeps),
    handler: async (ctx) => {
      await revokeRoleGuarded(guardedContext(ctx.credentials), ctx.input.body)
      return {}
    },
  })

  router.add(com.selfcommand.admin.role.import.main, {
    auth: createGuard('role.write', guardDeps),
    handler: async (ctx) => ({
      body: await importRolesGuarded(guardedContext(ctx.credentials), ctx.input.body),
    }),
  })

  router.add(com.selfcommand.admin.role.export.main, {
    auth: createGuard('role.read', guardDeps),
    handler: async () => ({ body: await exportRoles(deps.db) }),
  })

  router.add(com.selfcommand.admin.audit.list.main, {
    auth: createGuard('audit.read', guardDeps),
    handler: async (ctx) => ({
      body: await listAuditEvents(deps.db, {
        cursor: ctx.params.cursor,
        limit: ctx.params.limit ?? 50,
        actor: ctx.params.actor,
        action: ctx.params.action,
        target: ctx.params.target,
        result: ctx.params.result,
        since: ctx.params.since,
        until: ctx.params.until,
        sort: ctx.params.sort,
        order: ctx.params.order,
      }),
    }),
  })

  router.add(com.selfcommand.admin.audit.export.main, {
    auth: createGuard('audit.read', guardDeps),
    handler: async (ctx) => {
      const { settings } = await loadSettings(deps.db)
      const result = await exportAuditEvents(
        deps.db,
        {
          format: ctx.params.format,
          actor: ctx.params.actor,
          action: ctx.params.action,
          target: ctx.params.target,
          result: ctx.params.result,
          since: ctx.params.since,
          until: ctx.params.until,
        },
        settings.audit.exportMaxRows,
      )
      await insertAuditSafely(deps.db, deps.logger, {
        actor: ctx.credentials.did,
        action: 'com.selfcommand.admin.audit.export',
        targetType: 'audit',
        target: ctx.params.format ?? 'csv',
        result: 'success',
        detail: `导出 ${result.rows} 条审计记录`,
        ...ctx.credentials,
      })
      return { body: result }
    },
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
          sort: ctx.params.sort,
          order: ctx.params.order,
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

  router.add(com.selfcommand.admin.account.graph.main, {
    auth: createGuard('directory.read', guardDeps),
    handler: async (ctx) => ({
      body: await getAccountGraph(accountBrowseDeps, {
        did: ctx.params.did,
        kind: requireKnownOption(ctx.params.kind, GRAPH_KINDS, '浏览类型'),
        cursor: ctx.params.cursor,
        limit: ctx.params.limit ?? 50,
      }),
    }),
  })

  router.add(com.selfcommand.admin.account.posts.main, {
    auth: createGuard('content.read', guardDeps),
    handler: async (ctx) => ({
      body: await getAccountPosts(accountBrowseDeps, {
        did: ctx.params.did,
        filter:
          knownOption(ctx.params.filter, POST_FILTERS, '帖子筛选') ?? 'posts',
        cursor: ctx.params.cursor,
        limit: ctx.params.limit ?? 50,
      }),
    }),
  })

  router.add(com.selfcommand.admin.signature.searchAccounts.main, {
    auth: createGuard('moderation.read', guardDeps),
    handler: async (ctx) => ({
      body: await searchSignatureAccounts(signatureDeps, {
        values: ctx.params.values,
        cursor: ctx.params.cursor,
        limit: ctx.params.limit ?? 50,
      }),
    }),
  })

  router.add(com.selfcommand.admin.signature.findRelatedAccounts.main, {
    auth: createGuard('moderation.read', guardDeps),
    handler: async (ctx) => ({
      body: await findRelatedSignatureAccounts(signatureDeps, {
        did: ctx.params.did,
        cursor: ctx.params.cursor,
        limit: ctx.params.limit ?? 50,
      }),
    }),
  })

  router.add(com.selfcommand.admin.signature.findCorrelation.main, {
    auth: createGuard('moderation.read', guardDeps),
    handler: async (ctx) => ({
      body: await findSignatureCorrelation(signatureDeps, {
        dids: ctx.params.dids,
      }),
    }),
  })

  router.add(com.selfcommand.admin.inbox.listNotifications.main, {
    auth: createGuard('moderation.read', guardDeps),
    handler: async (ctx) => ({
      body: await listUserNotifications(inboxDeps, {
        did: ctx.params.did,
        section: knownOption(ctx.params.section, INBOX_SECTIONS, '通知分区'),
        reasons: ctx.params.reasons,
        unreadOnly: ctx.params.unreadOnly,
        cursor: ctx.params.cursor,
        limit: ctx.params.limit ?? 50,
      }),
    }),
  })

  router.add(com.selfcommand.admin.inbox.getUnreadCount.main, {
    auth: createGuard('moderation.read', guardDeps),
    handler: async (ctx) => ({
      body: {
        unreadCounts: await getUserUnreadCount(inboxDeps, {
          did: ctx.params.did,
          section: knownOption(ctx.params.section, INBOX_SECTIONS, '通知分区'),
        }),
      },
    }),
  })

  router.add(com.selfcommand.admin.inbox.getNotificationPreferences.main, {
    auth: createGuard('moderation.read', guardDeps),
    handler: async (ctx) => ({
      body: {
        preferences: await getUserNotificationPreferences(inboxDeps, {
          did: ctx.params.did,
        }),
      },
    }),
  })

  router.add(com.selfcommand.admin.account.admin.info.main, {
    auth: createGuard('account.admin', guardDeps),
    handler: async (ctx) => ({
      body: { info: await getAccountAdminInfo(deps.pds, ctx.params.did) },
    }),
  })

  router.add(com.selfcommand.admin.account.admin.update.main, {
    auth: createGuard('account.admin', guardDeps),
    handler: async (ctx) => {
      await updateAccountAdminGuarded(accountAdminContext(ctx.credentials), ctx.input.body)
      return { body: {} }
    },
  })

  router.add(com.selfcommand.admin.account.admin.delete.main, {
    auth: createGuard('account.admin', guardDeps),
    handler: async (ctx) => {
      await deleteAccountAdminGuarded(accountAdminContext(ctx.credentials), ctx.input.body)
      return { body: {} }
    },
  })

  router.add(com.selfcommand.admin.account.invites.disable.main, {
    auth: createGuard('account.admin', guardDeps),
    handler: async (ctx) => {
      await disableAccountInvites(accountAdminContext(ctx.credentials), ctx.input.body)
      return { body: {} }
    },
  })

  router.add(com.selfcommand.admin.account.profile.get.main, {
    auth: createGuard('directory.read', guardDeps),
    handler: async (ctx) => ({
      body: await getAccountProfile(deps.db, deps.store, ctx.params.did),
    }),
  })

  router.add(com.selfcommand.admin.account.profile.update.main, {
    auth: createGuard('account.write', guardDeps),
    handler: async (ctx) => ({
      body: await updateAccountProfile(accountContext(ctx.credentials), ctx.input.body),
    }),
  })

  router.add(com.selfcommand.admin.account.export.main, {
    auth: createGuard('directory.read', guardDeps),
    handler: async (ctx) => {
      const result = await exportAccount(deps.db, deps.store, ctx.params.did)
      await insertAuditSafely(deps.db, deps.logger, {
        actor: ctx.credentials.did,
        action: 'com.selfcommand.admin.account.export',
        targetType: 'account',
        target: ctx.params.did,
        result: 'success',
        detail: '导出 1 个账号的运营记录（JSON 格式）',
        ...ctx.credentials,
      })
      return { body: result }
    },
  })

  router.add(com.selfcommand.admin.account.batch.export.main, {
    auth: createGuard('directory.read', guardDeps),
    handler: async (ctx) => {
      const result = await batchExportAccounts(
        deps.db,
        ctx.params.dids,
        ctx.params.format ?? 'json',
      )
      await insertAuditSafely(deps.db, deps.logger, {
        actor: ctx.credentials.did,
        action: 'com.selfcommand.admin.account.batch.export',
        targetType: 'account',
        target: 'batch',
        result: 'success',
        detail: `批量导出 ${result.count} 个账号（${result.format.toUpperCase()} 格式）`,
        ...ctx.credentials,
      })
      return { body: result }
    },
  })

  router.add(com.selfcommand.admin.announcement.list.main, {
    auth: createGuard('announcement.read', guardDeps),
    handler: async (ctx) => ({
      body: await listAnnouncements(deps.db, {
        status: ctx.params.status,
        placement: ctx.params.placement,
        q: ctx.params.q,
        startsAfter: ctx.params.startsAfter,
        startsBefore: ctx.params.startsBefore,
        endsAfter: ctx.params.endsAfter,
        endsBefore: ctx.params.endsBefore,
        sort: ctx.params.sort,
        direction: ctx.params.direction,
        limit: ctx.params.limit ?? 50,
        cursor: ctx.params.cursor,
      }),
    }),
  })

  router.add(com.selfcommand.admin.announcement.get.main, {
    auth: createGuard('announcement.read', guardDeps),
    handler: async (ctx) => ({
      body: await getAnnouncement(deps.db, ctx.params.id),
    }),
  })

  router.add(com.selfcommand.admin.announcement.create.main, {
    auth: createGuard('announcement.write', guardDeps),
    handler: async (ctx) => ({
      body: await createAnnouncement(announcementContext(ctx.credentials), ctx.input.body),
    }),
  })

  router.add(com.selfcommand.admin.announcement.update.main, {
    auth: createGuard('announcement.write', guardDeps),
    handler: async (ctx) => ({
      body: await updateAnnouncement(announcementContext(ctx.credentials), ctx.input.body),
    }),
  })

  router.add(com.selfcommand.admin.announcement.publish.main, {
    auth: createGuard('announcement.publish', guardDeps),
    handler: async (ctx) => ({
      body: await publishAnnouncement(announcementContext(ctx.credentials), {
        id: ctx.input.body.id,
        ...(ctx.input.body.approvalId ? { approvalId: ctx.input.body.approvalId } : {}),
        ...(ctx.input.body.reason ? { reason: ctx.input.body.reason } : {}),
      }),
    }),
  })

  router.add(com.selfcommand.admin.announcement.archive.main, {
    auth: createGuard('announcement.publish', guardDeps),
    handler: async (ctx) => ({
      body: await archiveAnnouncement(announcementContext(ctx.credentials), {
        id: ctx.input.body.id,
        ...(ctx.input.body.approvalId ? { approvalId: ctx.input.body.approvalId } : {}),
        ...(ctx.input.body.reason ? { reason: ctx.input.body.reason } : {}),
      }),
    }),
  })

  router.add(com.selfcommand.admin.announcement.public.main, async (ctx) => ({
    body: await listPublicAnnouncements(deps.db, {
      placement: ctx.params.placement,
      limit: ctx.params.limit ?? 20,
    }),
  }))

  router.add(com.selfcommand.admin.settings.get.main, {
    auth: createGuard('settings.read', guardDeps),
    handler: async () => ({ body: await loadSettings(deps.db) }),
  })

  router.add(com.selfcommand.admin.settings.update.main, {
    auth: createGuard('settings.write', guardDeps),
    handler: async (ctx) => ({
      body: { meta: await updateSettings(settingsContext(ctx.credentials), ctx.input.body) },
    }),
  })

  router.add(com.selfcommand.admin.settings.reset.main, {
    auth: createGuard('settings.write', guardDeps),
    handler: async (ctx) => ({
      body: await resetSettingsGuarded(guardedContext(ctx.credentials), ctx.input.body),
    }),
  })

  router.add(com.selfcommand.admin.settings.history.main, {
    auth: createGuard('settings.read', guardDeps),
    handler: async (ctx) => ({
      body: await settingsHistory(deps.db, {
        section: ctx.params.section,
        cursor: ctx.params.cursor,
        limit: ctx.params.limit ?? 20,
      }),
    }),
  })

  router.add(com.selfcommand.admin.settings.export.main, {
    auth: createGuard('settings.read', guardDeps),
    handler: async () => ({ body: await exportSettings(deps.db) }),
  })

  router.add(com.selfcommand.admin.settings.import.main, {
    auth: createGuard('settings.write', guardDeps),
    handler: async (ctx) => ({
      body: await importSettings(settingsContext(ctx.credentials), ctx.input.body),
    }),
  })

  router.add(com.selfcommand.admin.settings.logo.upload.main, {
    auth: createGuard('settings.write', guardDeps),
    handler: async (ctx) => ({
      body: await uploadLogo(settingsContext(ctx.credentials), ctx.input.body),
    }),
  })

  router.add(com.selfcommand.admin.settings.public.main, async () => ({
    body: await loadPublicSettings(deps.db),
  }))

  router.add(com.selfcommand.admin.settings.approvals.get.main, {
    auth: createGuard('settings.read', guardDeps),
    handler: async () => ({ body: await loadApprovalScope(deps.db) }),
  })

  router.add(com.selfcommand.admin.settings.approvals.update.main, {
    auth: createGuard('settings.write', guardDeps),
    handler: async (ctx) => ({
      body: await updateApprovalScope(approvalScopeContext(ctx.credentials), {
        additionalActions: ctx.input.body.additionalActions,
        ...(ctx.input.body.reason ? { reason: ctx.input.body.reason } : {}),
      }),
    }),
  })

  router.add(com.selfcommand.admin.indexer.status.main, {
    auth: createGuard('settings.read', guardDeps),
    handler: async () => ({
      body: await getIndexerStatus({
        db: deps.db,
        logger: deps.logger,
        store: deps.store,
        indexer: deps.indexer,
      }),
    }),
  })

  router.add(com.selfcommand.admin.indexer.pause.main, {
    auth: createGuard('settings.write', guardDeps),
    handler: async (ctx) => ({
      body: await pauseIndexer(
        {
          db: deps.db,
          logger: deps.logger,
          store: deps.store,
          indexer: deps.indexer,
          actor: ctx.credentials.did,
          meta: ctx.credentials,
        },
        ctx.input.body.reason,
      ),
    }),
  })

  router.add(com.selfcommand.admin.indexer.resume.main, {
    auth: createGuard('settings.write', guardDeps),
    handler: async (ctx) => ({
      body: await resumeIndexer({
        db: deps.db,
        logger: deps.logger,
        store: deps.store,
        indexer: deps.indexer,
        actor: ctx.credentials.did,
        meta: ctx.credentials,
      }),
    }),
  })

  router.add(com.selfcommand.admin.system.status.main, {
    auth: createGuard('settings.read', guardDeps),
    handler: async () => ({
      body: await getSystemStatus({
        config: deps.config,
        db: deps.db,
        indexer: deps.indexer,
        startedAt: deps.startedAt,
        ozone: deps.ozone,
        appview: deps.appview,
        logger: deps.logger,
      }),
    }),
  })

  router.add(com.selfcommand.admin.security.access.list.main, {
    auth: createGuard('security.read', guardDeps),
    handler: async (ctx) => ({
      body: await listAccess(deps.db, {
        cursor: ctx.params.cursor,
        limit: ctx.params.limit ?? 50,
        did: ctx.params.did,
      }),
    }),
  })

  router.add(com.selfcommand.admin.security.blocked.list.main, {
    auth: createGuard('security.read', guardDeps),
    handler: async (ctx) => ({
      body: await listBlocks(deps.db, {
        cursor: ctx.params.cursor,
        limit: ctx.params.limit ?? 50,
      }),
    }),
  })

  router.add(com.selfcommand.admin.security.block.main, {
    auth: createGuard('security.write', guardDeps),
    handler: async (ctx) => ({
      body: await blockAccess(securityContext(ctx.credentials), ctx.input.body),
    }),
  })

  router.add(com.selfcommand.admin.security.unblock.main, {
    auth: createGuard('security.write', guardDeps),
    handler: async (ctx) => ({
      body: await unblockAccess(securityContext(ctx.credentials), ctx.input.body),
    }),
  })

  router.add(com.selfcommand.admin.security.self.main, {
    auth: createIdentityGuard(guardDeps),
    handler: async (ctx) => ({
      body: await selfAccess(deps.db, ctx.credentials.did),
    }),
  })

  router.add(com.selfcommand.admin.approval.list.main, {
    auth: createGuard('security.read', guardDeps),
    handler: async (ctx) => ({
      body: await listApprovals(deps.db, {
        status: ctx.params.status,
        cursor: ctx.params.cursor,
        limit: ctx.params.limit ?? 50,
      }),
    }),
  })

  router.add(com.selfcommand.admin.approval.create.main, {
    auth: createGuard(APPROVAL_PERMISSIONS_LIST, guardDeps, {
      label: '发起审批请求',
    }),
    handler: async (ctx) => {
      const action = ctx.input.body.action
      const required =
        typeof action === 'string'
          ? APPROVAL_PERMISSIONS[action as ApprovalActionName]
          : undefined
      if (required && !roleAllows(ctx.credentials.role, required)) {
        await insertAuditSafely(deps.db, deps.logger, {
          actor: ctx.credentials.did,
          action: 'com.selfcommand.admin.approval.create',
          targetType: 'approval',
          result: 'denied',
          detail: '当前角色未授予发起该审批动作的权限',
          ...ctx.credentials,
        })
        throw new LexServerError(403, {
          error: 'Forbidden',
          message: '当前角色无权发起该审批请求',
        })
      }
      return { body: await createApproval(approvalContext(ctx.credentials), ctx.input.body) }
    },
  })

  router.add(com.selfcommand.admin.approval.approve.main, {
    auth: createGuard('security.write', guardDeps),
    handler: async (ctx) => ({
      body: await approveApproval(
        approvalContext(ctx.credentials),
        ctx.input.body.id,
        (trx, action, payload) => {
          const requiredPermission = APPROVAL_PERMISSIONS[action]
          if (!roleAllows(ctx.credentials.role, requiredPermission)) {
            throw new LexServerError(403, {
              error: 'Forbidden',
              message: '当前角色无权执行该审批动作',
            })
          }
          return executeApprovedAction(trx, action, payload, {
            db: deps.db,
            logger: deps.logger,
            actor: ctx.credentials.did,
            meta: ctx.credentials,
            approvalId: ctx.input.body.id,
            ozone: deps.ozone,
            appview: deps.appview,
            pds: deps.pds,
            senderDid: deps.senderDid,
            ...(passwordSealer ? { sealer: passwordSealer } : {}),
          })
        },
      ),
    }),
  })

  router.add(com.selfcommand.admin.approval.reject.main, {
    auth: createGuard('security.write', guardDeps),
    handler: async (ctx) => ({
      body: await rejectApproval(
        approvalContext(ctx.credentials),
        ctx.input.body.id,
        ctx.input.body.reason,
      ),
    }),
  })

  router.add(com.selfcommand.admin.approval.cancel.main, {
    auth: createGuard('security.write', guardDeps),
    handler: async (ctx) => ({
      body: await cancelApproval(approvalContext(ctx.credentials), ctx.input.body.id),
    }),
  })

  router.add(com.selfcommand.admin.content.search.main, {
    auth: createGuard('content.read', guardDeps),
    handler: async (ctx) => ({
      body: await searchContent(contentDeps, {
        q: ctx.params.q,
        author: ctx.params.author,
        mention: ctx.params.mention,
        lang: ctx.params.lang,
        domain: ctx.params.domain,
        url: ctx.params.url,
        tag: ctx.params.tag,
        since: ctx.params.since,
        until: ctx.params.until,
        sort: ctx.params.sort,
        limit: ctx.params.limit ?? 25,
        cursor: ctx.params.cursor,
      }),
    }),
  })

  router.add(com.selfcommand.admin.content.get.main, {
    auth: createGuard('content.read', guardDeps),
    handler: async (ctx) => ({
      body: await getContent(contentDeps, ctx.params.uri ?? ''),
    }),
  })

  router.add(com.selfcommand.admin.content.imageSearch.main, {
    auth: createGuard('content.read', guardDeps),
    handler: async (ctx) => ({
      body: await searchImages(
        {
          imageSearchUrl: deps.config.imageSearchUrl,
          imageSearchToken: deps.config.imageSearchToken,
        },
        {
          q: ctx.params.q ?? '',
          limit: ctx.params.limit ?? 20,
          cursor: ctx.params.cursor,
        },
      ),
    }),
  })

  router.add(com.selfcommand.admin.content.export.main, {
    auth: createGuard('content.read', guardDeps),
    handler: async (ctx) => ({
      body: await exportContent(
        { appview: deps.appview, logger: deps.logger },
        {
          db: deps.db,
          logger: deps.logger,
          actor: ctx.credentials.did,
          meta: ctx.credentials,
        },
        {
          q: ctx.params.q,
          author: ctx.params.author,
          mention: ctx.params.mention,
          lang: ctx.params.lang,
          domain: ctx.params.domain,
          url: ctx.params.url,
          tag: ctx.params.tag,
          since: ctx.params.since,
          until: ctx.params.until,
          sort: ctx.params.sort,
        },
      ),
    }),
  })

  router.add(com.selfcommand.admin.moderation.report.list.main, {
    auth: createGuard('moderation.read', guardDeps),
    handler: async (ctx) => ({
      body: await listReports(moderationDeps, {
        status: ctx.params.status,
        queueId: ctx.params.queueId,
        reportTypes: ctx.params.reportTypes,
        subject: ctx.params.subject,
        did: ctx.params.did,
        subjectType: ctx.params.subjectType,
        reportedAfter: ctx.params.reportedAfter,
        reportedBefore: ctx.params.reportedBefore,
        assignedTo: ctx.params.assignedTo,
        isMuted: ctx.params.isMuted,
        sort: ctx.params.sort,
        direction: ctx.params.direction,
        limit: ctx.params.limit ?? 50,
        cursor: ctx.params.cursor,
      }),
    }),
  })

  router.add(com.selfcommand.admin.moderation.report.get.main, {
    auth: createGuard('moderation.read', guardDeps),
    handler: async (ctx) => {
      if (ctx.params.id === undefined) {
        throw new LexServerError(400, {
          error: 'InvalidRequest',
          message: '请提供举报编号。',
        })
      }
      return { body: await getReport(moderationDeps, ctx.params.id) }
    },
  })

  router.add(com.selfcommand.admin.moderation.report.act.main, {
    auth: createGuard('moderation.write', guardDeps),
    handler: async (ctx) => ({
      body: await actOnReport(moderationContext(ctx.credentials), ctx.input.body),
    }),
  })

  router.add(com.selfcommand.admin.moderation.queue.list.main, {
    auth: createGuard('moderation.read', guardDeps),
    handler: async (ctx) => ({
      body: await listQueues(moderationDeps, {
        enabled: ctx.params.enabled,
        limit: ctx.params.limit ?? 50,
        cursor: ctx.params.cursor,
      }),
    }),
  })

  router.add(com.selfcommand.admin.moderation.queue.act.main, {
    auth: createGuard('moderation.queue.manage', guardDeps),
    handler: async (ctx) => ({
      body: await actOnQueue(moderationContext(ctx.credentials), ctx.input.body),
    }),
  })

  router.add(com.selfcommand.admin.moderation.event.list.main, {
    auth: createGuard('moderation.read', guardDeps),
    handler: async (ctx) => ({
      body: await listEvents(moderationDeps, {
        subject: ctx.params.subject,
        did: ctx.params.did,
        includeAllUserRecords: ctx.params.includeAllUserRecords,
        types: ctx.params.types,
        createdBy: ctx.params.createdBy,
        createdAfter: ctx.params.createdAfter,
        createdBefore: ctx.params.createdBefore,
        hasComment: ctx.params.hasComment,
        comment: ctx.params.comment,
        direction: ctx.params.direction,
        limit: ctx.params.limit ?? 50,
        cursor: ctx.params.cursor,
        batchId: ctx.params.batchId,
      }),
    }),
  })

  router.add(com.selfcommand.admin.moderation.events.batch.get.main, {
    auth: createGuard('moderation.read', guardDeps),
    handler: async (ctx) => ({
      body: { summary: await getEventBatch(moderationDeps, ctx.params.batchId) },
    }),
  })

  router.add(com.selfcommand.admin.moderation.status.query.main, {
    auth: createGuard('moderation.read', guardDeps),
    handler: async (ctx) => ({
      body: await queryStatuses(moderationDeps, {
        subject: ctx.params.subject,
        subjectType: ctx.params.subjectType,
        reviewState: ctx.params.reviewState,
        takendown: ctx.params.takendown,
        lastReviewedBy: ctx.params.lastReviewedBy,
        reportedAfter: ctx.params.reportedAfter,
        reportedBefore: ctx.params.reportedBefore,
        reviewedAfter: ctx.params.reviewedAfter,
        reviewedBefore: ctx.params.reviewedBefore,
        limit: ctx.params.limit ?? 50,
        cursor: ctx.params.cursor,
      }),
    }),
  })

  router.add(com.selfcommand.admin.moderation.event.get.main, {
    auth: createGuard('moderation.read', guardDeps),
    handler: async (ctx) => {
      if (ctx.params.id === undefined) {
        throw new LexServerError(400, {
          error: 'InvalidRequest',
          message: '请提供事件编号。',
        })
      }
      return { body: await getEvent(moderationDeps, ctx.params.id) }
    },
  })

  router.add(com.selfcommand.admin.moderation.act.main, {
    auth: createGuard('moderation.write', guardDeps),
    handler: async (ctx) => ({
      body: await actOnSubjects(moderationContext(ctx.credentials), ctx.input.body),
    }),
  })

  router.add(com.selfcommand.admin.moderation.scheduled.list.main, {
    auth: createGuard('moderation.read', guardDeps),
    handler: async (ctx) => ({
      body: await listScheduledActions(moderationDeps, ctx.input.body),
    }),
  })

  router.add(com.selfcommand.admin.moderation.scheduled.cancel.main, {
    auth: createGuard('moderation.write', guardDeps),
    handler: async (ctx) => ({
      body: await cancelScheduledActions(
        moderationContext(ctx.credentials),
        ctx.input.body,
      ),
    }),
  })

  router.add(com.selfcommand.admin.moderation.account.overview.main, {
    auth: createGuard('moderation.read', guardDeps),
    handler: async (ctx) => ({
      body: await getAccountOverview(moderationDeps, ctx.params.did ?? ''),
    }),
  })

  router.add(com.selfcommand.admin.moderation.random.main, {
    auth: createGuard('moderation.read', guardDeps),
    handler: async () => ({
      body: await randomAccount(deps.db),
    }),
  })

  router.add(com.selfcommand.admin.moderation.analytics.main, {
    auth: createGuard('analytics.read', guardDeps),
    handler: async (ctx) => ({
      body: await moderationAnalytics(moderationDeps, {
        days: ctx.params.days ?? 7,
        queueId: ctx.params.queueId,
      }),
    }),
  })

  router.add(com.selfcommand.admin.analytics.export.main, {
    auth: createGuard('analytics.read', guardDeps),
    handler: async (ctx) => ({
      body: await exportAnalytics(
        { ozone: deps.ozone, logger: deps.logger },
        {
          db: deps.db,
          logger: deps.logger,
          actor: ctx.credentials.did,
          meta: ctx.credentials,
        },
        {
          days: ctx.params.days,
          ...(ctx.params.queueId !== undefined ? { queueId: ctx.params.queueId } : {}),
        },
      ),
    }),
  })

  router.add(com.selfcommand.admin.chat.metadata.main, {
    auth: createGuard('chat.read', guardDeps),
    handler: async () => ({
      body: chatMetadataBody(deps.config),
    }),
  })

  router.add(com.selfcommand.admin.dashboard.series.main, {
    auth: createGuard('directory.read', guardDeps),
    handler: async (ctx) => ({
      body: await dashboardSeries(
        deps.db,
        ctx.params.days ?? 30,
        deps.config.indexer.enabled,
        new Date(),
        deps.config.reportTimezone,
      ),
    }),
  })

  router.add(com.selfcommand.admin.verification.list.main, {
    auth: createGuard('verification.read', guardDeps),
    handler: async (ctx) => ({
      body: await listVerifications(verificationDeps, {
        subject: ctx.params.subject,
        isRevoked: ctx.params.isRevoked,
        createdAfter: ctx.params.createdAfter,
        createdBefore: ctx.params.createdBefore,
        sortDirection: ctx.params.sortDirection,
        limit: ctx.params.limit ?? 50,
        cursor: ctx.params.cursor,
      }),
    }),
  })

  router.add(com.selfcommand.admin.verification.act.main, {
    auth: createGuard('verification.write', guardDeps),
    handler: async (ctx) => ({
      body: await actOnVerifications(verificationContext(ctx.credentials), ctx.input.body),
    }),
  })

  router.add(com.selfcommand.admin.notifications.template.list.main, {
    auth: createGuard('notification.read', guardDeps),
    handler: async () => ({
      body: await listTemplates(notificationDeps),
    }),
  })

  router.add(com.selfcommand.admin.notifications.template.act.main, {
    auth: createGuard('notification.write', guardDeps),
    handler: async (ctx) => ({
      body: await actOnTemplate(notificationContext(ctx.credentials), ctx.input.body),
    }),
  })

  router.add(com.selfcommand.admin.notifications.send.main, {
    auth: createGuard('notification.write', guardDeps),
    handler: async (ctx) => ({
      body: await sendNotification(notificationContext(ctx.credentials), ctx.input.body),
    }),
  })

  router.add(com.selfcommand.admin.policy.option.list.main, {
    auth: createGuard('policy.read', guardDeps),
    handler: async (ctx) => ({
      body: await listPolicyOptions(policyDeps, {
        scope: ctx.params.scope,
        keys: ctx.params.keys,
        prefix: ctx.params.prefix,
        limit: ctx.params.limit ?? 50,
        cursor: ctx.params.cursor,
      }),
    }),
  })

  router.add(com.selfcommand.admin.policy.option.act.main, {
    auth: createGuard('policy.write', guardDeps),
    handler: async (ctx) => ({
      body: await actOnPolicyOption(policyContext(ctx.credentials), ctx.input.body),
    }),
  })

  router.add(com.selfcommand.admin.policy.set.list.main, {
    auth: createGuard('policy.read', guardDeps),
    handler: async (ctx) => ({
      body: await listPolicySets(policyDeps, {
        namePrefix: ctx.params.namePrefix,
        limit: ctx.params.limit ?? 50,
        cursor: ctx.params.cursor,
      }),
    }),
  })

  router.add(com.selfcommand.admin.policy.set.get.main, {
    auth: createGuard('policy.read', guardDeps),
    handler: async (ctx) => ({
      body: await getPolicySet(policyDeps, {
        name: ctx.params.name,
        limit: ctx.params.limit ?? 100,
        cursor: ctx.params.cursor,
      }),
    }),
  })

  router.add(com.selfcommand.admin.policy.set.act.main, {
    auth: createGuard('policy.write', guardDeps),
    handler: async (ctx) => ({
      body: await actOnPolicySet(policyContext(ctx.credentials), ctx.input.body),
    }),
  })

  router.add(com.selfcommand.admin.policy.safelink.list.main, {
    auth: createGuard('policy.read', guardDeps),
    handler: async (ctx) => ({
      body: await listSafelinkRules(policyDeps, {
        urls: ctx.params.urls,
        patternType: ctx.params.patternType,
        actions: ctx.params.actions,
        reason: ctx.params.reason,
        source: ctx.params.source,
        limit: ctx.params.limit ?? 50,
        cursor: ctx.params.cursor,
      }),
    }),
  })

  router.add(com.selfcommand.admin.policy.safelink.events.main, {
    auth: createGuard('policy.read', guardDeps),
    handler: async (ctx) => ({
      body: await listSafelinkEvents(policyDeps, {
        urls: ctx.params.urls,
        patternType: ctx.params.patternType,
        limit: ctx.params.limit ?? 50,
        cursor: ctx.params.cursor,
      }),
    }),
  })

  router.add(com.selfcommand.admin.policy.safelink.act.main, {
    auth: createGuard('policy.write', guardDeps),
    handler: async (ctx) => ({
      body: await actOnPolicySafelink(policyContext(ctx.credentials), ctx.input.body),
    }),
  })

  router.add(com.selfcommand.admin.policy.labeler.get.main, {
    auth: createGuard('policy.read', guardDeps),
    handler: async () => ({
      body: await getLabelerConfig(policyDeps),
    }),
  })

  return router
}

const APPROVAL_PERMISSIONS: Record<ApprovalActionName, Permission> = {
  'settings.resetAll': 'settings.write',
  'role.revoke': 'role.write',
  'role.demote': 'role.write',
  'role.import': 'role.write',
  'moderation.takedown': 'moderation.write',
  'moderation.batch': 'moderation.write',
  'moderation.label': 'moderation.write',
  'verification.grant': 'verification.write',
  'verification.revoke': 'verification.write',
  'account.admin.update': 'account.admin',
  'account.admin.delete': 'account.admin',
  'notifications.send': 'notification.write',
  'policy.write': 'policy.write',
  'announcement.publish': 'announcement.publish',
  'announcement.archive': 'announcement.publish',
}

const APPROVAL_PERMISSIONS_LIST = [...new Set(Object.values(APPROVAL_PERMISSIONS))]
