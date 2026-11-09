import type { RoleName } from '@/lib/roles'

export type RoleBinding = {
  subject: string
  role: RoleName
  grantedBy: string
  note?: string
  createdAt: string
  updatedAt: string
}

export type AccountStatus =
  | 'active'
  | 'deactivated'
  | 'suspended'
  | 'takendown'
  | 'deleted'
  | 'unknown'

export type Account = {
  did: string
  handle?: string
  status: AccountStatus
  lastEventAt?: string
  indexedAt: string
}

export type IndexerStatus = {
  enabled?: boolean
  paused?: boolean
  pausedBy?: string
  pausedAt?: string
  connected?: boolean
  backfillComplete: boolean
  lastEventAt?: string
  lastIndexedAt?: string
  cursor?: string
}

export type AuditResult = 'success' | 'denied' | 'error'

export type AuditEvent = {
  id: number | string
  action: string
  actor: string
  result: AuditResult
  targetType?: string
  target?: string
  detail?: string
  requestId?: string
  actorIp?: string
  userAgent?: string
  before?: unknown
  after?: unknown
  createdAt: string
}

export type PageQuery = {
  cursor?: string
  limit?: number
}

export type RoleSort = 'subject' | 'role' | 'createdAt' | 'updatedAt'
export type AuditSort = 'createdAt' | 'actor' | 'action' | 'result'
export type AccountSort = 'did' | 'handle' | 'status' | 'indexedAt'
export type SortOrder = 'asc' | 'desc'

export type RoleListQuery = PageQuery & {
  role?: RoleName
  search?: string
  sort?: RoleSort
  order?: SortOrder
}

export type RoleListResult = {
  roles: RoleBinding[]
  total: number
  cursor?: string
}

export type RoleWriteInput = {
  subject: string
  role: RoleName
  note?: string
}

export type RoleWriteOptions = {
  approvalId?: string
}

export type AuditListQuery = PageQuery & {
  actor?: string
  action?: string
  target?: string
  result?: AuditResult
  since?: string
  until?: string
  sort?: AuditSort
  order?: SortOrder
}

export type AuditListResult = {
  events: AuditEvent[]
  total: number
  cursor?: string
}

export type AuditExportResult = {
  filename: string
  contentType: string
  content: string
  rows: number
}

export type RoleImportItem = RoleWriteInput

export type RoleImportResult = {
  imported: number
  batchId: string
}

export type RoleExportResult = {
  bindings: RoleBinding[]
  total: number
  exportedAt: string
}

export type AccountListQuery = PageQuery & {
  search?: string
  status?: AccountStatus
  sort?: AccountSort
  order?: SortOrder
}

export type AccountListResult = {
  accounts: Account[]
  total: number
  indexer: IndexerStatus
  cursor?: string
}

export type AccountGetResult = {
  account: Account
  indexer: IndexerStatus
}

export type SystemComponentStatus = 'ok' | 'degraded' | 'unavailable'

export type SystemServiceStatus = SystemComponentStatus | 'disabled' | 'unknown'

export type SystemComponent = {
  name: string
  status: SystemComponentStatus
  latencyMs?: number
  checkedAt?: string
  detail?: string
}

export type ExternalServiceStatus = {
  key: 'image-search' | 'chat' | 'email' | 'labeler'
  name: string
  status: SystemServiceStatus
  detail?: string
  checkedAt?: string
}

export type MigrationInfo = {
  executed: string[]
  pending: string[]
}

export type SystemStatus = {
  version: string
  commit?: string
  startedAt: string
  uptimeSeconds: number
  database: SystemComponent
  migrations: MigrationInfo
  indexer: IndexerStatus
  pds: SystemComponent
  ozone: SystemComponent
  appview: SystemComponent
  ozoneDaemon: SystemComponent
  externalServices?: ExternalServiceStatus[]
}

export type AccountOperation = {
  did: string
  note?: string
  tags: string[]
  syncPaused: boolean
  syncPausedAt?: string
  syncPausedBy?: string
  updatedAt?: string
  updatedBy?: string
}

export type AccountProfileResult = {
  operation: AccountOperation
  account?: Account
}

export type AccountProfileInput = {
  did: string
  note?: string
  tags?: string[]
  syncPaused?: boolean
}

export type AccountExportResult = {
  document: Record<string, unknown>
}

export type AccountBatchExportFormat = 'json' | 'csv'

export type AccountBatchExportResult = {
  count: number
  format: string
  content: string
}

export type AccessRecord = {
  did: string
  ip: string
  userAgent?: string
  firstSeenAt: string
  lastSeenAt: string
  requestCount: number
}

export type AccessBlock = {
  did: string
  blockedBy: string
  reason?: string
  blockedAt: string
}

export type AccessListQuery = PageQuery & {
  did?: string
}

export type AccessListResult = {
  records: AccessRecord[]
  total: number
  cursor?: string
}

export type AccessBlockListQuery = PageQuery

export type AccessBlockListResult = {
  blocks: AccessBlock[]
  total: number
  cursor?: string
}

export type SelfAccess = {
  blocked: boolean
  blockedAt?: string
  blockedBy?: string
  reason?: string
  records: AccessRecord[]
}

export type ApprovalAction =
  | 'settings.resetAll'
  | 'role.revoke'
  | 'role.demote'
  | 'role.import'
  | 'moderation.takedown'
  | 'moderation.batch'
  | 'moderation.label'
  | 'verification.grant'
  | 'verification.revoke'
  | 'account.admin.update'
  | 'account.admin.delete'
  | 'notifications.send'
  | 'policy.write'
  | 'announcement.publish'
  | 'announcement.archive'

export type ApprovalStatus =
  | 'pending'
  | 'executed'
  | 'rejected'
  | 'cancelled'
  | 'expired'
  | 'failed'

export type Approval = {
  id: string
  action: ApprovalAction
  targetType?: string
  target?: string
  summary?: string
  status: ApprovalStatus
  requestedBy: string
  requestedAt: string
  decidedBy?: string
  decidedAt?: string
  expiresAt: string
  error?: string
}

export type ApprovalListQuery = PageQuery & {
  status?: ApprovalStatus
}

export type ApprovalListResult = {
  approvals: Approval[]
  total: number
  cursor?: string
}

export type ApprovalCreateInput = {
  action: ApprovalAction
  targetType?: string
  target?: string
  summary?: string
  payload: Record<string, unknown>
}

export type ApprovalScopeView = {
  builtInActions: ApprovalAction[]
  additionalActions: ApprovalAction[]
  availableActions: ApprovalAction[]
  version: number
  updatedAt?: string
}

export type MetricStatusCounts = {
  active: number
  deactivated: number
  suspended: number
  takendown: number
  deleted: number
  unknown: number
}

export type DailyMetric = {
  day: string
  accountsTotal: number
  accountsNew: number
  accountsActive24h: number
  statusCounts: MetricStatusCounts
  auditTotal: number
  auditDenied: number
}

export type DashboardDays = 7 | 30 | 90

export type DashboardSeriesResult = {
  days: number
  points: DailyMetric[]
  indexerEnabled: boolean
  generatedAt?: string
}

export type ReportStatus = 'open' | 'closed' | 'escalated' | 'queued' | 'assigned'

export type ReportAction = 'assign' | 'unassign' | 'close' | 'escalate' | 'reopen'

export type ModerationSubjectType = 'account' | 'record' | 'message' | 'conversation'

export type ModerationAction =
  | 'takedown'
  | 'reverseTakedown'
  | 'acknowledge'
  | 'escalate'
  | 'comment'
  | 'label'
  | 'mute'
  | 'unmute'

export type ReportView = {
  id: number
  status: ReportStatus
  subject: string
  subjectType?: ModerationSubjectType
  reportType: string
  reportedBy: string
  reporterHandle?: string
  subjectHandle?: string
  comment?: string
  createdAt: string
  updatedAt?: string
  queueId?: number
  priorityScore?: number
  actionNote?: string
  assignedTo?: string
  closedBy?: string
  closedAt?: string
  eventId?: number
  relatedReportCount?: number
}

export type EventView = {
  id: number
  eventType: string
  subject: string
  subjectType?: ModerationSubjectType
  createdBy: string
  creatorHandle?: string
  subjectHandle?: string
  createdAt: string
  comment?: string
  reportId?: number
  durationInHours?: number
  labels?: string[]
}

export type QueueStats = {
  pendingCount?: number
  closedCount?: number
  escalatedCount?: number
  inboundCount?: number
  actionedCount?: number
  acknowledgedCount?: number
}

export type QueueView = {
  id: number
  name: string
  description?: string
  enabled: boolean
  subjectTypes?: ModerationSubjectType[]
  collection?: string
  reportTypes?: string[]
  createdBy?: string
  createdAt: string
  updatedAt: string
  stats?: QueueStats
}

export type ScheduledActionStatus = 'pending' | 'executed' | 'cancelled' | 'failed'

export type ScheduledActionView = {
  id: number
  action: string
  subject: string
  status: ScheduledActionStatus
  executeAt?: string
  executeAfter?: string
  executeUntil?: string
  comment?: string
  createdBy: string
  createdAt: string
  updatedAt?: string
  lastFailureReason?: string
}

export type AccountOverview = {
  did: string
  handle?: string
  status?: AccountStatus
  reviewState?: string
  takendown?: boolean
  muted?: boolean
  lastReviewedAt?: string
  lastReportedAt?: string
  eventCount?: number
  openReportCount?: number
  labels?: string[]
}

export type InviteCodeView = {
  code: string
  available: number
  disabled: boolean
  createdBy?: string
  createdAt?: string
  usesCount: number
}

export type AccountAdminInfo = {
  did: string
  handle?: string
  email?: string
  emailConfirmed?: boolean
  invitesDisabled?: boolean
  invitedBy?: InviteCodeView
  invites?: InviteCodeView[]
  deactivatedAt?: string
  indexedAt?: string
  takedown?: boolean
}

export type AccountAdminUpdateInput = {
  did: string
  email?: string
  handle?: string
  password?: string
}

export type InviteDisableInput = {
  did?: string
  codes?: string[]
}

export type ContentView = {
  uri: string
  cid?: string
  author: string
  authorHandle?: string
  text?: string
  collection?: string
  indexedAt?: string
  hidden: boolean
  reviewState?: string
  labels?: string[]
  likeCount?: number
  repostCount?: number
  replyCount?: number
}

export type ImageResult = {
  imageUrl: string
  thumbnailUrl?: string
  postUri?: string
  author?: string
  description?: string
  score?: number
}

export type AnalyticsSummary = {
  pendingCount: number
  closedCount: number
  escalatedCount: number
  inboundCount: number
  actionedCount: number
  acknowledgedCount: number
  closureTargetMetRate?: number
  closureTargetOverdueCount?: number
}

export type AnalyticsDay = {
  day: string
  pendingCount?: number
  closedCount?: number
  escalatedCount?: number
  inboundCount?: number
  actionedCount?: number
  acknowledgedCount?: number
}

export type ChatMetadata = {
  enabled: boolean
  reason?: string
}

export type ReportListQuery = PageQuery & {
  status?: ReportStatus
  queueId?: number
  subject?: string
  did?: string
  subjectType?: ModerationSubjectType
  reportedAfter?: string
  reportedBefore?: string
  assignedTo?: string
  sort?: 'createdAt' | 'updatedAt'
  direction?: SortOrder
}

export type ReportListResult = {
  reports: ReportView[]
  cursor?: string
}

export type ReportGetResult = {
  report: ReportView
  detail?: unknown
}

export type ReportActInput = {
  reportId: number
  action: ReportAction
  queueId?: number
  scope?: 'current' | 'all' | 'types'
  reportTypes?: string[]
  did?: string
  comment?: string
}

export type ReportActResult = {
  ok: boolean
  closedCount?: number
  assignment?: unknown
}

export type EventListQuery = PageQuery & {
  subject?: string
  did?: string
  types?: string[]
  createdBy?: string
  createdAfter?: string
  createdBefore?: string
  hasComment?: boolean
  comment?: string
  direction?: SortOrder
  batchId?: string
}

export type EventListResult = {
  events: EventView[]
  cursor?: string
}

export type EventGetResult = {
  event: unknown
}

export type ReviewState = 'open' | 'closed' | 'escalated' | 'none'

export type StatusView = {
  id: number
  subject: string
  subjectType?: ModerationSubjectType
  subjectHandle?: string
  reviewState: ReviewState
  takendown?: boolean
  muted?: boolean
  comment?: string
  priorityScore?: number
  lastReportedAt?: string
  lastReviewedAt?: string
  lastReviewedBy?: string
  tags?: string[]
  createdAt: string
  updatedAt: string
}

export type StatusQuery = PageQuery & {
  subject?: string
  subjectType?: ModerationSubjectType
  reviewState?: ReviewState
  takendown?: boolean
  lastReviewedBy?: string
  reportedAfter?: string
  reportedBefore?: string
  reviewedAfter?: string
  reviewedBefore?: string
}

export type StatusQueryResult = {
  statuses: StatusView[]
  cursor?: string
}

export type EventTypeCount = {
  eventType: string
  count: number
}

export type EventBatchSummary = {
  batchId: string
  totalEvents: number
  scannedEvents: number
  truncated: boolean
  createdAfter?: string
  createdBefore?: string
  typeCounts: EventTypeCount[]
  createdBy?: string[]
}

export type QueueListQuery = PageQuery & {
  enabled?: boolean
}

export type QueueListResult = {
  queues: QueueView[]
  cursor?: string
}

export type QueueActInput = {
  action: 'create' | 'update' | 'delete' | 'assign' | 'unassign' | 'route'
  queueId?: number
  name?: string
  description?: string
  enabled?: boolean
  subjectTypes?: ModerationSubjectType[]
  collection?: string
  reportTypes?: string[]
  did?: string
  startReportId?: number
  endReportId?: number
  migrateToQueueId?: number
}

export type QueueActResult = {
  queue?: QueueView
  deleted?: boolean
  reportsMigrated?: number
  assigned?: number
  unmatched?: number
}

export type ScheduledListQuery = PageQuery & {
  statuses?: ScheduledActionStatus[]
  subjects?: string[]
}

export type ScheduledListResult = {
  actions: ScheduledActionView[]
  cursor?: string
}

export type ScheduledCancelInput = {
  subjects: string[]
  comment?: string
}

export type ScheduledCancelResult = {
  results?: unknown
}

export type AccountModerationResult = {
  overview: AccountOverview
  status?: unknown
  events: EventView[]
  reports: ReportView[]
}

export type ContentSearchQuery = PageQuery & {
  q: string
  author?: string
  mention?: string
  lang?: string
  domain?: string
  url?: string
  tag?: string
  since?: string
  until?: string
  sort?: 'latest' | 'top'
}

export type ContentSearchResult = {
  content: ContentView[]
  cursor?: string
  moderationAvailable: boolean
}

export type ContentGetResult = {
  record: ContentView
  status?: unknown
  events: EventView[]
  reports: ReportView[]
  moderationAvailable: boolean
}

export type ContentExportQuery = Omit<ContentSearchQuery, 'cursor' | 'limit'>

export type ContentExportResult = {
  filename: string
  contentType: string
  content: string
  rows: number
  truncated: boolean
  limit: number
}

export type ImageSearchQuery = PageQuery & {
  q: string
}

export type ImageSearchResult = {
  results: ImageResult[]
  cursor?: string
  total: number
}

export type ModerationActInput = {
  subjects: string[]
  action: ModerationAction
  comment?: string
  reason?: string
  labels?: string[]
  durationInHours?: number
  reportId?: number
  acknowledgeAccountSubjects?: boolean
  approvalId?: string
}

export type ModerationActResult = {
  events: Array<{ subject: string; eventId: number }>
  failed: Array<{ subject: string; message: string }>
}

export type ModerationAnalyticsResult = {
  summary: AnalyticsSummary
  days: AnalyticsDay[]
}

export type AnalyticsExportResult = {
  filename: string
  contentType: string
  content: string
  rows: number
}

export type VerificationView = {
  uri: string
  issuer: string
  subject: string
  handle?: string
  displayName?: string
  createdAt: string
  isActive: boolean
  revokeReason?: string
}

export type VerificationListQuery = PageQuery & {
  subject?: string
  isRevoked?: boolean
  createdAfter?: string
  createdBefore?: string
  sortDirection?: SortOrder
}

export type VerificationListResult = {
  verifications: VerificationView[]
  cursor?: string
}

export type VerificationGrantInput = {
  subject: string
  handle: string
  displayName: string
}

export type VerificationActInput = {
  action: 'grant' | 'revoke'
  verifications?: VerificationGrantInput[]
  uris?: string[]
  reason?: string
  approvalId?: string
}

export type VerificationFailure = {
  subject?: string
  uri?: string
  message: string
}

export type VerificationActResult = {
  verified: VerificationView[]
  revoked: string[]
  failed: VerificationFailure[]
}

export type NotificationTemplate = {
  id: string
  name: string
  subject: string
  contentMarkdown: string
  lang?: string
  disabled: boolean
  createdAt?: string
  updatedAt?: string
}

export type TemplateListResult = {
  templates: NotificationTemplate[]
  sendAvailable: boolean
  sendUnavailableReason?: string
}

export type TemplateActInput = {
  action: 'create' | 'update' | 'delete'
  id?: string
  name?: string
  subject?: string
  contentMarkdown?: string
  lang?: string
  disabled?: boolean
}

export type TemplateActResult = {
  template?: NotificationTemplate
}

export type NotificationSendInput = {
  recipients: string[]
  subject: string
  contentMarkdown: string
  templateId?: string
  approvalId?: string
}

export type NotificationSendResult = {
  sent: number
  failed: Array<{ recipient: string; message: string }>
}

export type PolicyScope = 'instance' | 'personal'

export type PolicyOption = {
  key: string
  scope: PolicyScope
  value?: unknown
  description?: string
  managerRole?: string
  updatedAt?: string
  updatedBy?: string
}

export type PolicyOptionListQuery = PageQuery & {
  scope?: PolicyScope
  keys?: string[]
  prefix?: string
}

export type PolicyOptionListResult = {
  options: PolicyOption[]
  cursor?: string
}

export type PolicySetView = {
  name: string
  description?: string
  valuesCount?: number
  createdAt?: string
  updatedAt?: string
}

export type PolicySetListQuery = PageQuery & {
  namePrefix?: string
}

export type PolicySetListResult = {
  sets: PolicySetView[]
  cursor?: string
}

export type PolicySetGetQuery = PageQuery & {
  name: string
}

export type PolicySetGetResult = {
  set: PolicySetView
  values: string[]
  cursor?: string
}

export type PolicyOperation =
  | 'option.upsert'
  | 'option.remove'
  | 'set.upsert'
  | 'set.addValues'
  | 'set.deleteValues'
  | 'set.delete'
  | 'safelink.add'
  | 'safelink.update'
  | 'safelink.remove'

export type PolicyActInput = {
  operation: PolicyOperation
  input: Record<string, unknown>
  approvalId?: string
}

export type PolicyOptionActResult = {
  option?: PolicyOption
}

export type PolicySetActResult = {
  set?: PolicySetView
}

export type SafelinkPattern = 'domain' | 'url'
export type SafelinkAction = 'block' | 'warn' | 'whitelist'
export type SafelinkReason = 'csam' | 'spam' | 'phishing' | 'none'

export type SafelinkRule = {
  url: string
  pattern: string
  action: string
  reason: string
  source?: string
  comment?: string
  createdAt?: string
  updatedAt?: string
}

export type SafelinkEvent = SafelinkRule & {
  id?: number
  createdBy?: string
  createdAt: string
}

export type SafelinkListQuery = PageQuery & {
  urls?: string[]
  patternType?: SafelinkPattern
  actions?: SafelinkAction[]
  reason?: SafelinkReason
  source?: string
}

export type SafelinkListResult = {
  rules: SafelinkRule[]
  cursor?: string
}

export type SafelinkEventsQuery = PageQuery & {
  urls?: string[]
  patternType?: SafelinkPattern
}

export type SafelinkEventsResult = {
  events: SafelinkEvent[]
  cursor?: string
}

export type SafelinkActResult = {
  event?: SafelinkEvent
}

export type LabelerConfig = {
  available: boolean
  did?: string
  handle?: string
  displayName?: string
  description?: string
  policies?: unknown
  labels?: unknown
  reason?: string
}

export type AnnouncementLevel = 'info' | 'warning' | 'critical'
export type AnnouncementPlacement = 'admin' | 'app'
export type AnnouncementStatus = 'draft' | 'published' | 'archived'

export type AnnouncementView = {
  id: number
  title: string
  body: string
  level: AnnouncementLevel
  placement: AnnouncementPlacement
  status: AnnouncementStatus
  startsAt?: string
  endsAt?: string
  createdBy?: string
  publishedBy?: string
  createdAt: string
  updatedAt: string
}

export type AnnouncementListQuery = PageQuery & {
  status?: AnnouncementStatus
  placement?: AnnouncementPlacement
  q?: string
  sort?: 'createdAt' | 'updatedAt' | 'startsAt'
  direction?: SortOrder
}

export type AnnouncementListResult = {
  announcements: AnnouncementView[]
  cursor?: string
}

export type AnnouncementGetResult = {
  announcement: AnnouncementView
}

export type AnnouncementInput = {
  title: string
  body: string
  level: AnnouncementLevel
  placement: AnnouncementPlacement
  startsAt?: string
  endsAt?: string
}

export type AnnouncementMutationResult = {
  announcement: AnnouncementView
}

export type AnnouncementStatusInput = {
  id: number
  approvalId?: string
  reason?: string
}

export type SignatureDetail = {
  property: string
  value: string
}

export type SignatureAccount = {
  did: string
  handle: string
  email?: string
  indexedAt: string
  invitesDisabled?: boolean
  emailConfirmedAt?: string
  inviteNote?: string
  deactivatedAt?: string
  threatSignatures?: SignatureDetail[]
}

export type RelatedSignatureAccount = {
  account: SignatureAccount
  similarities?: SignatureDetail[]
}

export type SignatureSearchQuery = {
  values: string[]
  cursor?: string
  limit?: number
}

export type SignatureSearchResult = {
  accounts: SignatureAccount[]
  cursor?: string
}

export type RelatedSignatureAccountsQuery = {
  did: string
  cursor?: string
  limit?: number
}

export type RelatedSignatureAccountsResult = {
  accounts: RelatedSignatureAccount[]
  cursor?: string
}

export type SignatureCorrelationResult = {
  details: SignatureDetail[]
}

export type AccountGraphKind = 'follows' | 'followers' | 'blocks' | 'lists'

export type AccountSummary = {
  did: string
  handle: string
  displayName?: string
  description?: string
  avatar?: string
  createdAt?: string
}

export type AccountListSummary = {
  uri: string
  cid: string
  name: string
  purpose: string
  description?: string
  avatar?: string
  listItemCount?: number
  indexedAt: string
}

export type AccountGraphQuery = {
  did: string
  kind: AccountGraphKind
  cursor?: string
  limit?: number
}

export type AccountGraphResult = {
  accounts?: AccountSummary[]
  lists?: AccountListSummary[]
  cursor?: string
}

export type AccountPostsFilter = 'posts' | 'withReplies' | 'withMedia'

export type AccountPost = {
  uri: string
  cid: string
  text: string
  indexedAt: string
  visibility: 'available' | 'notFound' | 'blocked' | 'unavailable'
  replyParentUri?: string
  embedType?: string
}

export type AccountPostsQuery = {
  did: string
  filter?: AccountPostsFilter
  cursor?: string
  limit?: number
}

export type AccountPostsResult = {
  posts: AccountPost[]
  cursor?: string
}

export type InboxSection = 'reports' | 'subjects' | 'accountStatus'

export type InboxNotificationReason =
  | 'reportResolved'
  | 'reportReopened'
  | 'actionTaken'
  | 'actionReversed'
  | 'appealResolved'
  | 'standingChanged'

export type InboxNotificationTarget = {
  type: 'report' | 'subject' | 'standing' | 'unknown'
  reportId?: number
  subject?: string
  status?: string
  actionType?: string
  actionId?: number
  standing?: string
  previousStanding?: string
  appealOutcome?: string
}

export type InboxNotification = {
  id: number
  reason: InboxNotificationReason | string
  section?: InboxSection
  target: InboxNotificationTarget
  isRead: boolean
  createdAt: string
}

export type InboxNotificationListQuery = {
  did: string
  section?: InboxSection
  reasons?: string[]
  unreadOnly?: boolean
  cursor?: string
  limit?: number
}

export type InboxNotificationListResult = {
  notifications: InboxNotification[]
  cursor?: string
}

export type InboxUnreadCounts = {
  total: number
  reports?: number
  subjects?: number
  accountStatus?: number
}

export type InboxNotificationPreferences = {
  reports: boolean
  account: boolean
  labels: boolean
}
