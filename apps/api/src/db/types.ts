import type { ColumnType, Generated } from 'kysely'

export type RoleName = 'admin' | 'operator' | 'viewer'

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
}

export type AccountDirectoryTable = {
  did: string
  handle: string | null
  status: Generated<AccountStatus>
  active: boolean | null
  last_event_at: Date | null
  indexed_at: Generated<Date>
}

export type IndexerCursorTable = {
  stream: string
  cursor: ColumnType<string | null, string | null, string | null>
  backfill_complete: Generated<boolean>
  updated_at: Generated<Date>
}

export type Database = {
  'admin.admin_role': AdminRoleTable
  'admin.admin_audit_event': AdminAuditEventTable
  'admin.account_directory': AccountDirectoryTable
  'admin.indexer_cursor': IndexerCursorTable
}
