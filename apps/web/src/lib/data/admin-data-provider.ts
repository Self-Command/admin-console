import type {
  AccountGetResult,
  AccountListResult,
  AuditListResult,
  RoleBinding,
  RoleListResult,
} from '@/lib/data/types'
import {
  ACCOUNT_NSIDS,
  AUDIT_NSIDS,
  ROLE_NSIDS,
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

    updateRole: (input) =>
      callAdmin<{ role: RoleBinding }>(ROLE_NSIDS.update, {
        body: {
          subject: input.subject,
          role: input.role,
          ...(input.note ? { note: input.note } : {}),
        },
      }).then((result) => result.role),

    revokeRole: (subject) =>
      callAdmin<unknown>(ROLE_NSIDS.revoke, { body: { subject } }).then(() => undefined),

    listAudit: (query) =>
      callAdmin<AuditListResult>(AUDIT_NSIDS.list, {
        params: toParams({
          cursor: query.cursor,
          limit: query.limit,
          actor: query.actor,
          action: query.action,
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
        }),
      }),

    getAccount: (did) =>
      callAdmin<AccountGetResult>(ACCOUNT_NSIDS.get, {
        params: toParams({ did }),
      }),
  }
}
