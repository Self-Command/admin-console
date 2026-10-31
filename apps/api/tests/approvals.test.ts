import { describe, expect, it } from 'vitest'
import { normalizeStoredAccountUpdatePayload } from '../src/services/action-payloads.js'
import {
  APPROVAL_ACTIONS,
  APPROVAL_ACTION_LABELS,
  approvalHash,
  approvalRequired,
  normalizeApprovalPayload,
} from '../src/services/approvals.js'

const SUBJECT = 'did:plc:operator42'
const SECOND = 'did:plc:viewer43'

describe('approval payload normalization', () => {
  it('accepts only the settings.resetAll reason field', () => {
    expect(normalizeApprovalPayload('settings.resetAll', { reason: '  例行重置  ' })).toEqual({
      reason: '例行重置',
    })
    expect(normalizeApprovalPayload('settings.resetAll', { reason: '   ' })).toEqual({})
    expect(normalizeApprovalPayload('settings.resetAll', {})).toEqual({})
    expect(() => normalizeApprovalPayload('settings.resetAll', { section: 'theme' })).toThrow(
      /unknown field: section/,
    )
    expect(() =>
      normalizeApprovalPayload('settings.resetAll', { reason: 'a'.repeat(201) }),
    ).toThrow(/at most 200 characters/)
  })

  it('requires a DID for role.revoke and drops every other field', () => {
    expect(normalizeApprovalPayload('role.revoke', { subject: SUBJECT })).toEqual({
      subject: SUBJECT,
    })
    expect(() => normalizeApprovalPayload('role.revoke', { subject: 'alice.test' })).toThrow(
      /must be a DID/,
    )
    expect(() =>
      normalizeApprovalPayload('role.revoke', { subject: SUBJECT, role: 'viewer' }),
    ).toThrow(/unknown field: role/)
  })

  it('restricts role.demote to operator or viewer and trims the note', () => {
    expect(
      normalizeApprovalPayload('role.demote', {
        subject: SUBJECT,
        role: 'viewer',
        note: '  岗位调整  ',
      }),
    ).toEqual({ subject: SUBJECT, role: 'viewer', note: '岗位调整' })
    expect(normalizeApprovalPayload('role.demote', { subject: SUBJECT, role: 'operator' })).toEqual(
      { subject: SUBJECT, role: 'operator' },
    )
    expect(() => normalizeApprovalPayload('role.demote', { subject: SUBJECT, role: 'admin' })).toThrow(
      /operator or viewer/,
    )
    expect(() => normalizeApprovalPayload('role.demote', { subject: SUBJECT })).toThrow(
      /operator or viewer/,
    )
  })

  it('normalizes each role.import binding and the optional batch id', () => {
    const payload = normalizeApprovalPayload('role.import', {
      batchId: '  batch-2026-10  ',
      bindings: [
        { subject: SUBJECT, role: 'operator', note: ' 内容运营 ' },
        { subject: SECOND, role: 'viewer' },
      ],
    })
    expect(payload).toEqual({
      batchId: 'batch-2026-10',
      bindings: [
        { subject: SUBJECT, role: 'operator', note: '内容运营' },
        { subject: SECOND, role: 'viewer' },
      ],
    })
  })

  it('rejects empty, oversized or malformed role.import batches', () => {
    expect(() => normalizeApprovalPayload('role.import', { bindings: [] })).toThrow(
      /between 1 and 500/,
    )
    expect(() =>
      normalizeApprovalPayload('role.import', {
        bindings: Array.from({ length: 501 }, (_, index) => ({
          subject: `did:plc:bulk${index}`,
          role: 'viewer',
        })),
      }),
    ).toThrow(/between 1 and 500/)
    expect(() =>
      normalizeApprovalPayload('role.import', {
        bindings: [{ subject: 'not-a-did', role: 'viewer' }],
      }),
    ).toThrow(/bindings\[0\]\.subject must be a DID/)
    expect(() =>
      normalizeApprovalPayload('role.import', {
        bindings: [{ subject: SUBJECT, role: 'owner' }],
      }),
    ).toThrow(/bindings\[0\]\.role must be admin, operator or viewer/)
    expect(() =>
      normalizeApprovalPayload('role.import', {
        bindings: [{ subject: SUBJECT, role: 'viewer', extra: true }],
      }),
    ).toThrow(/unknown field: extra/)
    expect(() => normalizeApprovalPayload('role.import', { bindings: 'nope' })).toThrow(
      /between 1 and 500/,
    )
  })

  it('rejects payloads that are not objects', () => {
    expect(() => normalizeApprovalPayload('role.revoke', [])).toThrow(/payload must be an object/)
    expect(() => normalizeApprovalPayload('role.revoke', null)).toThrow(
      /payload must be an object/,
    )
  })
})

describe('approval payload hashing', () => {
  it('is stable across key order and nested object order', () => {
    const a = approvalHash('role.import', {
      bindings: [
        { subject: SUBJECT, role: 'operator', note: 'x' },
        { role: 'viewer', subject: SECOND },
      ],
    })
    const b = approvalHash('role.import', {
      bindings: [
        { note: 'x', role: 'operator', subject: SUBJECT },
        { subject: SECOND, role: 'viewer' },
      ],
    })
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes when the action or any payload value changes', () => {
    const base = approvalHash('role.revoke', { subject: SUBJECT })
    expect(approvalHash('role.demote', { subject: SUBJECT })).not.toBe(base)
    expect(approvalHash('role.revoke', { subject: SECOND })).not.toBe(base)
  })
})

describe('approval required error', () => {
  it('explains the two-person rule with the localized action label', () => {
    const error = approvalRequired('role.revoke')
    expect(error.status).toBe(409)
    expect(error.body).toMatchObject({ error: 'ApprovalRequired' })
    expect(error.message).toContain('「撤销管理员角色」需要另一位管理员批准')
  })
})

describe('v3 approval actions', () => {
  it('keeps exactly the reviewed action list with localized labels', () => {
    expect(APPROVAL_ACTIONS).toEqual([
      'settings.resetAll',
      'role.revoke',
      'role.demote',
      'role.import',
      'moderation.takedown',
      'moderation.batch',
      'moderation.label',
      'verification.grant',
      'verification.revoke',
      'account.admin.update',
      'account.admin.delete',
      'notifications.send',
      'policy.write',
      'announcement.publish',
      'announcement.archive',
    ])
    for (const action of APPROVAL_ACTIONS) {
      expect(APPROVAL_ACTION_LABELS[action].length).toBeGreaterThan(0)
    }
  })

  it('normalizes single-subject takedown and mute payloads', () => {
    expect(
      normalizeApprovalPayload('moderation.takedown', {
        subjects: [SUBJECT],
        action: 'takedown',
        comment: '  违规内容  ',
        reason: 'com.atproto.moderation.defs#reasonSpam',
      }),
    ).toEqual({
      subjects: [SUBJECT],
      action: 'takedown',
      comment: '违规内容',
      reason: 'com.atproto.moderation.defs#reasonSpam',
    })

    expect(
      normalizeApprovalPayload('moderation.takedown', {
        subjects: [SUBJECT],
        action: 'mute',
        durationInHours: 24,
      }),
    ).toEqual({ subjects: [SUBJECT], action: 'mute', durationInHours: 24 })
  })

  it('rejects takedown approvals that should use the batch action', () => {
    expect(() =>
      normalizeApprovalPayload('moderation.takedown', {
        subjects: [SUBJECT, SECOND],
        action: 'takedown',
      }),
    ).toThrow(/只允许一个对象/)
    expect(() =>
      normalizeApprovalPayload('moderation.takedown', {
        subjects: [SUBJECT],
        action: 'label',
        labels: ['spam'],
      }),
    ).toThrow(/只支持单个对象的下架或账号限制/)
    expect(() =>
      normalizeApprovalPayload('moderation.takedown', {
        subjects: [SUBJECT],
        action: 'mute',
      }),
    ).toThrow(/持续时长/)
  })

  it('requires at least two subjects for batch moderation', () => {
    expect(() =>
      normalizeApprovalPayload('moderation.batch', {
        subjects: [SUBJECT],
        action: 'takedown',
      }),
    ).toThrow(/至少需要两个对象/)
    expect(
      normalizeApprovalPayload('moderation.batch', {
        subjects: [SUBJECT, SECOND],
        action: 'label',
        labels: ['spam', 'abuse'],
      }),
    ).toEqual({
      subjects: [SUBJECT, SECOND],
      action: 'label',
      labels: ['spam', 'abuse'],
    })
  })

  it('normalizes verification, account, notification and policy payloads', () => {
    expect(
      normalizeApprovalPayload('verification.grant', {
        verifications: [
          { subject: SUBJECT, handle: ' target.test ', displayName: ' 目标账号 ' },
        ],
      }),
    ).toEqual({
      verifications: [{ subject: SUBJECT, handle: 'target.test', displayName: '目标账号' }],
    })
    expect(() =>
      normalizeApprovalPayload('verification.grant', {
        verifications: [{ subject: SUBJECT, handle: 'target.test' }],
      }),
    ).toThrow(/displayName/)
    expect(() =>
      normalizeApprovalPayload('verification.grant', {
        verifications: [
          { subject: SUBJECT, handle: 'target.test', displayName: '目标账号', description: '简介' },
        ],
      }),
    ).toThrow(/未知字段/)

    expect(() =>
      normalizeApprovalPayload('verification.revoke', { uris: ['https://example.com'] }),
    ).toThrow(/认证记录地址/)

    expect(
      normalizeApprovalPayload('account.admin.update', {
        did: SUBJECT,
        email: ' ops@example.com ',
      }),
    ).toEqual({ did: SUBJECT, email: 'ops@example.com' })
    expect(() =>
      normalizeApprovalPayload('account.admin.delete', { did: 'not-a-did' }),
    ).toThrow(/账号标识/)

    expect(
      normalizeApprovalPayload('notifications.send', {
        recipients: [SUBJECT],
        subject: ' 服务通知 ',
        contentMarkdown: '内容',
      }),
    ).toEqual({ recipients: [SUBJECT], subject: '服务通知', contentMarkdown: '内容' })

    expect(
      normalizeApprovalPayload('policy.write', {
        operation: 'set.addValues',
        input: { name: 'spam' },
      }),
    ).toEqual({ operation: 'set.addValues', input: { name: 'spam' } })
    expect(() =>
      normalizeApprovalPayload('policy.write', { operation: 'unknown', input: {} }),
    ).toThrow(/策略操作/)
  })

  it('validates account passwords and the sealed form stored in approvals', () => {
    expect(
      normalizeApprovalPayload('account.admin.update', {
        did: SUBJECT,
        password: '  correct horse  ',
      }),
    ).toEqual({ did: SUBJECT, password: '  correct horse  ' })
    expect(() =>
      normalizeApprovalPayload('account.admin.update', { did: SUBJECT, password: 'short' }),
    ).toThrow(/8 到 256/)
    expect(() =>
      normalizeApprovalPayload('account.admin.update', {
        did: SUBJECT,
        passwordSealed: 'v1.bm9uY2U.dGFn.Y2lwaGVy',
      }),
    ).toThrow(/未知字段/)
    expect(() => normalizeApprovalPayload('account.admin.update', { did: SUBJECT })).toThrow(
      /邮箱、账号名或密码/,
    )

    const sealed = 'v1.bm9uY2U.dGFn.Y2lwaGVy'
    expect(
      normalizeStoredAccountUpdatePayload({
        did: SUBJECT,
        email: 'ops@example.com',
        passwordSealed: sealed,
      }),
    ).toEqual({ did: SUBJECT, email: 'ops@example.com', passwordSealed: sealed })
    expect(() =>
      normalizeStoredAccountUpdatePayload({ did: SUBJECT, password: 'correct-horse' }),
    ).toThrow(/未知字段/)
    expect(() =>
      normalizeStoredAccountUpdatePayload({ did: SUBJECT, passwordSealed: 'plaintext' }),
    ).toThrow(/格式无效/)
  })
})