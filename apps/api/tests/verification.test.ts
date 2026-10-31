import { describe, expect, it } from 'vitest'
import { silentLogger } from '../src/logger.js'
import {
  actOnVerifications,
  listVerifications,
  normalizeVerificationView,
  type VerificationWriteContext,
} from '../src/services/verification.js'
import { createFakeOzone, createFakeUpstream } from './helpers/fake-upstream.js'

const SUBJECT = 'did:plc:target'
const URI = 'at://did:plc:issuer/tools.ozone.verification.defs#verification/1'
const CREATED_AT = '2026-10-29T08:00:00.000Z'

const RECORD = {
  uri: URI,
  issuer: 'did:plc:issuer',
  subject: SUBJECT,
  handle: 'target.test',
  displayName: '目标账号',
  createdAt: CREATED_AT,
}

function fakeAdminCount(count: number) {
  return {
    selectFrom: () => ({
      select: () => ({
        where: () => ({
          executeTakeFirstOrThrow: async () => ({ count }),
        }),
      }),
    }),
  } as never
}

function writeContext(
  db: unknown,
  ozone: VerificationWriteContext['ozone'],
): VerificationWriteContext {
  return {
    db: db as VerificationWriteContext['db'],
    ozone,
    logger: silentLogger,
    actor: 'did:plc:moderator',
    meta: {},
    ttlHours: 24,
  }
}

describe('verification view normalization', () => {
  it('maps an active verification record', () => {
    expect(normalizeVerificationView(RECORD)).toEqual({
      uri: URI,
      issuer: 'did:plc:issuer',
      subject: SUBJECT,
      handle: 'target.test',
      displayName: '目标账号',
      createdAt: CREATED_AT,
      isActive: true,
    })
  })

  it('derives inactivity from the revocation fields', () => {
    expect(
      normalizeVerificationView({
        ...RECORD,
        isActive: undefined,
        revokeReason: '认证信息有误',
      }),
    ).toMatchObject({ isActive: false, revokeReason: '认证信息有误' })
    expect(
      normalizeVerificationView({ ...RECORD, revokedAt: '2026-10-30T00:00:00.000Z' }),
    ).toMatchObject({ isActive: false })
  })

  it('rejects records without a valid address or account identifier', () => {
    expect(() => normalizeVerificationView({ ...RECORD, uri: 'https://example.com' })).toThrow(
      /无法识别的认证记录/,
    )
    expect(() => normalizeVerificationView({ ...RECORD, subject: 'target.test' })).toThrow(
      /无法识别的认证记录/,
    )
    expect(() => normalizeVerificationView({ ...RECORD, createdAt: 'yesterday' })).toThrow(
      /无法识别的认证记录/,
    )
  })
})

describe('verification listing', () => {
  it('filters by account and defaults to descending order', async () => {
    const ozone = createFakeUpstream((nsid) =>
      nsid === 'tools.ozone.verification.listVerifications'
        ? { verifications: [RECORD], cursor: 'next' }
        : {},
    )

    const result = await listVerifications(
      { ozone, logger: silentLogger },
      { subject: SUBJECT, isRevoked: false, limit: 25 },
    )

    expect(result).toMatchObject({ verifications: [{ subject: SUBJECT }], cursor: 'next' })
    const call = ozone.calls.find(
      (entry) => entry.nsid === 'tools.ozone.verification.listVerifications',
    )
    expect(call?.options?.params).toMatchObject({
      subjects: [SUBJECT],
      isRevoked: false,
      sortDirection: 'desc',
      limit: 25,
    })
  })

  it('rejects an account filter that is not an identifier before calling upstream', async () => {
    const ozone = createFakeOzone()
    await expect(
      listVerifications({ ozone, logger: silentLogger }, { subject: 'target.test', limit: 25 }),
    ).rejects.toMatchObject({ status: 400, body: { error: 'InvalidRequest' } })
    expect(ozone.calls).toHaveLength(0)
  })
})

describe('verification actions', () => {
  it('requires an approval for a grant while other administrators exist', async () => {
    const ozone = createFakeUpstream(() => {
      throw new Error('upstream should not be called')
    })
    const ctx = writeContext(fakeAdminCount(2), ozone)

    await expect(
      actOnVerifications(ctx, {
        action: 'grant',
        verifications: [{ subject: SUBJECT, handle: 'target.test', displayName: '目标账号' }],
      }),
    ).rejects.toMatchObject({ status: 409, body: { error: 'ApprovalRequired' } })
    expect(ozone.calls).toHaveLength(0)
  })

  it('grants verifications directly for the sole administrator', async () => {
    const ozone = createFakeUpstream((nsid) =>
      nsid === 'tools.ozone.verification.grantVerifications'
        ? { verifications: [RECORD], failedVerifications: [] }
        : {},
    )
    const ctx = writeContext(fakeAdminCount(1), ozone)

    const result = await actOnVerifications(ctx, {
      action: 'grant',
      verifications: [{ subject: SUBJECT, handle: 'target.test', displayName: '目标账号' }],
    })

    expect(result).toEqual({
      verified: [
        {
          uri: URI,
          issuer: 'did:plc:issuer',
          subject: SUBJECT,
          handle: 'target.test',
          displayName: '目标账号',
          createdAt: CREATED_AT,
          isActive: true,
        },
      ],
      revoked: [],
      failed: [],
    })
    const call = ozone.calls.find(
      (entry) => entry.nsid === 'tools.ozone.verification.grantVerifications',
    )
    expect(call?.options?.body).toEqual({
      verifications: [{ subject: SUBJECT, handle: 'target.test', displayName: '目标账号' }],
    })
  })

  it('reports per-record failures from the upstream service', async () => {
    const ozone = createFakeUpstream((nsid) =>
      nsid === 'tools.ozone.verification.grantVerifications'
        ? {
            verifications: [],
            failedVerifications: [{ subject: SUBJECT, error: '账号不存在' }],
          }
        : {},
    )
    const ctx = writeContext(fakeAdminCount(1), ozone)

    const result = await actOnVerifications(ctx, {
      action: 'grant',
      verifications: [{ subject: SUBJECT, handle: 'target.test', displayName: '目标账号' }],
    })
    expect(result).toEqual({
      verified: [],
      revoked: [],
      failed: [{ subject: SUBJECT, message: '账号不存在' }],
    })
  })

  it('revokes verifications by address with a reason', async () => {
    const ozone = createFakeUpstream((nsid) =>
      nsid === 'tools.ozone.verification.revokeVerifications'
        ? { revokedVerifications: [URI], failedRevocations: [] }
        : {},
    )
    const ctx = writeContext(fakeAdminCount(1), ozone)

    const result = await actOnVerifications(ctx, {
      action: 'revoke',
      uris: [URI],
      reason: '认证信息有误',
    })
    expect(result).toMatchObject({ revoked: [URI] })
    const call = ozone.calls.find(
      (entry) => entry.nsid === 'tools.ozone.verification.revokeVerifications',
    )
    expect(call?.options?.body).toEqual({ uris: [URI], revokeReason: '认证信息有误' })
  })

  it('rejects a grant that carries record addresses', async () => {
    const ozone = createFakeOzone()
    const ctx = writeContext(fakeAdminCount(1), ozone)
    await expect(
      actOnVerifications(ctx, {
        action: 'grant',
        uris: [URI],
        verifications: [{ subject: SUBJECT, handle: 'target.test', displayName: '目标账号' }],
      }),
    ).rejects.toMatchObject({ status: 400, body: { error: 'InvalidRequest' } })
    expect(ozone.calls).toHaveLength(0)
  })
})
