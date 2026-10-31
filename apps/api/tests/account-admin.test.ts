import { describe, expect, it } from 'vitest'
import { silentLogger } from '../src/logger.js'
import {
  createApprovalSeal,
  createPasswordSealer,
  deleteAccountAdmin,
  disableAccountInvites,
  getAccountAdminInfo,
  normalizeDisableInvitesInput,
  updateAccountAdmin,
  type AccountAdminRunContext,
} from '../src/services/account-admin.js'
import { UpstreamFailure } from '../src/upstream/client.js'
import {
  FAKE_ACCOUNT_VIEW,
  createFakePds,
  createFakeUpstream,
} from './helpers/fake-upstream.js'

const DID = 'did:plc:accountadmin'
const ADMIN = 'did:plc:admin'
const PASSWORD = 'correct-horse-battery'

function auditSink(): { rows: Record<string, unknown>[]; db: AccountAdminRunContext['db'] } {
  const rows: Record<string, unknown>[] = []
  const db = {
    insertInto: () => ({
      values: (values: Record<string, unknown>) => ({
        execute: async () => {
          rows.push(values)
        },
      }),
    }),
  } as unknown as AccountAdminRunContext['db']
  return { rows, db }
}

function runContext(
  pds: AccountAdminRunContext['pds'],
  db: AccountAdminRunContext['db'],
  approvalId?: string,
): AccountAdminRunContext {
  return {
    pds,
    db,
    logger: silentLogger,
    actor: ADMIN,
    meta: { requestId: 'req-account-admin', actorIp: '10.0.0.4', userAgent: 'vitest' },
    ...(approvalId ? { approvalId } : {}),
  }
}

function failingPds(kind: 'invalid' | 'notfound') {
  return createFakeUpstream(
    () => {
      throw new UpstreamFailure(kind, 'upstream rejected', kind === 'notfound' ? 404 : 400)
    },
    { name: 'PDS' },
  )
}

function writeContext(
  pds: AccountAdminRunContext['pds'],
  db: AccountAdminRunContext['db'],
) {
  return {
    pds,
    db: db as never,
    logger: silentLogger,
    actor: ADMIN,
    meta: { requestId: 'req-account-admin', actorIp: '10.0.0.4', userAgent: 'vitest' },
  }
}

describe('account admin info', () => {
  it('trims the upstream view to the reviewed fields', async () => {
    const pds = createFakePds()
    const info = await getAccountAdminInfo(pds, DID)
    expect(info).toEqual({
      did: DID,
      handle: FAKE_ACCOUNT_VIEW.handle,
      email: FAKE_ACCOUNT_VIEW.email,
      emailConfirmed: true,
      invitesDisabled: false,
      invitedBy: {
        code: 'invite-parent',
        available: 1,
        disabled: false,
        createdBy: 'did:plc:e2einviter',
        createdAt: '2026-10-29T08:00:00.000Z',
        usesCount: 0,
      },
      invites: [
        {
          code: 'invite-one',
          available: 2,
          disabled: false,
          createdBy: 'did:plc:e2eaccount',
          createdAt: '2026-10-29T08:00:00.000Z',
          usesCount: 1,
        },
      ],
      indexedAt: '2026-10-29T08:00:00.000Z',
    })
    expect(info).not.toHaveProperty('threatSignatures')
    expect(pds.calls[0]).toEqual({
      nsid: 'com.atproto.admin.getAccountInfo',
      options: { params: { did: DID } },
    })
  })

  it('maps an unknown account to 404 and a missing credential to 503', async () => {
    await expect(getAccountAdminInfo(failingPds('invalid'), DID)).rejects.toMatchObject({
      status: 404,
      body: { error: 'NotFound' },
    })
    await expect(getAccountAdminInfo(failingPds('notfound'), DID)).rejects.toMatchObject({
      status: 404,
    })
    const unconfigured = createFakeUpstream(() => ({}), {
      name: 'PDS',
      configured: false,
    })
    await expect(getAccountAdminInfo(unconfigured, DID)).rejects.toMatchObject({
      status: 503,
      body: { error: 'NotConfigured' },
    })
  })

  it('rejects an invalid account identifier before calling upstream', async () => {
    const pds = createFakePds()
    await expect(getAccountAdminInfo(pds, 'alice.test')).rejects.toMatchObject({ status: 400 })
    expect(pds.calls).toHaveLength(0)
  })
})

describe('account admin updates', () => {
  it('updates email, handle and password in order and never audits the password', async () => {
    const pds = createFakePds()
    const audit = auditSink()
    await updateAccountAdmin(
      runContext(pds, audit.db, 'approval-1'),
      {
        did: DID,
        email: 'new@example.test',
        handle: 'new.account.test',
        password: PASSWORD,
      },
    )

    expect(pds.calls.map((call) => call.nsid)).toEqual([
      'com.atproto.admin.getAccountInfo',
      'com.atproto.admin.updateAccountEmail',
      'com.atproto.admin.updateAccountHandle',
      'com.atproto.admin.updateAccountPassword',
    ])
    expect(pds.calls[1]?.options?.body).toEqual({
      account: DID,
      email: 'new@example.test',
    })
    expect(pds.calls[2]?.options?.body).toEqual({
      did: DID,
      handle: 'new.account.test',
    })
    expect(pds.calls[3]?.options?.body).toEqual({ did: DID, password: PASSWORD })
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0]).toMatchObject({
      actor_did: ADMIN,
      target_id: DID,
      approval_id: 'approval-1',
      detail: '通过上游服务更新账号资料：邮箱、账号名、密码',
    })
    expect(JSON.stringify(audit.rows)).not.toContain(PASSWORD)
  })

  it('stops before upstream writes when the account does not exist', async () => {
    const pds = failingPds('invalid')
    const audit = auditSink()
    await expect(
      updateAccountAdmin(runContext(pds, audit.db), { did: DID, email: 'new@example.test' }),
    ).rejects.toMatchObject({ status: 404 })
    expect(pds.calls.map((call) => call.nsid)).toEqual(['com.atproto.admin.getAccountInfo'])
    expect(audit.rows).toHaveLength(0)
  })

  it('rejects a change without any field', async () => {
    const pds = createFakePds()
    const audit = auditSink()
    await expect(updateAccountAdmin(runContext(pds, audit.db), { did: DID })).rejects.toThrow(
      /没有需要变更的账号资料/,
    )
    expect(audit.rows).toHaveLength(0)
  })

  it('deletes the account after confirming it exists and records the approval', async () => {
    const pds = createFakePds()
    const audit = auditSink()
    await deleteAccountAdmin(runContext(pds, audit.db, 'approval-2'), { did: DID })
    expect(pds.calls.map((call) => call.nsid)).toEqual([
      'com.atproto.admin.getAccountInfo',
      'com.atproto.admin.deleteAccount',
    ])
    expect(pds.calls[1]?.options?.body).toEqual({ did: DID })
    expect(audit.rows[0]).toMatchObject({
      actor_did: ADMIN,
      target_id: DID,
      approval_id: 'approval-2',
      detail: '通过上游服务删除账号',
    })
  })

  it('returns 404 for a delete of a missing account without calling delete', async () => {
    const pds = failingPds('invalid')
    const audit = auditSink()
    await expect(
      deleteAccountAdmin(runContext(pds, audit.db), { did: DID }),
    ).rejects.toMatchObject({ status: 404 })
    expect(pds.calls.map((call) => call.nsid)).toEqual(['com.atproto.admin.getAccountInfo'])
  })
})

describe('invitation codes', () => {
  it('normalizes account and code input and deduplicates codes', () => {
    expect(normalizeDisableInvitesInput({ did: DID })).toEqual({ did: DID })
    expect(
      normalizeDisableInvitesInput({ codes: [' code-a ', 'code-a', 'code-b'] }),
    ).toEqual({ codes: ['code-a', 'code-b'] })
    expect(() => normalizeDisableInvitesInput({})).toThrow(/请提供账号标识或邀请码/)
    expect(() => normalizeDisableInvitesInput({ did: 'alice.test' })).toThrow(/账号标识/)
    expect(() => normalizeDisableInvitesInput({ codes: [] })).toThrow(/1 到 1000/)
    expect(() => normalizeDisableInvitesInput({ codes: 'code-a' })).toThrow(/1 到 1000/)
    expect(() => normalizeDisableInvitesInput({ did: DID, note: 'x' })).toThrow(/未知字段/)
  })

  it('disables every code of an account and specific codes', async () => {
    const pds = createFakePds()
    const audit = auditSink()
    await disableAccountInvites(writeContext(pds, audit.db), { did: DID })
    expect(pds.calls.slice(-2)).toMatchObject([
      {
        nsid: 'com.atproto.admin.disableAccountInvites',
        options: { body: { account: DID } },
      },
      {
        nsid: 'com.atproto.admin.disableInviteCodes',
        options: { body: { accounts: [DID] } },
      },
    ])
    expect(audit.rows.at(-1)).toMatchObject({ detail: '停用该账号创建的全部邀请码' })

    const codesPds = createFakePds()
    await disableAccountInvites(writeContext(codesPds, audit.db), { codes: ['a', 'b'] })
    expect(codesPds.calls.at(-1)).toMatchObject({
      nsid: 'com.atproto.admin.disableInviteCodes',
      options: { body: { codes: ['a', 'b'] } },
    })
    expect(audit.rows.at(-1)).toMatchObject({ detail: '停用 2 个指定邀请码' })
  })

  it('returns 404 when the account is missing and 503 when PDS is not configured', async () => {
    await expect(
      disableAccountInvites(writeContext(failingPds('invalid'), auditSink().db), { did: DID }),
    ).rejects.toMatchObject({ status: 404 })
    const unconfigured = createFakeUpstream(() => ({}), {
      name: 'PDS',
      configured: false,
    })
    await expect(
      disableAccountInvites(writeContext(unconfigured, auditSink().db), { codes: ['a'] }),
    ).rejects.toMatchObject({ status: 503, body: { error: 'NotConfigured' } })
  })
})

describe('approval password sealing', () => {
  it('round-trips a password bound to the account DID', () => {
    const sealer = createPasswordSealer('pds-admin-secret')
    const sealed = sealer.seal(DID, PASSWORD)
    expect(sealed).toMatch(/^v1\./)
    expect(sealed).not.toContain(PASSWORD)
    expect(sealer.open(DID, sealed)).toBe(PASSWORD)
    expect(() => sealer.open('did:plc:other', sealed)).toThrow(/无法解密/)
    const parts = sealed.split('.')
    const body = parts[3] as string
    const tampered = [parts[0], parts[1], parts[2], (body[0] === 'A' ? 'B' : 'A') + body.slice(1)]
    expect(() => sealer.open(DID, tampered.join('.'))).toThrow(/无法解密/)
  })

  it('produces a different ciphertext for the same password', () => {
    const sealer = createPasswordSealer('pds-admin-secret')
    expect(sealer.seal(DID, PASSWORD)).not.toBe(sealer.seal(DID, PASSWORD))
  })

  it('fails to open with a different credential', () => {
    const first = createPasswordSealer('first-secret')
    const second = createPasswordSealer('second-secret')
    expect(() => second.open(DID, first.seal(DID, PASSWORD))).toThrow(/无法解密/)
  })

  it('seals approval payloads and drops the plaintext password', () => {
    const sealer = createPasswordSealer('pds-admin-secret')
    const seal = createApprovalSeal(sealer)
    const sealed = seal('account.admin.update', {
      did: DID,
      email: 'new@example.test',
      password: PASSWORD,
    })
    expect(sealed).not.toHaveProperty('password')
    expect(sealed.email).toBe('new@example.test')
    expect(typeof sealed.passwordSealed).toBe('string')
    expect(JSON.stringify(sealed)).not.toContain(PASSWORD)
    expect(seal('account.admin.delete', { did: DID })).toEqual({ did: DID })
    expect(seal('account.admin.update', { did: DID, email: 'a@b.test' })).toEqual({
      did: DID,
      email: 'a@b.test',
    })
  })

  it('refuses to seal a password when the PDS credential is missing', () => {
    const seal = createApprovalSeal(undefined)
    expect(() => seal('account.admin.update', { did: DID, password: PASSWORD })).toThrow(
      /尚未配置PDS的管理员凭据/,
    )
  })
})
