import { describe, expect, it } from 'vitest'
import { createPreviewDataProvider } from '@/lib/data/preview-data-provider'

const ADMIN_DID = 'did:web:ops.selfcommand.example'
const OPERATOR_DID = 'did:web:moderation.selfcommand.example'

describe('preview data provider', () => {
  it('filters and paginates role bindings like admin-api', async () => {
    const provider = createPreviewDataProvider()

    const all = await provider.listRoles({ limit: 50 })
    expect(all.total).toBe(4)
    expect(all.roles.map((item) => item.subject)).toEqual(
      [...all.roles.map((item) => item.subject)].sort(),
    )

    const admins = await provider.listRoles({ role: 'admin' })
    expect(admins.roles).toHaveLength(1)

    const search = await provider.listRoles({ search: '内容运营' })
    expect(search.roles.map((item) => item.subject)).toEqual([OPERATOR_DID])

    const firstPage = await provider.listRoles({ limit: 2 })
    expect(firstPage.roles).toHaveLength(2)
    expect(firstPage.cursor).toBe('2')
    const secondPage = await provider.listRoles({ limit: 2, cursor: firstPage.cursor })
    expect(secondPage.roles).toHaveLength(2)
    expect(secondPage.cursor).toBeUndefined()
  })

  it('creates bindings and records a success audit event', async () => {
    const provider = createPreviewDataProvider()
    const before = await provider.listAudit({})

    const created = await provider.createRole({
      subject: 'did:plc:newoperator',
      role: 'operator',
      note: '新运营',
    })
    expect(created).toMatchObject({ subject: 'did:plc:newoperator', role: 'operator' })
    await expect(provider.getRole('did:plc:newoperator')).resolves.toMatchObject({
      note: '新运营',
    })

    const afterAll = await provider.listAudit({})
    expect(afterAll.total).toBe(before.total + 1)
    const audit = await provider.listAudit({
      action: 'com.selfcommand.admin.role.create',
      limit: 50,
    })
    const recorded = audit.events.filter((event) => event.target === 'did:plc:newoperator')
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({
      action: 'com.selfcommand.admin.role.create',
      target: 'did:plc:newoperator',
      result: 'success',
    })
  })

  it('mirrors duplicate, invalid and last-admin errors', async () => {
    const provider = createPreviewDataProvider()

    await expect(
      provider.createRole({ subject: ADMIN_DID, role: 'viewer' }),
    ).rejects.toMatchObject({ kind: 'conflict', code: 'RoleExists', status: 409 })

    await expect(
      provider.createRole({ subject: 'alice.test', role: 'viewer' }),
    ).rejects.toMatchObject({ kind: 'validation', code: 'InvalidRequest', status: 400 })

    await expect(
      provider.updateRole({ subject: ADMIN_DID, role: 'viewer' }),
    ).rejects.toMatchObject({ kind: 'conflict', code: 'LastAdmin', status: 409 })

    await expect(provider.revokeRole(ADMIN_DID)).rejects.toMatchObject({
      kind: 'conflict',
      code: 'LastAdmin',
    })

    await expect(provider.getRole('did:plc:missing')).rejects.toMatchObject({
      kind: 'not_found',
      code: 'RoleNotFound',
    })
  })

  it('allows revoking a non-admin and keeps the audit trail', async () => {
    const provider = createPreviewDataProvider()

    await expect(provider.revokeRole(OPERATOR_DID)).resolves.toBeUndefined()
    await expect(provider.getRole(OPERATOR_DID)).rejects.toMatchObject({
      kind: 'not_found',
    })
    const audit = await provider.listAudit({
      action: 'com.selfcommand.admin.role.revoke',
      limit: 50,
    })
    const recorded = audit.events.filter((event) => event.target === OPERATOR_DID)
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({ target: OPERATOR_DID, result: 'success' })
  })

  it('filters and paginates the account directory', async () => {
    const provider = createPreviewDataProvider()

    const active = await provider.listAccounts({ status: 'active' })
    expect(active.accounts.every((account) => account.status === 'active')).toBe(true)
    expect(active.indexer.backfillComplete).toBe(true)

    const search = await provider.listAccounts({ search: 'alice' })
    expect(search.accounts).toHaveLength(1)

    const firstPage = await provider.listAccounts({ limit: 2 })
    const secondPage = await provider.listAccounts({ limit: 2, cursor: firstPage.cursor })
    expect(firstPage.accounts).toHaveLength(2)
    expect(secondPage.accounts).toHaveLength(2)
    expect(secondPage.accounts[0]?.did).not.toBe(firstPage.accounts[0]?.did)

    await expect(provider.getAccount('did:plc:missing')).rejects.toMatchObject({
      kind: 'not_found',
      code: 'AccountNotFound',
    })
  })
})
