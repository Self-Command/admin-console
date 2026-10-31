import { com } from '@admin/lexicons'
import { isDidString } from '@atproto/lex-schema'
import type { Kysely } from 'kysely'
import {
  auditErrorCode,
  writeAudit,
  type AuditExecutor,
  type RequestMeta,
} from '../audit.js'
import { isSoleAdmin } from '../auth/roles.js'
import type { Database } from '../db/types.js'
import type { Logger } from '../logger.js'
import { callUpstream, type XrpcClient } from '../upstream/client.js'
import {
  invalid,
  normalizePolicyWritePayload,
  optionalText,
  rejectUnknown,
  requiredText,
  type PolicyOperation,
} from './action-payloads.js'
import {
  approvalRequired,
  executeWithApproval,
  type ApprovalContext,
  type ApprovalPayload,
} from './approvals.js'
import { isKnownPolicyOptionKey, validatePolicyOptionValue } from './policy-validation.js'
import { integer, iso, list, nonNegative, oneOf, rec, shape, str } from './values.js'

export type PolicyOptionView = com.selfcommand.admin.defs.PolicyOptionView
export type PolicySetView = com.selfcommand.admin.defs.PolicySetView
export type SafelinkRuleView = com.selfcommand.admin.defs.SafelinkRuleView
export type SafelinkEventView = com.selfcommand.admin.defs.SafelinkEventView
export type LabelerConfig = com.selfcommand.admin.defs.LabelerConfig

export type PolicyDeps = {
  ozone: XrpcClient
  appview: XrpcClient
  logger: Logger
}

export type PolicyWriteContext = PolicyDeps & {
  db: Kysely<Database>
  actor: string
  meta: RequestMeta
  ttlHours: number
}

export type PolicyRunContext = PolicyDeps & {
  db: AuditExecutor
  actor: string
  meta: RequestMeta
  approvalId?: string
}

export type PolicyWriteAction = {
  operation: PolicyOperation
  input: Record<string, unknown>
}

export type PolicyWriteResult = {
  option?: PolicyOptionView
  set?: PolicySetView
  event?: SafelinkEventView
}

const OZONE = {
  optionList: 'tools.ozone.setting.listOptions',
  optionUpsert: 'tools.ozone.setting.upsertOption',
  optionRemove: 'tools.ozone.setting.removeOptions',
  setList: 'tools.ozone.set.querySets',
  setGet: 'tools.ozone.set.getValues',
  setUpsert: 'tools.ozone.set.upsertSet',
  setAddValues: 'tools.ozone.set.addValues',
  setDeleteValues: 'tools.ozone.set.deleteValues',
  setDelete: 'tools.ozone.set.deleteSet',
  safelinkRules: 'tools.ozone.safelink.queryRules',
  safelinkEvents: 'tools.ozone.safelink.queryEvents',
  safelinkAdd: 'tools.ozone.safelink.addRule',
  safelinkUpdate: 'tools.ozone.safelink.updateRule',
  safelinkRemove: 'tools.ozone.safelink.removeRule',
  describe: 'com.atproto.server.describeServer',
} as const

const APPVIEW = {
  labelerServices: 'app.bsky.labeler.getServices',
} as const

const SCOPES = ['instance', 'personal'] as const
const SAFELINK_PATTERNS = ['domain', 'url'] as const
const SAFELINK_ACTIONS = ['block', 'warn', 'whitelist'] as const
const SAFELINK_REASONS = ['csam', 'spam', 'phishing', 'none'] as const

const OPERATION_LABELS: Record<PolicyOperation, string> = {
  'option.upsert': '保存策略选项',
  'option.remove': '删除策略选项',
  'set.upsert': '保存对象集合',
  'set.addValues': '向对象集合添加值',
  'set.deleteValues': '从对象集合移除值',
  'set.delete': '删除对象集合',
  'safelink.add': '新增外链规则',
  'safelink.update': '更新外链规则',
  'safelink.remove': '删除外链规则',
}

const NSID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+(\.[A-Za-z][A-Za-z0-9]*)+$/

function readNsid(value: unknown, name: string): string {
  const text = requiredText(value, name, 128)
  if (!NSID_PATTERN.test(text) && !isKnownPolicyOptionKey(text)) {
    throw invalid(`${name} 不是有效的接口标识`)
  }
  return text
}

function readScope(value: unknown): 'instance' | 'personal' {
  const scope = oneOf(value, SCOPES)
  if (!scope) throw invalid('选项范围必须是 instance 或 personal')
  return scope
}

function readStringArray(
  value: unknown,
  name: string,
  max: number,
  maxItemLength = 2048,
): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > max) {
    throw invalid(`${name} 必须包含 1 到 ${max} 个值`)
  }
  return value.map((entry, index) => requiredText(entry, `${name}[${index}]`, maxItemLength))
}

function readSetName(input: Record<string, unknown>): string {
  const name = requiredText(input.name, '集合名称', 128)
  if (name.length < 3) throw invalid('集合名称至少需要 3 个字符')
  return name
}

export function normalizePolicyOption(raw: unknown): PolicyOptionView {
  const item = rec(raw)
  const key = str(item?.key, 128)
  const scope = oneOf(item?.scope, SCOPES)
  if (!item || !key || !scope) throw shape('策略选项')
  const value = rec(item.value)
  const description = str(item.description, 2000)
  const managerRole = str(item.managerRole, 128)
  const updatedAt = iso(item.updatedAt)
  const updatedBy = str(item.lastUpdatedBy)
  return {
    key: key as PolicyOptionView['key'],
    scope,
    ...(value ? { value: value as never } : {}),
    ...(description ? { description } : {}),
    ...(managerRole ? { managerRole } : {}),
    ...(updatedAt ? { updatedAt: updatedAt as PolicyOptionView['updatedAt'] } : {}),
    ...(updatedBy && isDidString(updatedBy)
      ? { updatedBy: updatedBy as PolicyOptionView['updatedBy'] }
      : {}),
  }
}

export function normalizePolicySet(raw: unknown): PolicySetView {
  const item = rec(raw)
  const name = str(item?.name, 128)
  if (!item || !name) throw shape('对象集合')
  const description = str(item.description, 500)
  const valuesCount = nonNegative(item.setSize)
  const createdAt = iso(item.createdAt)
  const updatedAt = iso(item.updatedAt)
  return {
    name,
    ...(description ? { description } : {}),
    ...(valuesCount !== undefined ? { valuesCount } : {}),
    ...(createdAt ? { createdAt: createdAt as PolicySetView['createdAt'] } : {}),
    ...(updatedAt ? { updatedAt: updatedAt as PolicySetView['updatedAt'] } : {}),
  }
}

export function normalizeSafelinkRule(raw: unknown): SafelinkRuleView {
  const item = rec(raw)
  const url = str(item?.url)
  const pattern = str(item?.pattern, 32)
  const action = str(item?.action, 32)
  const reason = str(item?.reason, 32)
  if (!item || !url || !pattern || !action || !reason) throw shape('外链规则')
  const source = str(item.source, 128)
  const comment = str(item.comment, 500)
  const createdAt = iso(item.createdAt)
  const updatedAt = iso(item.updatedAt)
  return {
    url,
    pattern,
    action,
    reason,
    ...(source ? { source } : {}),
    ...(comment ? { comment } : {}),
    ...(createdAt ? { createdAt: createdAt as SafelinkRuleView['createdAt'] } : {}),
    ...(updatedAt ? { updatedAt: updatedAt as SafelinkRuleView['updatedAt'] } : {}),
  }
}

export function normalizeSafelinkEvent(raw: unknown): SafelinkEventView {
  const item = rec(raw)
  const url = str(item?.url)
  const pattern = str(item?.pattern, 32)
  const action = str(item?.action, 32)
  const reason = str(item?.reason, 32)
  const createdAt = iso(item?.createdAt)
  if (!item || !url || !pattern || !action || !reason || !createdAt) {
    throw shape('外链事件')
  }
  const id = integer(item.id)
  const source = str(item.source, 128)
  const comment = str(item.comment, 500)
  const createdBy = str(item.createdBy)
  return {
    ...(id !== undefined && id >= 1 ? { id } : {}),
    url,
    pattern,
    action,
    reason,
    ...(source ? { source } : {}),
    ...(comment ? { comment } : {}),
    ...(createdBy && isDidString(createdBy)
      ? { createdBy: createdBy as SafelinkEventView['createdBy'] }
      : {}),
    createdAt: createdAt as SafelinkEventView['createdAt'],
  }
}

export async function listPolicyOptions(
  deps: PolicyDeps,
  params: {
    scope?: string
    keys?: string[]
    prefix?: string
    limit: number
    cursor?: string
  },
): Promise<{ options: PolicyOptionView[]; cursor?: string }> {
  const scope = params.scope === undefined ? 'instance' : oneOf(params.scope, SCOPES)
  if (!scope) throw invalid('选项范围必须是 instance 或 personal')
  const result = await callUpstream<{ options?: unknown[]; cursor?: string }>(
    deps.ozone,
    OZONE.optionList,
    {
      params: {
        scope,
        keys: params.keys,
        prefix: params.prefix,
        limit: params.limit,
        cursor: params.cursor,
      },
    },
  )
  return {
    options: list(result.options).map(normalizePolicyOption),
    ...(typeof result.cursor === 'string' ? { cursor: result.cursor } : {}),
  }
}

export async function listPolicySets(
  deps: PolicyDeps,
  params: { namePrefix?: string; limit: number; cursor?: string },
): Promise<{ sets: PolicySetView[]; cursor?: string }> {
  const result = await callUpstream<{ sets?: unknown[]; cursor?: string }>(
    deps.ozone,
    OZONE.setList,
    { params: { namePrefix: params.namePrefix, limit: params.limit, cursor: params.cursor } },
  )
  return {
    sets: list(result.sets).map(normalizePolicySet),
    ...(typeof result.cursor === 'string' ? { cursor: result.cursor } : {}),
  }
}

export async function getPolicySet(
  deps: PolicyDeps,
  params: { name: string; limit: number; cursor?: string },
): Promise<{
  set: PolicySetView
  values: string[]
  cursor?: string
}> {
  const name = requiredText(params.name, '集合名称', 128)
  const result = await callUpstream<{
    set?: unknown
    values?: unknown[]
    cursor?: string
  }>(deps.ozone, OZONE.setGet, {
    params: { name, limit: params.limit, cursor: params.cursor },
  })
  return {
    set: normalizePolicySet(result.set),
    values: list(result.values)
      .map((entry) => str(entry))
      .filter((entry): entry is string => entry !== undefined),
    ...(typeof result.cursor === 'string' ? { cursor: result.cursor } : {}),
  }
}

function readPatternType(value: string | undefined): 'domain' | 'url' | undefined {
  if (value === undefined) return undefined
  const patternType = oneOf(value, SAFELINK_PATTERNS)
  if (!patternType) throw invalid('规则类型必须是 domain 或 url')
  return patternType
}

export async function listSafelinkRules(
  deps: PolicyDeps,
  params: {
    urls?: string[]
    patternType?: string
    actions?: string[]
    reason?: string
    source?: string
    limit: number
    cursor?: string
  },
): Promise<{ rules: SafelinkRuleView[]; cursor?: string }> {
  const patternType = readPatternType(params.patternType)
  const result = await callUpstream<{ rules?: unknown[]; cursor?: string }>(
    deps.ozone,
    OZONE.safelinkRules,
    {
      method: 'POST',
      body: {
        urls: params.urls,
        patternType,
        actions: params.actions,
        reason: params.reason,
        source: params.source,
        limit: params.limit,
        cursor: params.cursor,
        sortDirection: 'desc',
      },
    },
  )
  return {
    rules: list(result.rules).map(normalizeSafelinkRule),
    ...(typeof result.cursor === 'string' ? { cursor: result.cursor } : {}),
  }
}

export async function listSafelinkEvents(
  deps: PolicyDeps,
  params: {
    urls?: string[]
    patternType?: string
    limit: number
    cursor?: string
  },
): Promise<{ events: SafelinkEventView[]; cursor?: string }> {
  const patternType = readPatternType(params.patternType)
  const result = await callUpstream<{ events?: unknown[]; cursor?: string }>(
    deps.ozone,
    OZONE.safelinkEvents,
    {
      method: 'POST',
      body: {
        urls: params.urls,
        patternType,
        limit: params.limit,
        cursor: params.cursor,
        sortDirection: 'desc',
      },
    },
  )
  return {
    events: list(result.events).map(normalizeSafelinkEvent),
    ...(typeof result.cursor === 'string' ? { cursor: result.cursor } : {}),
  }
}

export async function getLabelerConfig(
  deps: PolicyDeps,
): Promise<{ labeler: LabelerConfig }> {
  let did: string | undefined
  try {
    const server = await callUpstream<unknown>(deps.ozone, OZONE.describe)
    const candidate = str(rec(server)?.did)
    if (candidate && isDidString(candidate)) did = candidate
  } catch (error) {
    deps.logger.warn('labeler describe failed', {
      error: error instanceof Error ? error.name : 'Error',
    })
    return {
      labeler: {
        available: false,
        reason: '暂时无法读取审核服务信息，请稍后重试。',
      },
    }
  }

  if (!did) {
    return {
      labeler: {
        available: false,
        reason: '审核服务未返回有效的服务标识，请联系部署管理员检查配置。',
      },
    }
  }
  const labelerDid = did as LabelerConfig['did']

  try {
    const result = await callUpstream<{ views?: unknown[] }>(
      deps.appview,
      APPVIEW.labelerServices,
      { params: { dids: [did], detailed: true } },
    )
    const view = rec(list(result.views)[0])
    if (!view) {
      return {
        labeler: {
          available: false,
          did: labelerDid,
          reason: '当前部署尚未在内容服务中注册标签器，标签信息暂不可用。',
        },
      }
    }
    const creator = rec(view.creator)
    const handle = str(creator?.handle, 256)
    const displayName = str(creator?.displayName, 200)
    const description = str(creator?.description, 1000)
    const policies = rec(view.policies)
    const labelValueDefinitions = list(policies?.labelValueDefinitions)
    return {
      labeler: {
        available: true,
        did: labelerDid,
        ...(handle ? { handle } : {}),
        ...(displayName ? { displayName } : {}),
        ...(description ? { description } : {}),
        ...(policies ? { policies: policies as never } : {}),
        ...(labelValueDefinitions.length
          ? { labels: { labelValueDefinitions } as never }
          : {}),
      },
    }
  } catch (error) {
    deps.logger.warn('labeler config lookup failed', {
      error: error instanceof Error ? error.name : 'Error',
    })
    return {
      labeler: {
        available: false,
        did: labelerDid,
        reason: '暂时无法读取标签器配置，请稍后重试。',
      },
    }
  }
}

function policyAuditAction(operation: PolicyOperation): string {
  if (operation.startsWith('option.')) {
    return 'com.selfcommand.admin.policy.option.act'
  }
  if (operation.startsWith('set.')) {
    return 'com.selfcommand.admin.policy.set.act'
  }
  return 'com.selfcommand.admin.policy.safelink.act'
}

function policyAuditTarget(action: PolicyWriteAction): string {
  const input = action.input
  if (action.operation.startsWith('option.')) {
    return typeof input.key === 'string' ? input.key : 'option'
  }
  if (action.operation.startsWith('set.')) {
    return typeof input.name === 'string' ? input.name : 'set'
  }
  return typeof input.url === 'string' ? input.url : 'safelink'
}

async function writePolicyAudit(
  ctx: PolicyRunContext,
  action: PolicyWriteAction,
  result: 'success' | 'error',
  detail: string,
): Promise<void> {
  await writeAudit(ctx.db, ctx.logger, {
    actor: ctx.actor,
    action: policyAuditAction(action.operation),
    targetType: 'policy',
    target: policyAuditTarget(action),
    result,
    detail,
    ...(ctx.approvalId ? { approvalId: ctx.approvalId } : {}),
    ...ctx.meta,
  })
}

export async function runPolicyWrite(
  ctx: PolicyRunContext,
  action: PolicyWriteAction,
): Promise<PolicyWriteResult> {
  const input = action.input
  const label = OPERATION_LABELS[action.operation]
  try {
    switch (action.operation) {
      case 'option.upsert': {
        rejectUnknown(input, ['key', 'scope', 'value', 'description', 'managerRole'], 'input')
        const key = readNsid(input.key, '选项标识')
        const scope = readScope(input.scope)
        if (input.value === undefined) throw invalid('选项值不能为空')
        if (!rec(input.value)) throw invalid('选项值必须是对象')
        validatePolicyOptionValue(key, input.value)
        const description = optionalText(input.description, '选项说明', 2000)
        const managerRole = optionalText(input.managerRole, '管理角色', 128)
        const raw = await callUpstream<{ option?: unknown }>(ctx.ozone, OZONE.optionUpsert, {
          method: 'POST',
          body: {
            key,
            scope,
            value: input.value,
            ...(description ? { description } : {}),
            ...(managerRole ? { managerRole } : {}),
          },
        })
        const option = normalizePolicyOption(raw?.option)
        await writePolicyAudit(ctx, action, 'success', `${label}：${key}`)
        return { option }
      }

      case 'option.remove': {
        rejectUnknown(input, ['keys', 'scope'], 'input')
        const keys = readStringArray(input.keys, '选项标识', 100, 128).map((entry, index) =>
          readNsid(entry, `选项标识[${index}]`),
        )
        const scope = readScope(input.scope)
        await callUpstream<unknown>(ctx.ozone, OZONE.optionRemove, {
          method: 'POST',
          body: { keys, scope },
        })
        await writePolicyAudit(ctx, action, 'success', `${label}：${keys.join('、')}`)
        return {}
      }

      case 'set.upsert': {
        rejectUnknown(input, ['name', 'description'], 'input')
        const name = readSetName(input)
        const description = optionalText(input.description, '集合说明', 1024)
        const raw = await callUpstream<unknown>(ctx.ozone, OZONE.setUpsert, {
          method: 'POST',
          body: { name, ...(description ? { description } : {}) },
        })
        const set = normalizePolicySet(raw)
        await writePolicyAudit(ctx, action, 'success', `${label}：${name}`)
        return { set }
      }

      case 'set.addValues':
      case 'set.deleteValues': {
        rejectUnknown(input, ['name', 'values'], 'input')
        const name = readSetName(input)
        const values = readStringArray(input.values, '集合值', 1000)
        await callUpstream<unknown>(
          ctx.ozone,
          action.operation === 'set.addValues' ? OZONE.setAddValues : OZONE.setDeleteValues,
          { method: 'POST', body: { name, values } },
        )
        await writePolicyAudit(
          ctx,
          action,
          'success',
          `${label}：${name}（${values.length} 个值）`,
        )
        return {}
      }

      case 'set.delete': {
        rejectUnknown(input, ['name'], 'input')
        const name = readSetName(input)
        await callUpstream<unknown>(ctx.ozone, OZONE.setDelete, {
          method: 'POST',
          body: { name },
        })
        await writePolicyAudit(ctx, action, 'success', `${label}：${name}`)
        return {}
      }

      case 'safelink.add':
      case 'safelink.update': {
        rejectUnknown(input, ['url', 'pattern', 'action', 'reason', 'source', 'comment'], 'input')
        const url = requiredText(input.url, '规则地址', 2048)
        const pattern = oneOf(input.pattern, SAFELINK_PATTERNS)
        if (!pattern) throw invalid('规则类型必须是 domain 或 url')
        const safelinkAction = oneOf(input.action, SAFELINK_ACTIONS)
        if (!safelinkAction) throw invalid('处置方式必须是 block、warn 或 whitelist')
        const reason = oneOf(input.reason, SAFELINK_REASONS)
        if (!reason) throw invalid('规则原因必须是 csam、spam、phishing 或 none')
        const source = optionalText(input.source, '规则来源', 128)
        const comment = optionalText(input.comment, '规则备注', 500)
        const raw = await callUpstream<unknown>(
          ctx.ozone,
          action.operation === 'safelink.add' ? OZONE.safelinkAdd : OZONE.safelinkUpdate,
          {
            method: 'POST',
            body: {
              url,
              pattern,
              action: safelinkAction,
              reason,
              ...(source ? { source } : {}),
              ...(comment ? { comment } : {}),
              createdBy: ctx.actor,
            },
          },
        )
        let event: SafelinkEventView | undefined
        try {
          event = normalizeSafelinkEvent(raw)
        } catch {
          event = undefined
        }
        await writePolicyAudit(ctx, action, 'success', `${label}：${url}`)
        return event ? { event } : {}
      }

      case 'safelink.remove': {
        rejectUnknown(input, ['url', 'pattern', 'source', 'comment'], 'input')
        const url = requiredText(input.url, '规则地址', 2048)
        const pattern = oneOf(input.pattern, SAFELINK_PATTERNS)
        if (!pattern) throw invalid('规则类型必须是 domain 或 url')
        const source = optionalText(input.source, '规则来源', 128)
        const comment = optionalText(input.comment, '规则备注', 500)
        const raw = await callUpstream<unknown>(ctx.ozone, OZONE.safelinkRemove, {
          method: 'POST',
          body: {
            url,
            pattern,
            ...(source ? { source } : {}),
            ...(comment ? { comment } : {}),
            createdBy: ctx.actor,
          },
        })
        let event: SafelinkEventView | undefined
        try {
          event = normalizeSafelinkEvent(raw)
        } catch {
          event = undefined
        }
        await writePolicyAudit(ctx, action, 'success', `${label}：${url}`)
        return event ? { event } : {}
      }

      default:
        throw invalid('策略操作不是受支持的动作')
    }
  } catch (error) {
    await writePolicyAudit(
      ctx,
      action,
      'error',
      `${label}未完成（错误码：${auditErrorCode(error)}）`,
    )
    throw error
  }
}

function approvalContext(ctx: PolicyWriteContext): ApprovalContext {
  return {
    db: ctx.db,
    logger: ctx.logger,
    actor: ctx.actor,
    meta: ctx.meta,
    ttlHours: ctx.ttlHours,
  }
}

async function actOnPolicy(
  ctx: PolicyWriteContext,
  input: { operation: string; input: unknown; approvalId?: string },
  prefix: 'option.' | 'set.' | 'safelink.',
): Promise<PolicyWriteResult> {
  if (!input.operation.startsWith(prefix)) {
    throw invalid('策略操作与当前接口不匹配')
  }
  const action = normalizePolicyWritePayload({
    operation: input.operation,
    input: input.input,
  })
  const approvalId = str(input.approvalId, 64)
  const approvalPayload: ApprovalPayload = {
    operation: action.operation,
    input: action.input,
  }

  if (approvalId) {
    let result: PolicyWriteResult | undefined
    await executeWithApproval(approvalContext(ctx), {
      id: approvalId,
      action: 'policy.write',
      payload: approvalPayload,
      run: async (trx) => {
        result = await runPolicyWrite({ ...ctx, db: trx, approvalId }, action)
      },
    })
    if (!result) throw invalid('审批执行未返回策略结果')
    return result
  }

  if (!(await isSoleAdmin(ctx.db))) throw approvalRequired('policy.write')
  return runPolicyWrite(ctx, action)
}

export async function actOnPolicyOption(
  ctx: PolicyWriteContext,
  input: com.selfcommand.admin.policy.option.act.$InputBody,
): Promise<com.selfcommand.admin.policy.option.act.$OutputBody> {
  return actOnPolicy(ctx, input, 'option.')
}

export async function actOnPolicySet(
  ctx: PolicyWriteContext,
  input: com.selfcommand.admin.policy.set.act.$InputBody,
): Promise<com.selfcommand.admin.policy.set.act.$OutputBody> {
  return actOnPolicy(ctx, input, 'set.')
}

export async function actOnPolicySafelink(
  ctx: PolicyWriteContext,
  input: com.selfcommand.admin.policy.safelink.act.$InputBody,
): Promise<com.selfcommand.admin.policy.safelink.act.$OutputBody> {
  return actOnPolicy(ctx, input, 'safelink.')
}
