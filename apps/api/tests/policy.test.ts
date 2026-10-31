import { describe, expect, it } from 'vitest'
import { silentLogger } from '../src/logger.js'
import {
  actOnPolicyOption,
  actOnPolicySet,
  getLabelerConfig,
  getPolicySet,
  listPolicyOptions,
  listSafelinkRules,
  normalizePolicyOption,
  normalizePolicySet,
  normalizeSafelinkEvent,
  normalizeSafelinkRule,
  runPolicyWrite,
  type PolicyWriteContext,
} from '../src/services/policy.js'
import { createFakeAppview, createFakeUpstream } from './helpers/fake-upstream.js'

const CREATED_AT = '2026-10-29T08:00:00.000Z'

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
  deps: {
    ozone: PolicyWriteContext['ozone']
    appview: PolicyWriteContext['appview']
    logger?: PolicyWriteContext['logger']
  },
): PolicyWriteContext {
  return {
    db: db as PolicyWriteContext['db'],
    ozone: deps.ozone,
    appview: deps.appview,
    logger: deps.logger ?? silentLogger,
    actor: 'did:plc:admin',
    meta: {},
    ttlHours: 24,
  }
}

function policyDeps(ozone: PolicyWriteContext['ozone'], appview?: PolicyWriteContext['appview']) {
  return { ozone, appview: appview ?? createFakeAppview(), logger: silentLogger }
}

describe('policy view normalization', () => {
  it('maps options, sets, rules and events', () => {
    expect(
      normalizePolicyOption({
        key: 'tools.ozone.setting.test',
        scope: 'instance',
        value: { enabled: true },
        description: '接口开关',
        lastUpdatedBy: 'did:plc:admin',
        updatedAt: CREATED_AT,
      }),
    ).toEqual({
      key: 'tools.ozone.setting.test',
      scope: 'instance',
      value: { enabled: true },
      description: '接口开关',
      updatedBy: 'did:plc:admin',
      updatedAt: CREATED_AT,
    })

    expect(
      normalizePolicySet({
        name: 'spam',
        description: '垃圾信息集合',
        setSize: 3,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      }),
    ).toEqual({
      name: 'spam',
      description: '垃圾信息集合',
      valuesCount: 3,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    })

    expect(
      normalizeSafelinkRule({
        url: 'spam.example',
        pattern: 'domain',
        action: 'block',
        reason: 'spam',
        source: 'manual',
        comment: '人工添加',
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      }),
    ).toMatchObject({ url: 'spam.example', pattern: 'domain', action: 'block', reason: 'spam' })

    expect(
      normalizeSafelinkEvent({
        id: 8,
        url: 'spam.example',
        pattern: 'domain',
        action: 'block',
        reason: 'spam',
        createdBy: 'did:plc:admin',
        createdAt: CREATED_AT,
      }),
    ).toMatchObject({ id: 8, url: 'spam.example', createdBy: 'did:plc:admin' })
  })

  it('rejects values that do not match the policy model', () => {
    expect(() => normalizePolicyOption({ key: 'tools.ozone.setting.test', scope: 'global' })).toThrow(
      /无法识别的策略选项/,
    )
    expect(() => normalizePolicySet({ description: '缺少名称' })).toThrow(/无法识别的对象集合/)
    expect(() =>
      normalizeSafelinkRule({ url: 'spam.example', pattern: 'domain', action: 'block' }),
    ).toThrow(/无法识别的外链规则/)
    expect(() =>
      normalizeSafelinkEvent({ url: 'spam.example', pattern: 'domain', action: 'block', reason: 'spam' }),
    ).toThrow(/无法识别的外链事件/)
  })
})

describe('policy reads', () => {
  it('defaults the option scope to the instance and validates overrides', async () => {
    const calls: unknown[] = []
    const ozone = createFakeUpstream((nsid, options) => {
      if (nsid === 'tools.ozone.setting.listOptions') {
        calls.push(options?.params)
        return { options: [] }
      }
      return {}
    })

    await listPolicyOptions(policyDeps(ozone), { limit: 50 })
    expect(calls[0]).toMatchObject({ scope: 'instance', limit: 50 })

    await expect(
      listPolicyOptions(policyDeps(ozone), { scope: 'global', limit: 50 }),
    ).rejects.toMatchObject({ status: 400, body: { error: 'InvalidRequest' } })
    expect(calls).toHaveLength(1)
  })

  it('returns a set with its values', async () => {
    const ozone = createFakeUpstream((nsid) =>
      nsid === 'tools.ozone.set.getValues'
        ? {
            set: { name: 'spam', setSize: 2 },
            values: ['did:plc:a', 'did:plc:b'],
          }
        : {},
    )
    await expect(
      getPolicySet(policyDeps(ozone), { name: 'spam', limit: 100 }),
    ).resolves.toMatchObject({
      set: { name: 'spam', valuesCount: 2 },
      values: ['did:plc:a', 'did:plc:b'],
    })
  })

  it('lists safelink rules as a search request', async () => {
    const ozone = createFakeUpstream((nsid) =>
      nsid === 'tools.ozone.safelink.queryRules' ? { rules: [] } : {},
    )
    await listSafelinkRules(policyDeps(ozone), {
      urls: ['spam.example'],
      patternType: 'domain',
      limit: 25,
    })
    const call = ozone.calls.find((entry) => entry.nsid === 'tools.ozone.safelink.queryRules')
    expect(call?.options).toMatchObject({
      method: 'POST',
      body: { urls: ['spam.example'], patternType: 'domain', sortDirection: 'desc' },
    })
    await expect(
      listSafelinkRules(policyDeps(ozone), { patternType: 'wildcard', limit: 25 }),
    ).rejects.toMatchObject({ status: 400, body: { error: 'InvalidRequest' } })
  })
})

describe('labeler configuration', () => {
  it('reads the labeler identity and declared labels', async () => {
    const ozone = createFakeUpstream((nsid) =>
      nsid === 'com.atproto.server.describeServer' ? { did: 'did:web:ozone.test' } : {},
    )
    await expect(
      getLabelerConfig(policyDeps(ozone, createFakeAppview())),
    ).resolves.toMatchObject({
      labeler: {
        available: true,
        did: 'did:web:ozone.test',
        displayName: '社区审核服务',
      },
    })
  })

  it('degrades to an unavailable state with a formal reason', async () => {
    const failing = createFakeUpstream(() => {
      throw new Error('describe failed')
    })
    await expect(getLabelerConfig(policyDeps(failing))).resolves.toMatchObject({
      labeler: { available: false, reason: '暂时无法读取审核服务信息，请稍后重试。' },
    })

    const ozone = createFakeUpstream((nsid) =>
      nsid === 'com.atproto.server.describeServer' ? { did: 'did:web:ozone.test' } : {},
    )
    const emptyAppview = createFakeUpstream(() => ({ views: [] }), { name: 'AppView' })
    await expect(getLabelerConfig(policyDeps(ozone, emptyAppview))).resolves.toMatchObject({
      labeler: {
        available: false,
        reason: '当前部署尚未在内容服务中注册标签器，标签信息暂不可用。',
      },
    })
  })
})

describe('policy writes', () => {
  it('rejects an operation outside the endpoint family', async () => {
    const ozone = createFakeUpstream(() => {
      throw new Error('upstream should not be called')
    })
    const ctx = writeContext({}, { ozone, appview: createFakeAppview() })
    await expect(
      actOnPolicyOption(ctx, {
        operation: 'set.upsert',
        input: { name: 'spam' },
      }),
    ).rejects.toMatchObject({ status: 400, body: { error: 'InvalidRequest' } })
    expect(ozone.calls).toHaveLength(0)
  })

  it('requires an approval for policy changes while other administrators exist', async () => {
    const ozone = createFakeUpstream(() => {
      throw new Error('upstream should not be called')
    })
    const ctx = writeContext(fakeAdminCount(2), { ozone, appview: createFakeAppview() })
    await expect(
      actOnPolicySet(ctx, {
        operation: 'set.upsert',
        input: { name: 'spam', description: '垃圾信息集合' },
      }),
    ).rejects.toMatchObject({ status: 409, body: { error: 'ApprovalRequired' } })
    expect(ozone.calls).toHaveLength(0)
  })

  it('upserts a set directly for the sole administrator', async () => {
    const ozone = createFakeUpstream((nsid) =>
      nsid === 'tools.ozone.set.upsertSet' ? { name: 'spam', setSize: 0 } : {},
    )
    const ctx = writeContext(fakeAdminCount(1), { ozone, appview: createFakeAppview() })
    await expect(
      actOnPolicySet(ctx, {
        operation: 'set.upsert',
        input: { name: 'spam', description: '垃圾信息集合' },
      }),
    ).resolves.toMatchObject({ set: { name: 'spam' } })
    const call = ozone.calls.find((entry) => entry.nsid === 'tools.ozone.set.upsertSet')
    expect(call?.options?.body).toEqual({ name: 'spam', description: '垃圾信息集合' })
  })

  it('validates option and safelink fields before calling upstream', async () => {
    const ozone = createFakeUpstream(() => ({}))
    const ctx = writeContext({}, { ozone, appview: createFakeAppview() })

    await expect(
      runPolicyWrite(
        { ...ctx, db: fakeAdminCount(1) as never },
        { operation: 'option.upsert', input: { key: 'not-an-nsid', scope: 'instance', value: {} } },
      ),
    ).rejects.toMatchObject({ status: 400, body: { error: 'InvalidRequest' } })

    await expect(
      runPolicyWrite(
        { ...ctx, db: fakeAdminCount(1) as never },
        {
          operation: 'safelink.add',
          input: { url: 'spam.example', pattern: 'wildcard', action: 'block', reason: 'spam' },
        },
      ),
    ).rejects.toMatchObject({ status: 400, body: { error: 'InvalidRequest' } })

    expect(ozone.calls).toHaveLength(0)
  })
})

const UPSERT_OPTION = 'tools.ozone.setting.upsertOption'

type PolicyOptionCase = {
  name: string
  key: string
  valid: Record<string, unknown>
  invalid: Record<string, unknown>
  message: RegExp
}

const POLICY_OPTION_CASES: PolicyOptionCase[] = [
  {
    name: 'priority levels',
    key: 'tools.ozone.setting.priorityLevels',
    valid: {
      urgent: {
        name: '紧急',
        description: '一小时内处理',
        targetResolutionMinutes: 60,
        score: 10,
      },
    },
    invalid: {
      urgent: { name: '紧急', targetResolutionMinutes: -1, score: 10 },
    },
    message: /priorityLevels 中「urgent」的 targetResolutionMinutes 必须是非负整数/,
  },
  {
    name: 'report priority levels',
    key: 'tools.ozone.setting.reportPriorityLevels',
    valid: { spam: 'urgent' },
    invalid: { spam: '   ' },
    message: /reportPriorityLevels 中「spam」 不能为空/,
  },
  {
    name: 'severity levels',
    key: 'tools.ozone.setting.severityLevels',
    valid: {
      sev1: {
        name: '轻度',
        description: '首次提醒',
        strikeCount: 0,
        strikeOnOccurrence: 1,
        firstOccurrenceStrikeCount: 0,
        needsTakedown: false,
        expiryInDays: 30,
        contentEmailSummary: '内容摘要',
        accountEmailSummary: '账号摘要',
      },
    },
    invalid: { sev1: { name: '轻度', strikeCount: 1.5 } },
    message: /severityLevels 中「sev1」的 strikeCount 必须是非负整数/,
  },
  {
    name: 'protected tags',
    key: 'tools.ozone.setting.protectedTags',
    valid: {
      sensitive: {
        moderators: ['did:plc:moderator'],
        roles: ['tools.ozone.team.defs#roleModerator'],
      },
    },
    invalid: { sensitive: { moderators: ['admin'] } },
    message: /protectedTags 中「sensitive」的 moderators\[0\] 必须是账号标识/,
  },
  {
    name: 'label groups',
    key: 'tools.ozone.setting.labelGroups',
    valid: {
      harassment: { labels: ['harassment', 'bullying'], note: '骚扰标签组', color: '#A1b2c3' },
    },
    invalid: { harassment: { labels: ['harassment'], color: 'red' } },
    message: /labelGroups 中「harassment」的 color 必须是 6 位十六进制颜色值/,
  },
  {
    name: 'policy list',
    key: 'tools.ozone.setting.policyList',
    valid: {
      harassment: {
        name: '骚扰',
        description: '骚扰与欺凌内容',
        url: 'https://example.com/policy',
        emailSummary: '摘要',
        emailBullets: '要点',
        emailExtraNotes: '补充',
        severityLevels: {
          sev1: { description: '轻度骚扰', isDefault: true, targetServices: ['appview', 'pds'] },
        },
      },
    },
    invalid: {
      harassment: {
        name: '骚扰',
        description: '骚扰与欺凌内容',
        severityLevels: { sev1: { description: '轻度骚扰', isDefault: 'yes' } },
      },
    },
    message: /policyList 中「harassment」的 severityLevels 中「sev1」的 isDefault 必须是布尔值/,
  },
]

function optionUpstream(key: string, value: unknown) {
  return createFakeUpstream((nsid) =>
    nsid === UPSERT_OPTION ? { option: { key, scope: 'instance', value } } : {},
  )
}

describe('policy option value validation', () => {
  for (const testCase of POLICY_OPTION_CASES) {
    it(`accepts a valid value for ${testCase.name}`, async () => {
      const ozone = optionUpstream(testCase.key, testCase.valid)
      const ctx = writeContext({}, { ozone, appview: createFakeAppview() })

      await expect(
        runPolicyWrite(ctx, {
          operation: 'option.upsert',
          input: { key: testCase.key, scope: 'instance', value: testCase.valid },
        }),
      ).resolves.toMatchObject({ option: { key: testCase.key } })
    })

    it(`rejects an invalid value for ${testCase.name} without calling upstream`, async () => {
      const ozone = createFakeUpstream(() => {
        throw new Error('upstream should not be called')
      })
      const ctx = writeContext({}, { ozone, appview: createFakeAppview() })

      await expect(
        runPolicyWrite(ctx, {
          operation: 'option.upsert',
          input: { key: testCase.key, scope: 'instance', value: testCase.invalid },
        }),
      ).rejects.toMatchObject({
        status: 400,
        body: { error: 'InvalidRequest', message: expect.stringMatching(testCase.message) },
      })
      expect(ozone.calls.filter((call) => call.nsid === UPSERT_OPTION)).toHaveLength(0)
    })
  }

  it('keeps accepting unknown option keys', async () => {
    const ozone = optionUpstream('tools.ozone.setting.custom', { enabled: true })
    const ctx = writeContext({}, { ozone, appview: createFakeAppview() })

    await expect(
      runPolicyWrite(ctx, {
        operation: 'option.upsert',
        input: {
          key: 'tools.ozone.setting.custom',
          scope: 'instance',
          value: { enabled: true },
        },
      }),
    ).resolves.toMatchObject({ option: { key: 'tools.ozone.setting.custom' } })
  })

  it('accepts unknown option keys with camelCase name segments', async () => {
    const ozone = optionUpstream('tools.ozone.setting.customFlag', { enabled: true })
    const ctx = writeContext({}, { ozone, appview: createFakeAppview() })

    await expect(
      runPolicyWrite(ctx, {
        operation: 'option.upsert',
        input: {
          key: 'tools.ozone.setting.customFlag',
          scope: 'instance',
          value: { enabled: true },
        },
      }),
    ).resolves.toMatchObject({ option: { key: 'tools.ozone.setting.customFlag' } })
  })

  it('rejects unknown fields in structured values', async () => {
    const cases = [
      {
        key: 'tools.ozone.setting.severityLevels',
        value: { sev1: { name: '轻度', extra: true } },
      },
      {
        key: 'tools.ozone.setting.protectedTags',
        value: { tag: { moderators: ['did:plc:moderator'], extra: true } },
      },
      {
        key: 'tools.ozone.setting.labelGroups',
        value: { group: { labels: [], extra: true } },
      },
      {
        key: 'tools.ozone.setting.policyList',
        value: { policy: { name: '规则', description: '说明', extra: true } },
      },
    ]

    for (const entry of cases) {
      const ozone = createFakeUpstream(() => {
        throw new Error('upstream should not be called')
      })
      const ctx = writeContext({}, { ozone, appview: createFakeAppview() })

      await expect(
        runPolicyWrite(ctx, {
          operation: 'option.upsert',
          input: { key: entry.key, scope: 'instance', value: entry.value },
        }),
      ).rejects.toMatchObject({
        status: 400,
        body: { error: 'InvalidRequest', message: expect.stringMatching(/包含未知字段：extra/) },
      })
      expect(ozone.calls).toHaveLength(0)
    }
  })
})
