import { AdminApiError } from '@/lib/api/admin-client'
import type {
  Account,
  AccountGetResult,
  AccountListResult,
  AuditEvent,
  AuditListResult,
  RoleBinding,
  RoleListResult,
} from '@/lib/data/types'
import type { DataProvider } from '@/lib/data/provider'
import {
  previewAccounts,
  previewAuditEvents,
  previewIndexer,
  previewRoles,
} from '@/lib/preview-data'
import type { RoleName } from '@/lib/roles'

const DID_PATTERN = /^did:(plc|web):[A-Za-z0-9._:%-]+$/
const PREVIEW_ACTOR = 'did:web:ops.selfcommand.example'

type Store = {
  roles: RoleBinding[]
  accounts: Account[]
  audit: AuditEvent[]
  nextAuditId: number
}

function createStore(): Store {
  return {
    roles: previewRoles.map((binding) => ({ ...binding })),
    accounts: previewAccounts.map((account) => ({ ...account })),
    audit: previewAuditEvents.map((event) => ({ ...event })),
    nextAuditId: 1000,
  }
}

function cursorStart(cursor: string | undefined): number {
  const value = Number(cursor)
  return Number.isInteger(value) && value >= 0 ? value : 0
}

function pageSlice<T>(items: T[], cursor: string | undefined, limit: number) {
  const start = cursorStart(cursor)
  const slice = items.slice(start, start + limit)
  return {
    slice,
    cursor: start + limit < items.length ? String(start + limit) : undefined,
  }
}

function assertValidDid(subject: string) {
  if (!DID_PATTERN.test(subject)) {
    throw new AdminApiError('validation', 400, 'InvalidRequest')
  }
}

export function createPreviewDataProvider(): DataProvider {
  const store = createStore()

  function findRole(subject: string): RoleBinding {
    const binding = store.roles.find((item) => item.subject === subject)
    if (!binding) throw new AdminApiError('not_found', 404, 'RoleNotFound')
    return binding
  }

  function assertNotLastAdmin(current: RoleName, next?: RoleName) {
    if (current !== 'admin' || next === 'admin') return
    const admins = store.roles.filter((item) => item.role === 'admin').length
    if (admins <= 1) throw new AdminApiError('conflict', 409, 'LastAdmin')
  }

  function recordAudit(action: string, target: string, detail: string) {
    store.audit.unshift({
      id: `preview_${store.nextAuditId++}`,
      action,
      actor: PREVIEW_ACTOR,
      result: 'success',
      targetType: 'role',
      target,
      detail,
      createdAt: new Date().toISOString(),
    })
  }

  return {
    kind: 'preview',
    canWrite: true,

    async listRoles(query): Promise<RoleListResult> {
      const search = query.search?.trim().toLowerCase()
      const roles = store.roles
        .filter((binding) => !query.role || binding.role === query.role)
        .filter((binding) => {
          if (!search) return true
          return [binding.subject, binding.note ?? '', binding.grantedBy].some((value) =>
            value.toLowerCase().includes(search),
          )
        })
        .sort((left, right) => left.subject.localeCompare(right.subject))
      const { slice, cursor } = pageSlice(roles, query.cursor, query.limit ?? 50)
      return { roles: slice, total: roles.length, ...(cursor ? { cursor } : {}) }
    },

    async getRole(subject) {
      return { ...findRole(subject) }
    },

    async createRole(input) {
      assertValidDid(input.subject)
      if (store.roles.some((binding) => binding.subject === input.subject)) {
        throw new AdminApiError('conflict', 409, 'RoleExists')
      }
      const now = new Date().toISOString()
      const binding: RoleBinding = {
        subject: input.subject,
        role: input.role,
        grantedBy: PREVIEW_ACTOR,
        ...(input.note ? { note: input.note } : {}),
        createdAt: now,
        updatedAt: now,
      }
      store.roles.push(binding)
      recordAudit('com.selfcommand.admin.role.create', input.subject, `授予 ${input.role}`)
      return { ...binding }
    },

    async updateRole(input) {
      const binding = findRole(input.subject)
      assertValidDid(input.subject)
      assertNotLastAdmin(binding.role, input.role)
      binding.role = input.role
      binding.note = input.note
      binding.updatedAt = new Date().toISOString()
      recordAudit('com.selfcommand.admin.role.update', input.subject, `改为 ${input.role}`)
      return { ...binding }
    },

    async revokeRole(subject) {
      const binding = findRole(subject)
      assertValidDid(subject)
      assertNotLastAdmin(binding.role, undefined)
      store.roles = store.roles.filter((item) => item.subject !== subject)
      recordAudit('com.selfcommand.admin.role.revoke', subject, '撤销角色')
    },

    async listAudit(query): Promise<AuditListResult> {
      const events = store.audit
        .filter((event) => !query.actor || event.actor === query.actor)
        .filter((event) => !query.action || event.action === query.action)
        .filter((event) => !query.result || event.result === query.result)
        .filter(
          (event) =>
            !query.since || new Date(event.createdAt).getTime() >= new Date(query.since).getTime(),
        )
        .filter(
          (event) =>
            !query.until || new Date(event.createdAt).getTime() <= new Date(query.until).getTime(),
        )
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      const { slice, cursor } = pageSlice(events, query.cursor, query.limit ?? 50)
      return { events: slice, total: events.length, ...(cursor ? { cursor } : {}) }
    },

    async listAccounts(query): Promise<AccountListResult> {
      const search = query.search?.trim().toLowerCase()
      const accounts = store.accounts
        .filter((account) => !query.status || account.status === query.status)
        .filter((account) => {
          if (!search) return true
          return (
            account.did.toLowerCase().startsWith(search) ||
            (account.handle?.toLowerCase().includes(search) ?? false)
          )
        })
        .sort((left, right) => left.did.localeCompare(right.did))
      const { slice, cursor } = pageSlice(accounts, query.cursor, query.limit ?? 50)
      return {
        accounts: slice,
        total: accounts.length,
        indexer: { ...previewIndexer },
        ...(cursor ? { cursor } : {}),
      }
    },

    async getAccount(did): Promise<AccountGetResult> {
      const account = store.accounts.find((item) => item.did === did)
      if (!account) throw new AdminApiError('not_found', 404, 'AccountNotFound')
      return { account: { ...account }, indexer: { ...previewIndexer } }
    },
  }
}

export const previewDataProvider = createPreviewDataProvider()
