import { invalid, rejectUnknown } from './action-payloads.js'

const PRIORITY_LEVELS = 'tools.ozone.setting.priorityLevels'
const REPORT_PRIORITY_LEVELS = 'tools.ozone.setting.reportPriorityLevels'
const SEVERITY_LEVELS = 'tools.ozone.setting.severityLevels'
const PROTECTED_TAGS = 'tools.ozone.setting.protectedTags'
const LABEL_GROUPS = 'tools.ozone.setting.labelGroups'
const POLICY_LIST = 'tools.ozone.setting.policyList'

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(`${label} 必须是对象`)
  }
  return value as Record<string, unknown>
}

function entryLabel(parent: string, key: string): string {
  return `${parent} 中「${key}」`
}

function nonEmptyText(value: unknown, label: string): void {
  if (typeof value !== 'string' || !value.trim()) throw invalid(`${label} 不能为空`)
}

function requiredText(value: unknown, label: string, max: number): void {
  if (typeof value !== 'string' || !value.trim()) throw invalid(`${label} 不能为空`)
  if (value.trim().length > max) throw invalid(`${label} 最多 ${max} 个字符`)
}

function optionalText(value: unknown, label: string, max: number): void {
  if (value === undefined || value === null) return
  if (typeof value !== 'string') throw invalid(`${label} 必须是文本`)
  if (value.trim().length > max) throw invalid(`${label} 最多 ${max} 个字符`)
}

function nonNegativeInteger(value: unknown, label: string): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw invalid(`${label} 必须是非负整数`)
  }
}

function optionalNonNegativeInteger(value: unknown, label: string): void {
  if (value === undefined || value === null) return
  nonNegativeInteger(value, label)
}

function integerValue(value: unknown, label: string): void {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw invalid(`${label} 必须是整数`)
  }
}

function optionalBoolean(value: unknown, label: string): void {
  if (value === undefined || value === null) return
  if (typeof value !== 'boolean') throw invalid(`${label} 必须是布尔值`)
}

function booleanValue(value: unknown, label: string): void {
  if (typeof value !== 'boolean') throw invalid(`${label} 必须是布尔值`)
}

function httpUrl(value: unknown, label: string): void {
  if (typeof value !== 'string') throw invalid(`${label} 必须是 http 或 https 地址`)
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw invalid(`${label} 必须是 http 或 https 地址`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw invalid(`${label} 必须是 http 或 https 地址`)
  }
}

function validatePriorityLevels(value: unknown): void {
  const levels = asObject(value, PRIORITY_LEVELS)
  for (const [key, raw] of Object.entries(levels)) {
    const label = entryLabel(PRIORITY_LEVELS, key)
    const level = asObject(raw, label)
    requiredText(level.name, `${label}的 name`, 64)
    optionalText(level.description, `${label}的 description`, 1000)
    nonNegativeInteger(level.targetResolutionMinutes, `${label}的 targetResolutionMinutes`)
    integerValue(level.score, `${label}的 score`)
  }
}

function validateReportPriorityLevels(value: unknown): void {
  const levels = asObject(value, REPORT_PRIORITY_LEVELS)
  for (const [key, raw] of Object.entries(levels)) {
    nonEmptyText(raw, entryLabel(REPORT_PRIORITY_LEVELS, key))
  }
}

function validateSeverityLevels(value: unknown): void {
  const levels = asObject(value, SEVERITY_LEVELS)
  for (const [key, raw] of Object.entries(levels)) {
    const label = entryLabel(SEVERITY_LEVELS, key)
    const level = asObject(raw, label)
    rejectUnknown(
      level,
      [
        'name',
        'description',
        'strikeCount',
        'strikeOnOccurrence',
        'firstOccurrenceStrikeCount',
        'needsTakedown',
        'expiryInDays',
        'contentEmailSummary',
        'accountEmailSummary',
      ],
      label,
    )
    requiredText(level.name, `${label}的 name`, 64)
    optionalText(level.description, `${label}的 description`, 1000)
    optionalNonNegativeInteger(level.strikeCount, `${label}的 strikeCount`)
    optionalNonNegativeInteger(level.strikeOnOccurrence, `${label}的 strikeOnOccurrence`)
    optionalNonNegativeInteger(
      level.firstOccurrenceStrikeCount,
      `${label}的 firstOccurrenceStrikeCount`,
    )
    optionalBoolean(level.needsTakedown, `${label}的 needsTakedown`)
    optionalNonNegativeInteger(level.expiryInDays, `${label}的 expiryInDays`)
    optionalText(level.contentEmailSummary, `${label}的 contentEmailSummary`, 2000)
    optionalText(level.accountEmailSummary, `${label}的 accountEmailSummary`, 2000)
  }
}

function validateProtectedTags(value: unknown): void {
  const tags = asObject(value, PROTECTED_TAGS)
  for (const [key, raw] of Object.entries(tags)) {
    const label = entryLabel(PROTECTED_TAGS, key)
    const tag = asObject(raw, label)
    rejectUnknown(tag, ['moderators', 'roles'], label)

    const moderators = tag.moderators
    if (moderators !== undefined && moderators !== null) {
      if (!Array.isArray(moderators)) throw invalid(`${label}的 moderators 必须是数组`)
      moderators.forEach((entry, index) => {
        if (typeof entry !== 'string' || !entry.startsWith('did:')) {
          throw invalid(`${label}的 moderators[${index}] 必须是账号标识`)
        }
      })
    }

    const roles = tag.roles
    if (roles !== undefined && roles !== null) {
      if (!Array.isArray(roles)) throw invalid(`${label}的 roles 必须是数组`)
      roles.forEach((entry, index) => {
        nonEmptyText(entry, `${label}的 roles[${index}]`)
      })
    }
  }
}

function validateLabelGroups(value: unknown): void {
  const groups = asObject(value, LABEL_GROUPS)
  for (const [key, raw] of Object.entries(groups)) {
    const label = entryLabel(LABEL_GROUPS, key)
    const group = asObject(raw, label)
    rejectUnknown(group, ['labels', 'note', 'color'], label)

    const labels = group.labels
    if (!Array.isArray(labels)) throw invalid(`${label}的 labels 必须是数组`)
    if (labels.length > 100) throw invalid(`${label}的 labels 最多 100 个值`)
    labels.forEach((entry, index) => {
      nonEmptyText(entry, `${label}的 labels[${index}]`)
    })

    optionalText(group.note, `${label}的 note`, 1000)
    if (group.color !== undefined && group.color !== null) {
      if (typeof group.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(group.color)) {
        throw invalid(`${label}的 color 必须是 6 位十六进制颜色值`)
      }
    }
  }
}

function validatePolicyListSeverityLevels(value: unknown, label: string): void {
  const levels = asObject(value, `${label}的 severityLevels`)
  for (const [key, raw] of Object.entries(levels)) {
    const levelLabel = entryLabel(`${label}的 severityLevels`, key)
    const level = asObject(raw, levelLabel)
    rejectUnknown(level, ['description', 'isDefault', 'targetServices'], levelLabel)
    requiredText(level.description, `${levelLabel}的 description`, 1000)
    booleanValue(level.isDefault, `${levelLabel}的 isDefault`)

    const targetServices = level.targetServices
    if (targetServices !== undefined && targetServices !== null) {
      if (!Array.isArray(targetServices)) {
        throw invalid(`${levelLabel}的 targetServices 必须是数组`)
      }
      targetServices.forEach((service, index) => {
        if (service !== 'appview' && service !== 'pds') {
          throw invalid(`${levelLabel}的 targetServices[${index}] 只能是 appview 或 pds`)
        }
      })
    }
  }
}

function validatePolicyList(value: unknown): void {
  const policies = asObject(value, POLICY_LIST)
  for (const [key, raw] of Object.entries(policies)) {
    const label = entryLabel(POLICY_LIST, key)
    const policy = asObject(raw, label)
    rejectUnknown(
      policy,
      [
        'name',
        'description',
        'url',
        'emailSummary',
        'emailBullets',
        'emailExtraNotes',
        'severityLevels',
      ],
      label,
    )
    requiredText(policy.name, `${label}的 name`, 64)
    requiredText(policy.description, `${label}的 description`, 2000)
    if (policy.url !== undefined && policy.url !== null) {
      httpUrl(policy.url, `${label}的 url`)
    }
    optionalText(policy.emailSummary, `${label}的 emailSummary`, 4000)
    optionalText(policy.emailBullets, `${label}的 emailBullets`, 4000)
    optionalText(policy.emailExtraNotes, `${label}的 emailExtraNotes`, 4000)
    if (policy.severityLevels !== undefined && policy.severityLevels !== null) {
      validatePolicyListSeverityLevels(policy.severityLevels, label)
    }
  }
}

const VALIDATORS: Record<string, (value: unknown) => void> = {
  [PRIORITY_LEVELS]: validatePriorityLevels,
  [REPORT_PRIORITY_LEVELS]: validateReportPriorityLevels,
  [SEVERITY_LEVELS]: validateSeverityLevels,
  [PROTECTED_TAGS]: validateProtectedTags,
  [LABEL_GROUPS]: validateLabelGroups,
  [POLICY_LIST]: validatePolicyList,
}

const KNOWN_OPTION_KEYS = new Set(Object.keys(VALIDATORS))

// Official setting keys use camelCase and are not strict NSIDs.
export function isKnownPolicyOptionKey(key: string): boolean {
  return KNOWN_OPTION_KEYS.has(key)
}

/**
 * Validate the structure of known policy setting keys. Unknown keys keep the
 * previous behavior and are passed through without extra checks.
 */
export function validatePolicyOptionValue(key: string, value: unknown): void {
  const validator = VALIDATORS[key]
  if (!validator) return
  validator(value)
}
