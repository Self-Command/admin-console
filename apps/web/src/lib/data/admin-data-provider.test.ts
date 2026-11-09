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

  it('passes v4 filters and arrays through to XRPC', async () => {
    const verification = providerReturning({ verifications: [] })
    await verification.provider.listVerifications({
      subject: ' did:plc:alice ',
      isRevoked: false,
      limit: 30,
      sortDirection: 'asc',
    })
    expect(verification.callAdmin).toHaveBeenCalledWith(
      'com.selfcommand.admin.verification.list',
      {
        params: {
          subject: 'did:plc:alice',
          isRevoked: 'false',
          limit: '30',
          sortDirection: 'asc',
        },
      },
    )

    const options = providerReturning({ options: [] })
    await options.provider.listPolicyOptions({
      scope: 'personal',
      keys: ['tools.ozone.report.defs#reasonSpam'],
      limit: 100,
    })
    expect(options.callAdmin).toHaveBeenCalledWith('com.selfcommand.admin.policy.option.list', {
      params: {
        scope: 'personal',
        limit: '100',
        keys: ['tools.ozone.report.defs#reasonSpam'],
      },
    })

    const rules = providerReturning({ rules: [] })
    await rules.provider.listSafelinkRules({
      patternType: 'domain',
      actions: ['block', 'warn'],
      urls: ['example.com'],
      limit: 50,
    })
    expect(rules.callAdmin).toHaveBeenCalledWith('com.selfcommand.admin.policy.safelink.list', {
      params: {
        patternType: 'domain',
        limit: '50',
        urls: ['example.com'],
        actions: ['block', 'warn'],
      },
    })
  })

  it('sends v4 write bodies and unwraps labeler reads', async () => {
    const template = providerReturning({})
    await expect(
      template.provider.actOnTemplate({ action: 'delete', id: '1' }),
    ).resolves.toEqual({})
    expect(template.callAdmin).toHaveBeenCalledWith(
      'com.selfcommand.admin.notifications.template.act',
      { body: { action: 'delete', id: '1' } },
    )

    const send = providerReturning({ sent: 1, failed: [] })
    await send.provider.sendNotification({
      recipients: ['did:plc:alice'],
      subject: '账号通知',
      contentMarkdown: '您好。',
    })
    expect(send.callAdmin).toHaveBeenCalledWith('com.selfcommand.admin.notifications.send', {
      body: {
        recipients: ['did:plc:alice'],
        subject: '账号通知',
        contentMarkdown: '您好。',
      },
    })

    const policy = providerReturning({})
    await policy.provider.actOnPolicySet({
      operation: 'set.upsert',
      input: { name: 'spam', description: '垃圾内容' },
    })
    expect(policy.callAdmin).toHaveBeenCalledWith('com.selfcommand.admin.policy.set.act', {
      body: {
        operation: 'set.upsert',
        input: { name: 'spam', description: '垃圾内容' },
      },
    })

    const labeler = providerReturning({ labeler: { available: false, reason: '未注册' } })
    await expect(labeler.provider.getLabelerConfig()).resolves.toEqual({
      available: false,
      reason: '未注册',
    })
    expect(labeler.callAdmin).toHaveBeenCalledWith('com.selfcommand.admin.policy.labeler.get')
  })

  it('passes v5 account administration calls through to XRPC', async () => {
    const info = providerReturning({ info: { did: 'did:plc:alice', email: 'alice@example.com' } })
    await expect(info.provider.getAccountAdminInfo('did:plc:alice')).resolves.toEqual({
      did: 'did:plc:alice',
      email: 'alice@example.com',
    })
    expect(info.callAdmin).toHaveBeenCalledWith('com.selfcommand.admin.account.admin.info', {
      params: { did: 'did:plc:alice' },
    })

    const update = providerReturning({})
    await expect(
      update.provider.updateAccountAdmin({
        did: 'did:plc:alice',
        handle: 'alice.example.com',
        password: 'correct horse battery',
      }),
    ).resolves.toBeUndefined()
    expect(update.callAdmin).toHaveBeenCalledWith(
      'com.selfcommand.admin.account.admin.update',
      {
        body: {
          did: 'did:plc:alice',
          handle: 'alice.example.com',
          password: 'correct horse battery',
        },
      },
    )

    const remove = providerReturning({})
    await expect(remove.provider.deleteAccountAdmin('did:plc:alice')).resolves.toBeUndefined()
    expect(remove.callAdmin).toHaveBeenCalledWith(
      'com.selfcommand.admin.account.admin.delete',
      { body: { did: 'did:plc:alice' } },
    )

    const invites = providerReturning({})
    await expect(
      invites.provider.disableAccountInvites({ did: 'did:plc:alice' }),
    ).resolves.toBeUndefined()
    expect(invites.callAdmin).toHaveBeenCalledWith(
      'com.selfcommand.admin.account.invites.disable',
      { body: { did: 'did:plc:alice' } },
    )

    const random = providerReturning({
      overview: { did: 'did:plc:random', status: 'active' },
    })
    await expect(random.provider.getRandomAccount()).resolves.toEqual({
      did: 'did:plc:random',
      status: 'active',
    })
    expect(random.callAdmin).toHaveBeenCalledWith('com.selfcommand.admin.moderation.random')
  })

  it('searches signature accounts with repeatable values parameters', async () => {
    const { callAdmin, provider } = providerReturning({ accounts: [], cursor: 'next' })

    await expect(
      provider.searchSignatureAccounts({ values: ['sig:alpha', 'sig:beta'], limit: 25 }),
    ).resolves.toEqual({ accounts: [], cursor: 'next' })

    expect(callAdmin).toHaveBeenCalledWith(
      'com.selfcommand.admin.signature.searchAccounts',
      {
        params: { values: ['sig:alpha', 'sig:beta'], limit: '25' },
      },
    )
  })

  it('calls related-account and correlation endpoints', async () => {
    const related = providerReturning({ accounts: [] })
    await related.provider.findRelatedSignatureAccounts({
      did: 'did:plc:alice',
      cursor: 'cursor-2',
      limit: 10,
    })
    expect(related.callAdmin).toHaveBeenCalledWith(
      'com.selfcommand.admin.signature.findRelatedAccounts',
      { params: { did: 'did:plc:alice', cursor: 'cursor-2', limit: '10' } },
    )

    const details = [{ property: 'email', value: 'alice@example.com' }]
    const correlation = providerReturning({ details })
    await expect(
      correlation.provider.findSignatureCorrelation(['did:plc:alice', 'did:plc:bob']),
    ).resolves.toEqual({ details })
    expect(correlation.callAdmin).toHaveBeenCalledWith(
      'com.selfcommand.admin.signature.findCorrelation',
      { params: { dids: ['did:plc:alice', 'did:plc:bob'] } },
    )
  })

  it('maps account graph and post queries', async () => {
    const graph = providerReturning({ accounts: [], cursor: 'next' })
    await graph.provider.getAccountGraph({ did: 'did:plc:alice', kind: 'follows', limit: 20 })
    expect(graph.callAdmin).toHaveBeenCalledWith('com.selfcommand.admin.account.graph', {
      params: { did: 'did:plc:alice', kind: 'follows', limit: '20' },
    })

    const posts = providerReturning({ posts: [] })
    await posts.provider.getAccountPosts({
      did: 'did:plc:alice',
      filter: 'withReplies',
      limit: 30,
    })
    expect(posts.callAdmin).toHaveBeenCalledWith('com.selfcommand.admin.account.posts', {
      params: { did: 'did:plc:alice', filter: 'withReplies', limit: '30' },
    })
  })

  it('maps inbox queries and unwraps read results', async () => {
    const list = providerReturning({ notifications: [], cursor: 'next' })
    await list.provider.listInboxNotifications({
      did: 'did:plc:alice',
      section: 'reports',
      reasons: ['reportResolved', 'actionTaken'],
      unreadOnly: true,
      limit: 20,
    })
    expect(list.callAdmin).toHaveBeenCalledWith(
      'com.selfcommand.admin.inbox.listNotifications',
      {
        params: {
          did: 'did:plc:alice',
          section: 'reports',
          unreadOnly: 'true',
          limit: '20',
          reasons: ['reportResolved', 'actionTaken'],
        },
      },
    )

    const counts = providerReturning({ unreadCounts: { total: 3, reports: 2 } })
    await expect(counts.provider.getInboxUnreadCounts('did:plc:alice', 'reports')).resolves.toEqual(
      { total: 3, reports: 2 },
    )
    expect(counts.callAdmin).toHaveBeenCalledWith(
      'com.selfcommand.admin.inbox.getUnreadCount',
      { params: { did: 'did:plc:alice', section: 'reports' } },
    )

    const preferences = { reports: true, account: false, labels: true }
    const prefs = providerReturning({ preferences })
    await expect(prefs.provider.getInboxNotificationPreferences('did:plc:alice')).resolves.toEqual(
      preferences,
    )
    expect(prefs.callAdmin).toHaveBeenCalledWith(
      'com.selfcommand.admin.inbox.getNotificationPreferences',
      { params: { did: 'did:plc:alice' } },
    )
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
