import type {
  AccessBlock,
  AccessBlockListQuery,
  AccessBlockListResult,
  AccessListQuery,
  AccessListResult,
  AccountAdminInfo,
  AccountAdminUpdateInput,
  AccountBatchExportFormat,
  AccountBatchExportResult,
  AccountExportResult,
  AccountGetResult,
  AccountGraphQuery,
  AccountGraphResult,
  AccountListQuery,
  AccountListResult,
  AccountModerationResult,
  AccountOperation,
  AccountOverview,
  AccountPostsQuery,
  AccountPostsResult,
  AccountProfileInput,
  AccountProfileResult,
  AnalyticsExportResult,
  AnnouncementGetResult,
  AnnouncementInput,
  AnnouncementListQuery,
  AnnouncementListResult,
  AnnouncementMutationResult,
  AnnouncementStatusInput,
  Approval,
  ApprovalAction,
  ApprovalCreateInput,
  ApprovalListQuery,
  ApprovalListResult,
  ApprovalScopeView,
  AuditExportResult,
  AuditListQuery,
  AuditListResult,
  ChatMetadata,
  ContentExportQuery,
  ContentExportResult,
  ContentGetResult,
  ContentSearchQuery,
  ContentSearchResult,
  DashboardDays,
  DashboardSeriesResult,
  EventBatchSummary,
  EventGetResult,
  EventListQuery,
  EventListResult,
  ImageSearchQuery,
  ImageSearchResult,
  IndexerStatus,
  InboxNotificationListQuery,
  InboxNotificationListResult,
  InboxNotificationPreferences,
  InboxSection,
  InboxUnreadCounts,
  InviteDisableInput,
  LabelerConfig,
  ModerationActInput,
  ModerationActResult,
  ModerationAnalyticsResult,
  NotificationSendInput,
  NotificationSendResult,
  PolicyActInput,
  PolicyOptionActResult,
  PolicyOptionListQuery,
  PolicyOptionListResult,
  PolicySetActResult,
  PolicySetGetQuery,
  PolicySetGetResult,
  PolicySetListQuery,
  PolicySetListResult,
  QueueActInput,
  QueueActResult,
  QueueListQuery,
  QueueListResult,
  RelatedSignatureAccountsQuery,
  RelatedSignatureAccountsResult,
  ReportActInput,
  ReportActResult,
  ReportGetResult,
  ReportListQuery,
  ReportListResult,
  RoleBinding,
  RoleExportResult,
  RoleImportItem,
  RoleImportResult,
  RoleListQuery,
  RoleListResult,
  RoleWriteInput,
  RoleWriteOptions,
  SafelinkActResult,
  SafelinkEventsQuery,
  SafelinkEventsResult,
  SafelinkListQuery,
  SafelinkListResult,
  ScheduledCancelInput,
  ScheduledCancelResult,
  ScheduledListQuery,
  ScheduledListResult,
  SelfAccess,
  SignatureCorrelationResult,
  SignatureSearchQuery,
  SignatureSearchResult,
  StatusQuery,
  StatusQueryResult,
  SystemStatus,
  TemplateActInput,
  TemplateActResult,
  TemplateListResult,
  VerificationActInput,
  VerificationActResult,
  VerificationListQuery,
  VerificationListResult,
} from '@/lib/data/types'

export type CallAdmin = <T>(
  nsid: string,
  options?: { params?: Record<string, string | string[]>; body?: unknown },
) => Promise<T>

export interface DataProvider {
  readonly kind: 'admin'
  readonly canWrite: boolean
  listRoles(query: RoleListQuery): Promise<RoleListResult>
  getRole(subject: string): Promise<RoleBinding>
  createRole(input: RoleWriteInput): Promise<RoleBinding>
  updateRole(input: RoleWriteInput, options?: RoleWriteOptions): Promise<RoleBinding>
  revokeRole(subject: string, options?: RoleWriteOptions): Promise<void>
  importRoles(bindings: RoleImportItem[], options?: RoleWriteOptions): Promise<RoleImportResult>
  exportRoles(): Promise<RoleExportResult>
  listAudit(query: AuditListQuery): Promise<AuditListResult>
  exportAudit(query: Omit<AuditListQuery, 'cursor' | 'limit' | 'sort' | 'order'> & {
    format: 'csv' | 'json'
  }): Promise<AuditExportResult>
  listAccounts(query: AccountListQuery): Promise<AccountListResult>
  getAccount(did: string): Promise<AccountGetResult>
  getAccountProfile(did: string): Promise<AccountProfileResult>
  updateAccountProfile(input: AccountProfileInput): Promise<AccountOperation>
  exportAccount(did: string): Promise<AccountExportResult>
  batchExportAccounts(
    dids: string[],
    format: AccountBatchExportFormat,
  ): Promise<AccountBatchExportResult>
  listAccess(query: AccessListQuery): Promise<AccessListResult>
  listBlocked(query: AccessBlockListQuery): Promise<AccessBlockListResult>
  blockAccess(did: string, reason?: string): Promise<AccessBlock>
  unblockAccess(did: string): Promise<void>
  getSelfAccess(): Promise<SelfAccess>
  listApprovals(query: ApprovalListQuery): Promise<ApprovalListResult>
  createApproval(input: ApprovalCreateInput): Promise<Approval>
  approveApproval(id: string): Promise<Approval>
  rejectApproval(id: string, reason?: string): Promise<Approval>
  cancelApproval(id: string): Promise<Approval>
  getDashboardSeries(days: DashboardDays): Promise<DashboardSeriesResult>
  getSystemStatus(): Promise<SystemStatus>
  pauseIndexer(reason?: string): Promise<IndexerStatus>
  resumeIndexer(): Promise<IndexerStatus>
  searchContent(query: ContentSearchQuery): Promise<ContentSearchResult>
  getContent(uri: string): Promise<ContentGetResult>
  exportContent(query: ContentExportQuery): Promise<ContentExportResult>
  searchImages(query: ImageSearchQuery): Promise<ImageSearchResult>
  getChatMetadata(): Promise<ChatMetadata>
  listReports(query: ReportListQuery): Promise<ReportListResult>
  getReport(id: number): Promise<ReportGetResult>
  actOnReport(input: ReportActInput): Promise<ReportActResult>
  listQueues(query: QueueListQuery): Promise<QueueListResult>
  actOnQueue(input: QueueActInput): Promise<QueueActResult>
  listEvents(query: EventListQuery): Promise<EventListResult>
  getEvent(id: number): Promise<EventGetResult>
  getEventBatch(batchId: string): Promise<EventBatchSummary>
  queryStatuses(query: StatusQuery): Promise<StatusQueryResult>
  actOnSubjects(input: ModerationActInput): Promise<ModerationActResult>
  listScheduledActions(query: ScheduledListQuery): Promise<ScheduledListResult>
  cancelScheduledActions(input: ScheduledCancelInput): Promise<ScheduledCancelResult>
  getAccountModeration(did: string): Promise<AccountModerationResult>
  getAccountAdminInfo(did: string): Promise<AccountAdminInfo>
  updateAccountAdmin(input: AccountAdminUpdateInput): Promise<void>
  deleteAccountAdmin(did: string): Promise<void>
  disableAccountInvites(input: InviteDisableInput): Promise<void>
  getRandomAccount(): Promise<AccountOverview>
  getModerationAnalytics(days: number, queueId?: number): Promise<ModerationAnalyticsResult>
  exportAnalytics(days: number, queueId?: number): Promise<AnalyticsExportResult>
  listVerifications(query: VerificationListQuery): Promise<VerificationListResult>
  actOnVerifications(input: VerificationActInput): Promise<VerificationActResult>
  listTemplates(): Promise<TemplateListResult>
  actOnTemplate(input: TemplateActInput): Promise<TemplateActResult>
  sendNotification(input: NotificationSendInput): Promise<NotificationSendResult>
  listPolicyOptions(query: PolicyOptionListQuery): Promise<PolicyOptionListResult>
  actOnPolicyOption(input: PolicyActInput): Promise<PolicyOptionActResult>
  listPolicySets(query: PolicySetListQuery): Promise<PolicySetListResult>
  getPolicySet(query: PolicySetGetQuery): Promise<PolicySetGetResult>
  actOnPolicySet(input: PolicyActInput): Promise<PolicySetActResult>
  listSafelinkRules(query: SafelinkListQuery): Promise<SafelinkListResult>
  listSafelinkEvents(query: SafelinkEventsQuery): Promise<SafelinkEventsResult>
  actOnPolicySafelink(input: PolicyActInput): Promise<SafelinkActResult>
  getLabelerConfig(): Promise<LabelerConfig>
  listAnnouncements(query: AnnouncementListQuery): Promise<AnnouncementListResult>
  getAnnouncement(id: number): Promise<AnnouncementGetResult>
  createAnnouncement(input: AnnouncementInput): Promise<AnnouncementMutationResult>
  updateAnnouncement(
    id: number,
    input: AnnouncementInput,
  ): Promise<AnnouncementMutationResult>
  publishAnnouncement(input: AnnouncementStatusInput): Promise<AnnouncementMutationResult>
  archiveAnnouncement(input: AnnouncementStatusInput): Promise<AnnouncementMutationResult>
  getApprovalScope(): Promise<ApprovalScopeView>
  updateApprovalScope(input: {
    additionalActions: ApprovalAction[]
    reason?: string
  }): Promise<ApprovalScopeView>
  searchSignatureAccounts(query: SignatureSearchQuery): Promise<SignatureSearchResult>
  findRelatedSignatureAccounts(
    query: RelatedSignatureAccountsQuery,
  ): Promise<RelatedSignatureAccountsResult>
  findSignatureCorrelation(dids: string[]): Promise<SignatureCorrelationResult>
  getAccountGraph(query: AccountGraphQuery): Promise<AccountGraphResult>
  getAccountPosts(query: AccountPostsQuery): Promise<AccountPostsResult>
  listInboxNotifications(
    query: InboxNotificationListQuery,
  ): Promise<InboxNotificationListResult>
  getInboxUnreadCounts(did: string, section?: InboxSection): Promise<InboxUnreadCounts>
  getInboxNotificationPreferences(did: string): Promise<InboxNotificationPreferences>
}

export const ROLE_NSIDS = {
  list: 'com.selfcommand.admin.role.list',
  get: 'com.selfcommand.admin.role.get',
  create: 'com.selfcommand.admin.role.create',
  update: 'com.selfcommand.admin.role.update',
  revoke: 'com.selfcommand.admin.role.revoke',
  import: 'com.selfcommand.admin.role.import',
  export: 'com.selfcommand.admin.role.export',
} as const

export const AUDIT_NSIDS = {
  list: 'com.selfcommand.admin.audit.list',
  export: 'com.selfcommand.admin.audit.export',
} as const

export const ACCOUNT_NSIDS = {
  list: 'com.selfcommand.admin.account.list',
  get: 'com.selfcommand.admin.account.get',
  profileGet: 'com.selfcommand.admin.account.profile.get',
  profileUpdate: 'com.selfcommand.admin.account.profile.update',
  export: 'com.selfcommand.admin.account.export',
  batchExport: 'com.selfcommand.admin.account.batch.export',
  graph: 'com.selfcommand.admin.account.graph',
  posts: 'com.selfcommand.admin.account.posts',
  adminInfo: 'com.selfcommand.admin.account.admin.info',
  adminUpdate: 'com.selfcommand.admin.account.admin.update',
  adminDelete: 'com.selfcommand.admin.account.admin.delete',
  invitesDisable: 'com.selfcommand.admin.account.invites.disable',
} as const

export const SIGNATURE_NSIDS = {
  searchAccounts: 'com.selfcommand.admin.signature.searchAccounts',
  findRelatedAccounts: 'com.selfcommand.admin.signature.findRelatedAccounts',
  findCorrelation: 'com.selfcommand.admin.signature.findCorrelation',
} as const

export const INBOX_NSIDS = {
  listNotifications: 'com.selfcommand.admin.inbox.listNotifications',
  unreadCount: 'com.selfcommand.admin.inbox.getUnreadCount',
  preferences: 'com.selfcommand.admin.inbox.getNotificationPreferences',
} as const

export const SECURITY_NSIDS = {
  accessList: 'com.selfcommand.admin.security.access.list',
  blockedList: 'com.selfcommand.admin.security.blocked.list',
  block: 'com.selfcommand.admin.security.block',
  unblock: 'com.selfcommand.admin.security.unblock',
  self: 'com.selfcommand.admin.security.self',
} as const

export const APPROVAL_NSIDS = {
  list: 'com.selfcommand.admin.approval.list',
  create: 'com.selfcommand.admin.approval.create',
  approve: 'com.selfcommand.admin.approval.approve',
  reject: 'com.selfcommand.admin.approval.reject',
  cancel: 'com.selfcommand.admin.approval.cancel',
} as const

export const DASHBOARD_NSIDS = {
  series: 'com.selfcommand.admin.dashboard.series',
} as const

export const SYSTEM_NSIDS = {
  status: 'com.selfcommand.admin.system.status',
} as const

export const INDEXER_NSIDS = {
  status: 'com.selfcommand.admin.indexer.status',
  pause: 'com.selfcommand.admin.indexer.pause',
  resume: 'com.selfcommand.admin.indexer.resume',
} as const

export const CONTENT_NSIDS = {
  search: 'com.selfcommand.admin.content.search',
  get: 'com.selfcommand.admin.content.get',
  imageSearch: 'com.selfcommand.admin.content.imageSearch',
  export: 'com.selfcommand.admin.content.export',
} as const

export const MODERATION_NSIDS = {
  reportList: 'com.selfcommand.admin.moderation.report.list',
  reportGet: 'com.selfcommand.admin.moderation.report.get',
  reportAct: 'com.selfcommand.admin.moderation.report.act',
  queueList: 'com.selfcommand.admin.moderation.queue.list',
  queueAct: 'com.selfcommand.admin.moderation.queue.act',
  eventList: 'com.selfcommand.admin.moderation.event.list',
  eventGet: 'com.selfcommand.admin.moderation.event.get',
  eventBatchGet: 'com.selfcommand.admin.moderation.events.batch.get',
  statusQuery: 'com.selfcommand.admin.moderation.status.query',
  act: 'com.selfcommand.admin.moderation.act',
  scheduledList: 'com.selfcommand.admin.moderation.scheduled.list',
  scheduledCancel: 'com.selfcommand.admin.moderation.scheduled.cancel',
  accountOverview: 'com.selfcommand.admin.moderation.account.overview',
  random: 'com.selfcommand.admin.moderation.random',
  analytics: 'com.selfcommand.admin.moderation.analytics',
  analyticsExport: 'com.selfcommand.admin.analytics.export',
} as const

export const CHAT_NSIDS = {
  metadata: 'com.selfcommand.admin.chat.metadata',
} as const

export const VERIFICATION_NSIDS = {
  list: 'com.selfcommand.admin.verification.list',
  act: 'com.selfcommand.admin.verification.act',
} as const

export const NOTIFICATION_NSIDS = {
  templateList: 'com.selfcommand.admin.notifications.template.list',
  templateAct: 'com.selfcommand.admin.notifications.template.act',
  send: 'com.selfcommand.admin.notifications.send',
} as const

export const ANNOUNCEMENT_NSIDS = {
  list: 'com.selfcommand.admin.announcement.list',
  get: 'com.selfcommand.admin.announcement.get',
  create: 'com.selfcommand.admin.announcement.create',
  update: 'com.selfcommand.admin.announcement.update',
  publish: 'com.selfcommand.admin.announcement.publish',
  archive: 'com.selfcommand.admin.announcement.archive',
} as const

export const SETTINGS_NSIDS = {
  approvalsGet: 'com.selfcommand.admin.settings.approvals.get',
  approvalsUpdate: 'com.selfcommand.admin.settings.approvals.update',
} as const

export const POLICY_NSIDS = {
  optionList: 'com.selfcommand.admin.policy.option.list',
  optionAct: 'com.selfcommand.admin.policy.option.act',
  setList: 'com.selfcommand.admin.policy.set.list',
  setGet: 'com.selfcommand.admin.policy.set.get',
  setAct: 'com.selfcommand.admin.policy.set.act',
  safelinkList: 'com.selfcommand.admin.policy.safelink.list',
  safelinkEvents: 'com.selfcommand.admin.policy.safelink.events',
  safelinkAct: 'com.selfcommand.admin.policy.safelink.act',
  labelerGet: 'com.selfcommand.admin.policy.labeler.get',
} as const

type QueryValue = string | number | boolean | undefined

export function toParams(values: Record<string, QueryValue>): Record<string, string> {
  const params: Record<string, string> = {}
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === '') continue
    params[key] = String(value)
  }
  return params
}