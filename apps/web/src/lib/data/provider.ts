import type {
  AccountGetResult,
  AccountListQuery,
  AccountListResult,
  AuditListQuery,
  AuditListResult,
  RoleBinding,
  RoleListQuery,
  RoleListResult,
  RoleWriteInput,
} from '@/lib/data/types'

export type CallAdmin = <T>(
  nsid: string,
  options?: { params?: Record<string, string>; body?: unknown },
) => Promise<T>

export interface DataProvider {
  readonly kind: 'admin' | 'preview'
  readonly canWrite: boolean
  listRoles(query: RoleListQuery): Promise<RoleListResult>
  getRole(subject: string): Promise<RoleBinding>
  createRole(input: RoleWriteInput): Promise<RoleBinding>
  updateRole(input: RoleWriteInput): Promise<RoleBinding>
  revokeRole(subject: string): Promise<void>
  listAudit(query: AuditListQuery): Promise<AuditListResult>
  listAccounts(query: AccountListQuery): Promise<AccountListResult>
  getAccount(did: string): Promise<AccountGetResult>
}

export const ROLE_NSIDS = {
  list: 'com.selfcommand.admin.role.list',
  get: 'com.selfcommand.admin.role.get',
  create: 'com.selfcommand.admin.role.create',
  update: 'com.selfcommand.admin.role.update',
  revoke: 'com.selfcommand.admin.role.revoke',
} as const

export const AUDIT_NSIDS = {
  list: 'com.selfcommand.admin.audit.list',
} as const

export const ACCOUNT_NSIDS = {
  list: 'com.selfcommand.admin.account.list',
  get: 'com.selfcommand.admin.account.get',
} as const

type QueryValue = string | number | undefined

export function toParams(values: Record<string, QueryValue>): Record<string, string> {
  const params: Record<string, string> = {}
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === '') continue
    params[key] = String(value)
  }
  return params
}
