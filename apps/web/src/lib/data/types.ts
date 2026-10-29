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
  createdAt: string
}

export type PageQuery = {
  cursor?: string
  limit?: number
}

export type RoleListQuery = PageQuery & {
  role?: RoleName
  search?: string
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

export type AuditListQuery = PageQuery & {
  actor?: string
  action?: string
  result?: AuditResult
  since?: string
  until?: string
}

export type AuditListResult = {
  events: AuditEvent[]
  total: number
  cursor?: string
}

export type AccountListQuery = PageQuery & {
  search?: string
  status?: AccountStatus
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
