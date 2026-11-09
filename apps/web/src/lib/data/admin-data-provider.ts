import type {
  AccessBlock,
  AccessBlockListResult,
  AccessListResult,
  AccountAdminInfo,
  AccountBatchExportResult,
  AccountExportResult,
  AccountGetResult,
  AccountGraphResult,
  AccountListResult,
  AccountModerationResult,
  AccountOperation,
  AccountOverview,
  AccountPostsResult,
  AccountProfileResult,
  AnalyticsExportResult,
  AnnouncementGetResult,
  AnnouncementListResult,
  AnnouncementMutationResult,
  Approval,
  ApprovalListResult,
  ApprovalScopeView,
  AuditExportResult,
  AuditListResult,
  ContentExportResult,
  DashboardSeriesResult,
  EventBatchSummary,
  IndexerStatus,
  InboxNotificationListResult,
  InboxNotificationPreferences,
  InboxUnreadCounts,
  LabelerConfig,
  NotificationSendResult,
  PolicyOptionActResult,
  PolicyOptionListResult,
  PolicySetActResult,
  PolicySetGetResult,
  PolicySetListResult,
  RelatedSignatureAccountsResult,
  RoleBinding,
  RoleExportResult,
  RoleImportResult,
  RoleListResult,
  SafelinkActResult,
  SafelinkEventsResult,
  SafelinkListResult,
  SelfAccess,
  SignatureCorrelationResult,
  SignatureSearchResult,
  StatusQueryResult,
  SystemStatus,
  TemplateActResult,
  TemplateListResult,
  VerificationActResult,
  VerificationListResult,
} from '@/lib/data/types'
import {
  ACCOUNT_NSIDS,
  ANNOUNCEMENT_NSIDS,
  APPROVAL_NSIDS,
  AUDIT_NSIDS,
  CHAT_NSIDS,
  CONTENT_NSIDS,
  DASHBOARD_NSIDS,
  INBOX_NSIDS,
  INDEXER_NSIDS,
  MODERATION_NSIDS,
  NOTIFICATION_NSIDS,
  POLICY_NSIDS,
  ROLE_NSIDS,
  SECURITY_NSIDS,
  SETTINGS_NSIDS,
  SIGNATURE_NSIDS,
  SYSTEM_NSIDS,
  VERIFICATION_NSIDS,
  toParams,
  type CallAdmin,
  type DataProvider,
} from '@/lib/data/provider'

export function createAdminDataProvider(callAdmin: CallAdmin): DataProvider {
  return {
    kind: 'admin',
    canWrite: true,

    listRoles: (query) =>
      callAdmin<RoleListResult>(ROLE_NSIDS.list, {
        params: toParams({
          cursor: query.cursor,
          limit: query.limit,
          role: query.role,
          search: query.search?.trim(),
          sort: query.sort,
          order: query.order,
        }),
      }),

    getRole: (subject) =>
      callAdmin<{ role: RoleBinding }>(ROLE_NSIDS.get, {
        params: toParams({ subject }),
      }).then((result) => result.role),

    createRole: (input) =>
      callAdmin<{ role: RoleBinding }>(ROLE_NSIDS.create, {
        body: {
          subject: input.subject,
          role: input.role,
          ...(input.note ? { note: input.note } : {}),
        },
      }).then((result) => result.role),

    updateRole: (input, options) =>
      callAdmin<{ role: RoleBinding }>(ROLE_NSIDS.update, {
        body: {
          subject: input.subject,
          role: input.role,
          ...(input.note ? { note: input.note } : {}),
          ...(options?.approvalId ? { approvalId: options.approvalId } : {}),
        },
      }).then((result) => result.role),

    revokeRole: (subject, options) =>
      callAdmin<unknown>(ROLE_NSIDS.revoke, {
        body: { subject, ...(options?.approvalId ? { approvalId: options.approvalId } : {}) },
      }).then(() => undefined),

    importRoles: (bindings, options) =>
      callAdmin<RoleImportResult>(ROLE_NSIDS.import, {
        body: {
          bindings: bindings.map((item) => ({
            subject: item.subject,
            role: item.role,
            ...(item.note ? { note: item.note } : {}),
          })),
          ...(options?.approvalId ? { approvalId: options.approvalId } : {}),
        },
      }),

    exportRoles: () => callAdmin<RoleExportResult>(ROLE_NSIDS.export),

    listAudit: (query) =>
      callAdmin<AuditListResult>(AUDIT_NSIDS.list, {
        params: toParams({
          cursor: query.cursor,
          limit: query.limit,
          actor: query.actor,
          action: query.action,
          target: query.target,
          result: query.result,
          since: query.since,
          until: query.until,
          sort: query.sort,
          order: query.order,
        }),
      }),

    exportAudit: (query) =>
      callAdmin<AuditExportResult>(AUDIT_NSIDS.export, {
        params: toParams({
          format: query.format,
          actor: query.actor,
          action: query.action,
          target: query.target,
          result: query.result,
          since: query.since,
          until: query.until,
        }),
      }),

    listAccounts: (query) =>
      callAdmin<AccountListResult>(ACCOUNT_NSIDS.list, {
        params: toParams({
          cursor: query.cursor,
          limit: query.limit,
          search: query.search?.trim(),
          status: query.status,
          sort: query.sort,
          order: query.order,
        }),
      }),

    getAccount: (did) =>
      callAdmin<AccountGetResult>(ACCOUNT_NSIDS.get, {
        params: toParams({ did }),
      }),

    getAccountProfile: (did) =>
      callAdmin<AccountProfileResult>(ACCOUNT_NSIDS.profileGet, {
        params: toParams({ did }),
      }),

    updateAccountProfile: (input) =>
      callAdmin<{ operation: AccountOperation }>(ACCOUNT_NSIDS.profileUpdate, {
        body: {
          did: input.did,
          ...(input.note !== undefined ? { note: input.note } : {}),
          ...(input.tags !== undefined ? { tags: input.tags } : {}),
          ...(input.syncPaused !== undefined ? { syncPaused: input.syncPaused } : {}),
        },
      }).then((result) => result.operation),

    exportAccount: (did) =>
      callAdmin<AccountExportResult>(ACCOUNT_NSIDS.export, {
        params: toParams({ did }),
      }),

    batchExportAccounts: (dids, format) =>
      callAdmin<AccountBatchExportResult>(ACCOUNT_NSIDS.batchExport, {
        params: { dids, format },
      }),

    getAccountAdminInfo: (did) =>
      callAdmin<{ info: AccountAdminInfo }>(ACCOUNT_NSIDS.adminInfo, {
        params: toParams({ did }),
      }).then((result) => result.info),

    updateAccountAdmin: (input) =>
      callAdmin<unknown>(ACCOUNT_NSIDS.adminUpdate, {
        body: {
          did: input.did,
          ...(input.email ? { email: input.email } : {}),
          ...(input.handle ? { handle: input.handle } : {}),
          ...(input.password ? { password: input.password } : {}),
        },
      }).then(() => undefined),

    deleteAccountAdmin: (did) =>
      callAdmin<unknown>(ACCOUNT_NSIDS.adminDelete, { body: { did } }).then(() => undefined),

    disableAccountInvites: (input) =>
      callAdmin<unknown>(ACCOUNT_NSIDS.invitesDisable, {
        body: {
          ...(input.did ? { did: input.did } : {}),
          ...(input.codes ? { codes: input.codes } : {}),
        },
      }).then(() => undefined),

    listAccess: (query) =>
      callAdmin<AccessListResult>(SECURITY_NSIDS.accessList, {
        params: toParams({
          cursor: query.cursor,
          limit: query.limit,
          did: query.did,
        }),
      }),

    listBlocked: (query) =>
      callAdmin<AccessBlockListResult>(SECURITY_NSIDS.blockedList, {
        params: toParams({
          cursor: query.cursor,
          limit: query.limit,
        }),
      }),

    blockAccess: (did, reason) =>
      callAdmin<{ block: AccessBlock }>(SECURITY_NSIDS.block, {
        body: { did, ...(reason ? { reason } : {}) },
      }).then((result) => result.block),

    unblockAccess: (did) =>
      callAdmin<{ blocked: boolean }>(SECURITY_NSIDS.unblock, {
        body: { did },
      }).then(() => undefined),

    getSelfAccess: () => callAdmin<SelfAccess>(SECURITY_NSIDS.self),

    listApprovals: (query) =>
      callAdmin<ApprovalListResult>(APPROVAL_NSIDS.list, {
        params: toParams({
          cursor: query.cursor,
          limit: query.limit,
          status: query.status,
        }),
      }),

    createApproval: (input) =>
      callAdmin<{ approval: Approval }>(APPROVAL_NSIDS.create, {
        body: {
          action: input.action,
          ...(input.targetType ? { targetType: input.targetType } : {}),
          ...(input.target ? { target: input.target } : {}),
          ...(input.summary ? { summary: input.summary } : {}),
          payload: input.payload,
        },
      }).then((result) => result.approval),

    approveApproval: (id) =>
      callAdmin<{ approval: Approval }>(APPROVAL_NSIDS.approve, {
        body: { id },
      }).then((result) => result.approval),

    rejectApproval: (id, reason) =>
      callAdmin<{ approval: Approval }>(APPROVAL_NSIDS.reject, {
        body: { id, ...(reason ? { reason } : {}) },
      }).then((result) => result.approval),

    cancelApproval: (id) =>
      callAdmin<{ approval: Approval }>(APPROVAL_NSIDS.cancel, {
        body: { id },
      }).then((result) => result.approval),

    getDashboardSeries: (days) =>
      callAdmin<DashboardSeriesResult>(DASHBOARD_NSIDS.series, {
        params: toParams({ days }),
      }),

    getSystemStatus: () => callAdmin<SystemStatus>(SYSTEM_NSIDS.status),

    pauseIndexer: (reason) =>
      callAdmin<{ status: IndexerStatus }>(INDEXER_NSIDS.pause, {
        body: reason ? { reason } : {},
      }).then((result) => result.status),

    resumeIndexer: () =>
      callAdmin<{ status: IndexerStatus }>(INDEXER_NSIDS.resume, {
        body: {},
      }).then((result) => result.status),

    searchContent: (query) =>
      callAdmin(CONTENT_NSIDS.search, {
        params: toParams({
          cursor: query.cursor,
          limit: query.limit,
          q: query.q.trim(),
          author: query.author?.trim(),
          mention: query.mention?.trim(),
          lang: query.lang?.trim(),
          domain: query.domain?.trim(),
          url: query.url?.trim(),
          tag: query.tag?.trim(),
          since: query.since,
          until: query.until,
          sort: query.sort,
        }),
      }),

    getContent: (uri) =>
      callAdmin(CONTENT_NSIDS.get, {
        params: toParams({ uri }),
      }),

    exportContent: (query) =>
      callAdmin<ContentExportResult>(CONTENT_NSIDS.export, {
        params: toParams({
          q: query.q.trim(),
          author: query.author?.trim(),
          mention: query.mention?.trim(),
          lang: query.lang?.trim(),
          domain: query.domain?.trim(),
          url: query.url?.trim(),
          tag: query.tag?.trim(),
          since: query.since,
          until: query.until,
          sort: query.sort,
        }),
      }),

    searchImages: (query) =>
      callAdmin(CONTENT_NSIDS.imageSearch, {
        params: toParams({
          q: query.q.trim(),
          limit: query.limit,
          cursor: query.cursor,
        }),
      }),

    getChatMetadata: () => callAdmin(CHAT_NSIDS.metadata),

    listReports: (query) =>
      callAdmin(MODERATION_NSIDS.reportList, {
        params: toParams({
          cursor: query.cursor,
          limit: query.limit,
          status: query.status,
          queueId: query.queueId,
          subject: query.subject?.trim(),
          did: query.did,
          subjectType: query.subjectType,
          reportedAfter: query.reportedAfter,
          reportedBefore: query.reportedBefore,
          assignedTo: query.assignedTo,
          sort: query.sort,
          direction: query.direction,
        }),
      }),

    getReport: (id) =>
      callAdmin(MODERATION_NSIDS.reportGet, {
        params: toParams({ id }),
      }),

    actOnReport: (input) =>
      callAdmin(MODERATION_NSIDS.reportAct, {
        body: {
          reportId: input.reportId,
          action: input.action,
          ...(input.queueId !== undefined ? { queueId: input.queueId } : {}),
          ...(input.scope !== undefined ? { scope: input.scope } : {}),
          ...(input.reportTypes !== undefined ? { reportTypes: input.reportTypes } : {}),
          ...(input.did ? { did: input.did } : {}),
          ...(input.comment ? { comment: input.comment } : {}),
        },
      }),

    listQueues: (query) =>
      callAdmin(MODERATION_NSIDS.queueList, {
        params: toParams({
          cursor: query.cursor,
          limit: query.limit,
          enabled: query.enabled,
        }),
      }),

    actOnQueue: (input) =>
      callAdmin(MODERATION_NSIDS.queueAct, {
        body: {
          action: input.action,
          ...(input.queueId !== undefined ? { queueId: input.queueId } : {}),
          ...(input.name ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...(input.subjectTypes !== undefined ? { subjectTypes: input.subjectTypes } : {}),
          ...(input.collection ? { collection: input.collection } : {}),
          ...(input.reportTypes !== undefined ? { reportTypes: input.reportTypes } : {}),
          ...(input.did ? { did: input.did } : {}),
          ...(input.startReportId !== undefined ? { startReportId: input.startReportId } : {}),
          ...(input.endReportId !== undefined ? { endReportId: input.endReportId } : {}),
          ...(input.migrateToQueueId !== undefined
            ? { migrateToQueueId: input.migrateToQueueId }
            : {}),
        },
      }),

    listEvents: (query) =>
      callAdmin(MODERATION_NSIDS.eventList, {
        params: {
          ...toParams({
            cursor: query.cursor,
            limit: query.limit,
            subject: query.subject?.trim(),
            did: query.did,
            createdBy: query.createdBy,
            createdAfter: query.createdAfter,
            createdBefore: query.createdBefore,
            hasComment: query.hasComment,
            comment: query.comment?.trim(),
            direction: query.direction,
            batchId: query.batchId,
          }),
          ...(query.types && query.types.length > 0 ? { types: query.types } : {}),
        },
      }),

    getEvent: (id) =>
      callAdmin(MODERATION_NSIDS.eventGet, {
        params: toParams({ id }),
      }),

    getEventBatch: (batchId) =>
      callAdmin<{ summary: EventBatchSummary }>(MODERATION_NSIDS.eventBatchGet, {
        params: { batchId },
      }).then((result) => result.summary),

    queryStatuses: (query) =>
      callAdmin<StatusQueryResult>(MODERATION_NSIDS.statusQuery, {
        params: toParams({
          cursor: query.cursor,
          limit: query.limit,
          subject: query.subject?.trim(),
          subjectType: query.subjectType,
          reviewState: query.reviewState,
          takendown: query.takendown,
          lastReviewedBy: query.lastReviewedBy?.trim(),
          reportedAfter: query.reportedAfter,
          reportedBefore: query.reportedBefore,
          reviewedAfter: query.reviewedAfter,
          reviewedBefore: query.reviewedBefore,
        }),
      }),

    actOnSubjects: (input) =>
      callAdmin(MODERATION_NSIDS.act, {
        body: {
          subjects: input.subjects,
          action: input.action,
          ...(input.comment ? { comment: input.comment } : {}),
          ...(input.reason ? { reason: input.reason } : {}),
          ...(input.labels !== undefined ? { labels: input.labels } : {}),
          ...(input.durationInHours !== undefined
            ? { durationInHours: input.durationInHours }
            : {}),
          ...(input.reportId !== undefined ? { reportId: input.reportId } : {}),
          ...(input.acknowledgeAccountSubjects !== undefined
            ? { acknowledgeAccountSubjects: input.acknowledgeAccountSubjects }
            : {}),
          ...(input.approvalId ? { approvalId: input.approvalId } : {}),
        },
      }),

    listScheduledActions: (query) =>
      callAdmin(MODERATION_NSIDS.scheduledList, {
        body: {
          ...(query.statuses !== undefined ? { statuses: query.statuses } : {}),
          ...(query.subjects !== undefined ? { subjects: query.subjects } : {}),
          ...(query.limit !== undefined ? { limit: query.limit } : {}),
          ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
        },
      }),

    cancelScheduledActions: (input) =>
      callAdmin(MODERATION_NSIDS.scheduledCancel, {
        body: {
          subjects: input.subjects,
          ...(input.comment ? { comment: input.comment } : {}),
        },
      }),

    getAccountModeration: async (did): Promise<AccountModerationResult> => {
      const result = await callAdmin<AccountModerationResult>(
        MODERATION_NSIDS.accountOverview,
        { params: toParams({ did }) },
      )
      return result
    },

    getRandomAccount: () =>
      callAdmin<{ overview: AccountOverview }>(MODERATION_NSIDS.random).then(
        (result) => result.overview,
      ),

    getModerationAnalytics: (days, queueId) =>
      callAdmin(MODERATION_NSIDS.analytics, {
        params: toParams({ days, queueId }),
      }),

    exportAnalytics: (days, queueId) =>
      callAdmin<AnalyticsExportResult>(MODERATION_NSIDS.analyticsExport, {
        params: toParams({ days, queueId }),
      }),

    listVerifications: (query) =>
      callAdmin<VerificationListResult>(VERIFICATION_NSIDS.list, {
        params: toParams({
          subject: query.subject?.trim(),
          isRevoked: query.isRevoked,
          createdAfter: query.createdAfter,
          createdBefore: query.createdBefore,
          sortDirection: query.sortDirection,
          limit: query.limit,
          cursor: query.cursor,
        }),
      }),

    actOnVerifications: (input) =>
      callAdmin<VerificationActResult>(VERIFICATION_NSIDS.act, {
        body: {
          action: input.action,
          ...(input.verifications ? { verifications: input.verifications } : {}),
          ...(input.uris ? { uris: input.uris } : {}),
          ...(input.reason ? { reason: input.reason } : {}),
          ...(input.approvalId ? { approvalId: input.approvalId } : {}),
        },
      }),

    listTemplates: () => callAdmin<TemplateListResult>(NOTIFICATION_NSIDS.templateList),

    actOnTemplate: (input) =>
      callAdmin<TemplateActResult>(NOTIFICATION_NSIDS.templateAct, {
        body: {
          action: input.action,
          ...(input.id ? { id: input.id } : {}),
          ...(input.name ? { name: input.name } : {}),
          ...(input.subject ? { subject: input.subject } : {}),
          ...(input.contentMarkdown ? { contentMarkdown: input.contentMarkdown } : {}),
          ...(input.lang ? { lang: input.lang } : {}),
          ...(input.disabled !== undefined ? { disabled: input.disabled } : {}),
        },
      }),

    sendNotification: (input) =>
      callAdmin<NotificationSendResult>(NOTIFICATION_NSIDS.send, {
        body: {
          recipients: input.recipients,
          subject: input.subject,
          contentMarkdown: input.contentMarkdown,
          ...(input.templateId ? { templateId: input.templateId } : {}),
          ...(input.approvalId ? { approvalId: input.approvalId } : {}),
        },
      }),

    listPolicyOptions: (query) =>
      callAdmin<PolicyOptionListResult>(POLICY_NSIDS.optionList, {
        params: {
          ...toParams({
            scope: query.scope,
            prefix: query.prefix?.trim(),
            limit: query.limit,
            cursor: query.cursor,
          }),
          ...(query.keys && query.keys.length > 0 ? { keys: query.keys } : {}),
        },
      }),

    actOnPolicyOption: (input) =>
      callAdmin<PolicyOptionActResult>(POLICY_NSIDS.optionAct, {
        body: {
          operation: input.operation,
          input: input.input,
          ...(input.approvalId ? { approvalId: input.approvalId } : {}),
        },
      }),

    listPolicySets: (query) =>
      callAdmin<PolicySetListResult>(POLICY_NSIDS.setList, {
        params: toParams({
          namePrefix: query.namePrefix?.trim(),
          limit: query.limit,
          cursor: query.cursor,
        }),
      }),

    getPolicySet: (query) =>
      callAdmin<PolicySetGetResult>(POLICY_NSIDS.setGet, {
        params: toParams({
          name: query.name.trim(),
          limit: query.limit,
          cursor: query.cursor,
        }),
      }),

    actOnPolicySet: (input) =>
      callAdmin<PolicySetActResult>(POLICY_NSIDS.setAct, {
        body: {
          operation: input.operation,
          input: input.input,
          ...(input.approvalId ? { approvalId: input.approvalId } : {}),
        },
      }),

    listSafelinkRules: (query) =>
      callAdmin<SafelinkListResult>(POLICY_NSIDS.safelinkList, {
        params: {
          ...toParams({
            patternType: query.patternType,
            reason: query.reason,
            source: query.source?.trim(),
            limit: query.limit,
            cursor: query.cursor,
          }),
          ...(query.urls && query.urls.length > 0 ? { urls: query.urls } : {}),
          ...(query.actions && query.actions.length > 0 ? { actions: query.actions } : {}),
        },
      }),

    listSafelinkEvents: (query) =>
      callAdmin<SafelinkEventsResult>(POLICY_NSIDS.safelinkEvents, {
        params: {
          ...toParams({
            patternType: query.patternType,
            limit: query.limit,
            cursor: query.cursor,
          }),
          ...(query.urls && query.urls.length > 0 ? { urls: query.urls } : {}),
        },
      }),

    actOnPolicySafelink: (input) =>
      callAdmin<SafelinkActResult>(POLICY_NSIDS.safelinkAct, {
        body: {
          operation: input.operation,
          input: input.input,
          ...(input.approvalId ? { approvalId: input.approvalId } : {}),
        },
      }),

    getLabelerConfig: () =>
      callAdmin<{ labeler: LabelerConfig }>(POLICY_NSIDS.labelerGet).then(
        (result) => result.labeler,
      ),

    listAnnouncements: (query) =>
      callAdmin<AnnouncementListResult>(ANNOUNCEMENT_NSIDS.list, {
        params: toParams({
          status: query.status,
          placement: query.placement,
          q: query.q?.trim(),
          sort: query.sort,
          direction: query.direction,
          limit: query.limit,
          cursor: query.cursor,
        }),
      }),

    getAnnouncement: (id) =>
      callAdmin<AnnouncementGetResult>(ANNOUNCEMENT_NSIDS.get, {
        params: toParams({ id }),
      }),

    createAnnouncement: (input) =>
      callAdmin<AnnouncementMutationResult>(ANNOUNCEMENT_NSIDS.create, {
        body: {
          title: input.title,
          body: input.body,
          level: input.level,
          placement: input.placement,
          ...(input.startsAt ? { startsAt: input.startsAt } : {}),
          ...(input.endsAt ? { endsAt: input.endsAt } : {}),
        },
      }),

    updateAnnouncement: (id, input) =>
      callAdmin<AnnouncementMutationResult>(ANNOUNCEMENT_NSIDS.update, {
        body: {
          id,
          title: input.title,
          body: input.body,
          level: input.level,
          placement: input.placement,
          ...(input.startsAt ? { startsAt: input.startsAt } : {}),
          ...(input.endsAt ? { endsAt: input.endsAt } : {}),
        },
      }),

    publishAnnouncement: (input) =>
      callAdmin<AnnouncementMutationResult>(ANNOUNCEMENT_NSIDS.publish, {
        body: {
          id: input.id,
          ...(input.approvalId ? { approvalId: input.approvalId } : {}),
          ...(input.reason ? { reason: input.reason } : {}),
        },
      }),

    archiveAnnouncement: (input) =>
      callAdmin<AnnouncementMutationResult>(ANNOUNCEMENT_NSIDS.archive, {
        body: {
          id: input.id,
          ...(input.approvalId ? { approvalId: input.approvalId } : {}),
          ...(input.reason ? { reason: input.reason } : {}),
        },
      }),

    getApprovalScope: () => callAdmin<ApprovalScopeView>(SETTINGS_NSIDS.approvalsGet),

    updateApprovalScope: (input) =>
      callAdmin<ApprovalScopeView>(SETTINGS_NSIDS.approvalsUpdate, {
        body: {
          additionalActions: input.additionalActions,
          ...(input.reason ? { reason: input.reason } : {}),
        },
      }),

    searchSignatureAccounts: (query) =>
      callAdmin<SignatureSearchResult>(SIGNATURE_NSIDS.searchAccounts, {
        params: {
          ...toParams({ cursor: query.cursor, limit: query.limit }),
          values: query.values,
        },
      }),

    findRelatedSignatureAccounts: (query) =>
      callAdmin<RelatedSignatureAccountsResult>(SIGNATURE_NSIDS.findRelatedAccounts, {
        params: toParams({
          did: query.did,
          cursor: query.cursor,
          limit: query.limit,
        }),
      }),

    findSignatureCorrelation: (dids) =>
      callAdmin<SignatureCorrelationResult>(SIGNATURE_NSIDS.findCorrelation, {
        params: { dids },
      }),

    getAccountGraph: (query) =>
      callAdmin<AccountGraphResult>(ACCOUNT_NSIDS.graph, {
        params: toParams({
          did: query.did,
          kind: query.kind,
          cursor: query.cursor,
          limit: query.limit,
        }),
      }),

    getAccountPosts: (query) =>
      callAdmin<AccountPostsResult>(ACCOUNT_NSIDS.posts, {
        params: toParams({
          did: query.did,
          filter: query.filter,
          cursor: query.cursor,
          limit: query.limit,
        }),
      }),

    listInboxNotifications: (query) =>
      callAdmin<InboxNotificationListResult>(INBOX_NSIDS.listNotifications, {
        params: {
          ...toParams({
            did: query.did,
            section: query.section,
            unreadOnly: query.unreadOnly,
            cursor: query.cursor,
            limit: query.limit,
          }),
          ...(query.reasons && query.reasons.length > 0 ? { reasons: query.reasons } : {}),
        },
      }),

    getInboxUnreadCounts: (did, section) =>
      callAdmin<{ unreadCounts: InboxUnreadCounts }>(INBOX_NSIDS.unreadCount, {
        params: toParams({ did, section }),
      }).then((result) => result.unreadCounts),

    getInboxNotificationPreferences: (did) =>
      callAdmin<{ preferences: InboxNotificationPreferences }>(INBOX_NSIDS.preferences, {
        params: toParams({ did }),
      }).then((result) => result.preferences),
  }
}