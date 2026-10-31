import { describe, expect, it } from 'vitest'
import { silentLogger } from '../src/logger.js'
import {
  findRelatedSignatureAccounts,
  findSignatureCorrelation,
  searchSignatureAccounts,
} from '../src/services/signature.js'
import {
  createFakeUpstream,
  type FakeUpstream,
} from './helpers/fake-upstream.js'

const ISO = '2026-11-02T08:00:00.000Z'

const SHAPE_ERROR = {
  status: 502,
  body: {
    error: 'UpstreamUnavailable',
    message: '上游服务返回了无法识别的签名数据，请稍后重试。',
  },
}

const ACCOUNT = {
  did: 'did:plc:sigaccount',
  handle: 'sig.account.test',
  email: 'sig@account.test',
  indexedAt: ISO,
  invitesDisabled: false,
  emailConfirmedAt: '2026-11-01T00:00:00.000Z',
  inviteNote: '批量注册账号',
  deactivatedAt: '2026-11-02T00:00:00.000Z',
  relatedRecords: [{ uri: 'at://did:plc:sigaccount/app.bsky.feed.post/1' }],
  threatSignatures: [{ property: 'fingerprint', value: 'device-1' }],
}

const MINIMAL_ACCOUNT = {
  did: 'did:plc:minimal',
  handle: 'minimal.test',
  indexedAt: ISO,
}

function deps(ozone: FakeUpstream) {
  return { ozone, logger: silentLogger }
}

describe('signature account search', () => {
  it('calls tools.ozone.signature.searchAccounts with every signature value', async () => {
    const ozone = createFakeUpstream(() => ({
      accounts: [ACCOUNT, MINIMAL_ACCOUNT],
      cursor: 'page-2',
    }))

    const result = await searchSignatureAccounts(deps(ozone), {
      values: ['fingerprint:device-1', 'fingerprint:device-2'],
      cursor: 'page-1',
      limit: 25,
    })

    expect(ozone.calls).toHaveLength(1)
    expect(ozone.calls[0]?.nsid).toBe('tools.ozone.signature.searchAccounts')
    expect(ozone.calls[0]?.options?.params).toEqual({
      values: ['fingerprint:device-1', 'fingerprint:device-2'],
      cursor: 'page-1',
      limit: 25,
    })
    expect(result.accounts[0]).toEqual({
      did: ACCOUNT.did,
      handle: ACCOUNT.handle,
      email: ACCOUNT.email,
      relatedRecords: ACCOUNT.relatedRecords,
      indexedAt: ISO,
      invitesDisabled: false,
      emailConfirmedAt: '2026-11-01T00:00:00.000Z',
      inviteNote: ACCOUNT.inviteNote,
      deactivatedAt: '2026-11-02T00:00:00.000Z',
      threatSignatures: [{ property: 'fingerprint', value: 'device-1' }],
    })
    expect(result.accounts[1]).toEqual(MINIMAL_ACCOUNT)
    expect(result.cursor).toBe('page-2')
  })

  it('accepts an empty page and omits an empty cursor', async () => {
    const ozone = createFakeUpstream(() => ({ accounts: [], cursor: '' }))

    const result = await searchSignatureAccounts(deps(ozone), {
      values: ['fingerprint:unknown'],
      limit: 50,
    })

    expect(result).toEqual({ accounts: [] })
    expect('cursor' in result).toBe(false)
  })

  it('rejects a response without an accounts list', async () => {
    const ozone = createFakeUpstream(() => ({ cursor: 'page-2' }))

    await expect(
      searchSignatureAccounts(deps(ozone), { values: ['x'], limit: 10 }),
    ).rejects.toMatchObject(SHAPE_ERROR)
  })

  it('rejects accounts without a valid did, handle or indexedAt', async () => {
    const noDid = createFakeUpstream(() => ({
      accounts: [{ ...MINIMAL_ACCOUNT, did: 'at://not-a-did' }],
    }))
    await expect(
      searchSignatureAccounts(deps(noDid), { values: ['x'], limit: 10 }),
    ).rejects.toMatchObject(SHAPE_ERROR)

    const noHandle = createFakeUpstream(() => ({
      accounts: [{ ...MINIMAL_ACCOUNT, handle: '' }],
    }))
    await expect(
      searchSignatureAccounts(deps(noHandle), { values: ['x'], limit: 10 }),
    ).rejects.toMatchObject(SHAPE_ERROR)

    const noIndexedAt = createFakeUpstream(() => ({
      accounts: [{ did: MINIMAL_ACCOUNT.did, handle: MINIMAL_ACCOUNT.handle }],
    }))
    await expect(
      searchSignatureAccounts(deps(noIndexedAt), { values: ['x'], limit: 10 }),
    ).rejects.toMatchObject(SHAPE_ERROR)
  })

  it('rejects a threat signature without a property or value', async () => {
    const ozone = createFakeUpstream(() => ({
      accounts: [{ ...MINIMAL_ACCOUNT, threatSignatures: [{ property: 'fp' }] }],
    }))

    await expect(
      searchSignatureAccounts(deps(ozone), { values: ['x'], limit: 10 }),
    ).rejects.toMatchObject(SHAPE_ERROR)
  })

  it('caps oversized strings', async () => {
    const ozone = createFakeUpstream(() => ({
      accounts: [
        {
          ...MINIMAL_ACCOUNT,
          handle: 'h'.repeat(300),
          email: 'e'.repeat(400),
          inviteNote: 'n'.repeat(2500),
          threatSignatures: [{ property: 'p'.repeat(300), value: 'v'.repeat(3000) }],
        },
      ],
    }))

    const result = await searchSignatureAccounts(deps(ozone), {
      values: ['x'],
      limit: 10,
    })
    const account = result.accounts[0]
    expect(account?.handle).toHaveLength(256)
    expect(account?.email).toHaveLength(320)
    expect(account?.inviteNote).toHaveLength(2000)
    expect(account?.threatSignatures?.[0]?.property).toHaveLength(256)
    expect(account?.threatSignatures?.[0]?.value).toHaveLength(2048)
  })
})

describe('related signature accounts', () => {
  it('calls tools.ozone.signature.findRelatedAccounts and normalizes similarities', async () => {
    const ozone = createFakeUpstream(() => ({
      accounts: [
        {
          account: ACCOUNT,
          similarities: [{ property: 'fingerprint', value: 'device-1' }],
        },
        {
          account: { ...MINIMAL_ACCOUNT, handle: 'related.test' },
        },
      ],
      cursor: 'next-page',
    }))

    const result = await findRelatedSignatureAccounts(deps(ozone), {
      did: ACCOUNT.did,
      cursor: 'page-1',
      limit: 10,
    })

    expect(ozone.calls).toHaveLength(1)
    expect(ozone.calls[0]?.nsid).toBe(
      'tools.ozone.signature.findRelatedAccounts',
    )
    expect(ozone.calls[0]?.options?.params).toEqual({
      did: ACCOUNT.did,
      cursor: 'page-1',
      limit: 10,
    })
    expect(result.accounts).toHaveLength(2)
    expect(result.accounts[0]?.account.did).toBe(ACCOUNT.did)
    expect(result.accounts[0]?.similarities).toEqual([
      { property: 'fingerprint', value: 'device-1' },
    ])
    expect(result.accounts[1]).not.toHaveProperty('similarities')
    expect(result.cursor).toBe('next-page')
  })

  it('accepts an empty page', async () => {
    const ozone = createFakeUpstream(() => ({ accounts: [] }))

    const result = await findRelatedSignatureAccounts(deps(ozone), {
      did: ACCOUNT.did,
      limit: 10,
    })

    expect(result).toEqual({ accounts: [] })
    expect('cursor' in result).toBe(false)
  })

  it('rejects a related account without an account view', async () => {
    const ozone = createFakeUpstream(() => ({
      accounts: [{ similarities: [{ property: 'fp', value: 'v' }] }],
    }))

    await expect(
      findRelatedSignatureAccounts(deps(ozone), { did: ACCOUNT.did, limit: 10 }),
    ).rejects.toMatchObject(SHAPE_ERROR)
  })
})

describe('signature correlation', () => {
  it('calls tools.ozone.signature.findCorrelation with every did', async () => {
    const ozone = createFakeUpstream(() => ({
      details: [
        { property: 'fingerprint', value: 'device-1' },
        { property: 'fingerprint', value: 'device-2' },
      ],
    }))

    const result = await findSignatureCorrelation(deps(ozone), {
      dids: ['did:plc:sigaccount', 'did:plc:minimal'],
    })

    expect(ozone.calls).toHaveLength(1)
    expect(ozone.calls[0]?.nsid).toBe('tools.ozone.signature.findCorrelation')
    expect(ozone.calls[0]?.options?.params).toEqual({
      dids: ['did:plc:sigaccount', 'did:plc:minimal'],
    })
    expect(result).toEqual({
      details: [
        { property: 'fingerprint', value: 'device-1' },
        { property: 'fingerprint', value: 'device-2' },
      ],
    })
  })

  it('accepts an empty correlation result', async () => {
    const ozone = createFakeUpstream(() => ({ details: [] }))

    await expect(
      findSignatureCorrelation(deps(ozone), { dids: ['did:plc:sigaccount'] }),
    ).resolves.toEqual({ details: [] })
  })

  it('rejects a response without a details list', async () => {
    const ozone = createFakeUpstream(() => ({}))

    await expect(
      findSignatureCorrelation(deps(ozone), { dids: ['did:plc:sigaccount'] }),
    ).rejects.toMatchObject(SHAPE_ERROR)
  })

  it('rejects a signature detail without a value', async () => {
    const ozone = createFakeUpstream(() => ({
      details: [{ property: 'fingerprint', value: '  ' }],
    }))

    await expect(
      findSignatureCorrelation(deps(ozone), { dids: ['did:plc:sigaccount'] }),
    ).rejects.toMatchObject(SHAPE_ERROR)
  })
})

describe('signature services without Ozone credentials', () => {
  it('passes NotConfigured through for all three methods', async () => {
    const ozone = createFakeUpstream(() => ({}), { configured: false })

    await expect(
      searchSignatureAccounts(deps(ozone), { values: ['x'], limit: 10 }),
    ).rejects.toMatchObject({
      status: 503,
      body: { error: 'NotConfigured' },
    })
    await expect(
      findRelatedSignatureAccounts(deps(ozone), { did: ACCOUNT.did, limit: 10 }),
    ).rejects.toMatchObject({
      status: 503,
      body: { error: 'NotConfigured' },
    })
    await expect(
      findSignatureCorrelation(deps(ozone), { dids: [ACCOUNT.did] }),
    ).rejects.toMatchObject({
      status: 503,
      body: { error: 'NotConfigured' },
    })
  })
})
