import type { ColumnType, Generated } from 'kysely'

export type RoleName = 'admin' | 'moderator' | 'operator' | 'viewer'

export type AuditResult = 'success' | 'denied' | 'error'

export type AccountStatus =
  | 'active'
  | 'deactivated'
  | 'suspended'
  | 'takendown'
  | 'deleted'
  | 'unknown'

export type AdminRoleTable = {
  did: string
  role: RoleName
  granted_by: string
  note: string | null
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export type AdminAuditEventTable = {
  id: Generated<string>
  created_at: Generated<Date>
  actor_did: string
  action: string
  target_type: string | null
  target_id: string | null
  result: AuditResult
  detail: string | null
  request_id: string | null
  actor_ip: string | null
  user_agent: string | null
  approval_id: ColumnType<string | null, string | null, string | null>
  before: unknown
  after: unknown
}

export type AccountDirectoryTable = {
  did: string
  handle: string | null
  status: Generated<AccountStatus>
  active: boolean | null
  last_event_at: Date | null
  first_seen_at: ColumnType<Date | null, Date | string | null, Date | string | null>
  indexed_at: Generated<Date>
}

export type AccountOperationTable = {
  did: string
  note: ColumnType<string | null, string | null, string | null>
  tags: ColumnType<string[], string, string>
  sync_paused: ColumnType<boolean, boolean, boolean>
  sync_paused_at: ColumnType<Date | null, Date | string | null, Date | string | null>
  sync_paused_by: ColumnType<string | null, string | null, string | null>
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>
  updated_by: ColumnType<string | null, string | null, string | null>
}

export type AdminAccessTable = {
  did: string
  ip: string
  user_agent: ColumnType<string, string, string>
  first_seen_at: ColumnType<Date, Date | string | undefined, Date | string>
  last_seen_at: ColumnType<Date, Date | string | undefined, Date | string>
  request_count: ColumnType<number, number | undefined, number>
}

export type AdminAccessBlockTable = {
  did: string
  blocked_by: string
  reason: ColumnType<string | null, string | null, string | null>
  blocked_at: ColumnType<Date, Date | string | undefined, Date | string>
}

export type ApprovalActionName =
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

export type AdminApprovalTable = {
  id: string
  action: ColumnType<ApprovalActionName, ApprovalActionName, ApprovalActionName>
  target_type: ColumnType<string | null, string | null, string | null>
  target: ColumnType<string | null, string | null, string | null>
  summary: ColumnType<string | null, string | null, string | null>
  payload: ColumnType<unknown, unknown, unknown>
  payload_hash: string
  status: ColumnType<ApprovalStatus, ApprovalStatus | undefined, ApprovalStatus>
  requested_by: string
  requested_at: ColumnType<Date, Date | string | undefined, Date | string>
  decided_by: ColumnType<string | null, string | null, string | null>
  decided_at: ColumnType<Date | null, Date | string | null, Date | string | null>
  expires_at: ColumnType<Date, Date | string, Date | string>
  error: ColumnType<string | null, string | null, string | null>
}

export type DailyMetricTable = {
  day: string
  accounts_total: ColumnType<number, number | undefined, number>
  accounts_new: ColumnType<number, number | undefined, number>
  accounts_active_24h: ColumnType<number, number | undefined, number>
  status_counts: ColumnType<Record<string, number>, Record<string, number>, Record<string, number>>
  audit_total: ColumnType<number, number | undefined, number>
  audit_denied: ColumnType<number, number | undefined, number>
  generated_at: ColumnType<Date, Date | string | undefined, Date | string>
}

export type AdminAnnouncementTable = {
  id: Generated<string>
  title: string
  body: string
  level: string
  placement: string
  status: ColumnType<'draft' | 'published' | 'archived', 'draft' | 'published' | 'archived' | undefined, 'draft' | 'published' | 'archived'>
  starts_at: ColumnType<Date | null, Date | string | null, Date | string | null>
  ends_at: ColumnType<Date | null, Date | string | null, Date | string | null>
  created_by: string
  published_by: ColumnType<string | null, string | null, string | null>
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export type IndexerCursorTable = {
  stream: string
  cursor: ColumnType<string | null, string | null, string | null>
  backfill_complete: Generated<boolean>
  paused: Generated<boolean>
  paused_by: string | null
  paused_at: Date | null
  last_indexed_at: Date | null
  last_event_at: Date | null
  connected: Generated<boolean>
  updated_at: Generated<Date>
}

export type AdminSettingTable = {
  section: string
  version: number
  values: unknown
  updated_by: string | null
  updated_at: Generated<Date>
}

export type AdminSettingRevisionTable = {
  id: Generated<string>
  section: string
  version: number
  actor_did: string
  reason: string | null
  request_id: string | null
  before: unknown
  after: unknown
  created_at: Generated<Date>
}

export type AdminUserPreferenceTable = {
  did: string
  preferences: unknown
  updated_at: Generated<Date>
}

export type AdminBrandingAssetTable = {
  id: string
  mime: string
  bytes: Buffer
  version: number
  updated_by: string | null
  updated_at: Generated<Date>
}

export type Database = {
  'admin.admin_role': AdminRoleTable
  'admin.admin_audit_event': AdminAuditEventTable
  'admin.account_directory': AccountDirectoryTable
  'admin.indexer_cursor': IndexerCursorTable
  'admin.admin_setting': AdminSettingTable
  'admin.admin_setting_revision': AdminSettingRevisionTable
  'admin.admin_user_preference': AdminUserPreferenceTable
  'admin.admin_branding_asset': AdminBrandingAssetTable
  'admin.account_operation': AccountOperationTable
  'admin.admin_access': AdminAccessTable
  'admin.admin_access_block': AdminAccessBlockTable
  'admin.admin_approval': AdminApprovalTable
  'admin.admin_announcement': AdminAnnouncementTable
  'admin.daily_metric': DailyMetricTable
}
