import { describe, expect, it, vi } from 'vitest'
import { AdminApiError } from '@/lib/api/admin-client'
import { createAdminDataProvider } from '@/lib/data/admin-data-provider'
import type { CallAdmin } from '@/lib/data/provider'
import type { RoleBinding } from '@/lib/data/types'

const binding: RoleBinding = {
  subject: 'did:plc:alice',
  role: 'admin',
  grantedBy: 'did:plc:root',
  createdAt: '2026-10-29T00:00:00.000Z',
  updatedAt: '2026-10-29T00:00:00.000Z',
}

function providerReturning(value: unknown) {
  const callAdmin = vi.fn(async () => value)
  return { callAdmin, provider: createAdminDataProvider(callAdmin as CallAdmin) }
}

describe('admin data provider', () => {
  it('lists roles with compact query parameters', async () => {
    const { callAdmin, provider } = providerReturning({ roles: [], total: 0 })

    await provider.listRoles({ search: ' alice ', role: 'admin', limit: 20 })

    expect(callAdmin).toHaveBeenCalledWith('com.selfcommand.admin.role.list', {
      params: { limit: '20', role: 'admin', search: 'alice' },
    })
  })

  it('unwraps role reads and mutations', async () => {
    const get = providerReturning({ role: binding })
    await expect(get.provider.getRole('did:plc:alice')).resolves.toEqual(binding)
    expect(get.callAdmin).toHaveBeenCalledWith('com.selfcommand.admin.role.get', {
      params: { subject: 'did:plc:alice' },
    })

    const create = providerReturning({ role: binding })
    await expect(
      create.provider.createRole({
        subject: 'did:plc:alice',
        role: 'admin',
        note: '平台负责人',
      }),
    ).resolves.toEqual(binding)
    expect(create.callAdmin).toHaveBeenCalledWith('com.selfcommand.admin.role.create', {
      body: { subject: 'did:plc:alice', role: 'admin', note: '平台负责人' },
    })

    const update = providerReturning({ role: binding })
    await update.provider.updateRole({ subject: 'did:plc:alice', role: 'viewer' })
    expect(update.callAdmin).toHaveBeenCalledWith('com.selfcommand.admin.role.update', {
      body: { subject: 'did:plc:alice', role: 'viewer' },
    })

    const revoke = providerReturning({})
    await expect(revoke.provider.revokeRole('did:plc:alice')).resolves.toBeUndefined()
    expect(revoke.callAdmin).toHaveBeenCalledWith('com.selfcommand.admin.role.revoke', {
      body: { subject: 'did:plc:alice' },
    })
  })

  it('passes audit and account filters through to XRPC', async () => {
    const audit = providerReturning({ events: [], total: 0 })
    await audit.provider.listAudit({
      actor: 'did:plc:alice',
      action: 'com.selfcommand.admin.role.create',
      result: 'success',
      since: '2026-10-01T00:00:00.000Z',
      until: '2026-10-31T00:00:00.000Z',
      limit: 8,
    })
    expect(audit.callAdmin).toHaveBeenCalledWith('com.selfcommand.admin.audit.list', {
      params: {
        limit: '8',
        actor: 'did:plc:alice',
        action: 'com.selfcommand.admin.role.create',
        result: 'success',
        since: '2026-10-01T00:00:00.000Z',
        until: '2026-10-31T00:00:00.000Z',
      },
    })

    const accounts = providerReturning({
      accounts: [],
      total: 0,
      indexer: { backfillComplete: true },
    })
    await accounts.provider.listAccounts({ search: 'alice', status: 'active', limit: 50 })
    expect(accounts.callAdmin).toHaveBeenCalledWith('com.selfcommand.admin.account.list', {
      params: { limit: '50', search: 'alice', status: 'active' },
    })

    const account = providerReturning({
      account: { did: 'did:plc:alice', status: 'active', indexedAt: binding.createdAt },
      indexer: { backfillComplete: true },
    })
    await expect(account.provider.getAccount('did:plc:alice')).resolves.toMatchObject({
      account: { did: 'did:plc:alice' },
    })
    expect(account.callAdmin).toHaveBeenCalledWith('com.selfcommand.admin.account.get', {
      params: { did: 'did:plc:alice' },
    })
  })

  it('does not swallow the normalized error kinds', async () => {
    const cases = [
      { kind: 'unauthorized' as const, status: 401 },
      { kind: 'forbidden' as const, status: 403 },
      { kind: 'conflict' as const, status: 409 },
      { kind: 'validation' as const, status: 400 },
      { kind: 'server' as const, status: 500 },
    ]
    for (const item of cases) {
      const error = new AdminApiError(item.kind, item.status)
      const provider = createAdminDataProvider((async () => {
        throw error
      }) as CallAdmin)
      await expect(provider.getRole('did:plc:alice')).rejects.toMatchObject({
        kind: item.kind,
        status: item.status,
      })
    }
  })
})
