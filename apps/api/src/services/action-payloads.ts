import { isDidString } from '@atproto/lex-schema'
import { LexServerError } from '@atproto/lex-server'

export const MODERATION_ACTIONS = [
  'takedown',
  'reverseTakedown',
  'acknowledge',
  'escalate',
  'comment',
  'label',
  'mute',
  'unmute',
] as const

export type ModerationActionName = (typeof MODERATION_ACTIONS)[number]

export type ModerationActPayload = {
  subjects: string[]
  action: ModerationActionName
  comment?: string
  reason?: string
  labels?: string[]
  durationInHours?: number
  reportId?: number
  acknowledgeAccountSubjects?: boolean
}

export type VerificationGrantPayload = {
  verifications: Array<{
    subject: string
    handle: string
    displayName: string
  }>
}

export type VerificationRevokePayload = {
  uris: string[]
  reason?: string
}

export type AccountUpdatePayload = {
  did: string
  email?: string
  handle?: string
  password?: string
  passwordSealed?: string
}

export type AccountDeletePayload = { did: string }

export type NotificationSendPayload = {
  recipients: string[]
  subject: string
  contentMarkdown: string
  templateId?: string
}

export const POLICY_OPERATIONS = [
  'option.upsert',
  'option.remove',
  'set.upsert',
  'set.addValues',
  'set.deleteValues',
  'set.delete',
  'safelink.add',
  'safelink.update',
  'safelink.remove',
] as const

export type PolicyOperation = (typeof POLICY_OPERATIONS)[number]

export type PolicyWritePayload = {
  operation: PolicyOperation
  input: Record<string, unknown>
}

export function invalid(message: string): LexServerError {
  return new LexServerError(400, { error: 'InvalidRequest', message })
}

export function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(`${name} 必须是对象`)
  }
  return value as Record<string, unknown>
}

export function rejectUnknown(
  value: Record<string, unknown>,
  allowed: readonly string[],
  name: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw invalid(`${name} 包含未知字段：${key}`)
  }
}

export function optionalText(
  value: unknown,
  name: string,
  max: number,
): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw invalid(`${name} 必须是文本`)
  const trimmed = value.trim()
  if (trimmed.length > max) throw invalid(`${name} 最多 ${max} 个字符`)
  return trimmed || undefined
}

export function requiredText(value: unknown, name: string, max: number): string {
  const text = optionalText(value, name, max)
  if (!text) throw invalid(`${name} 不能为空`)
  return text
}

function optionalInt(
  value: unknown,
  name: string,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw invalid(`${name} 必须是 ${min} 到 ${max} 之间的整数`)
  }
  return value
}

function isSubject(value: string): boolean {
  return isDidString(value) || value.startsWith('at://')
}

function readSubjects(value: unknown, name: string, max: number): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > max) {
    throw invalid(`${name} 必须包含 1 到 ${max} 个对象`)
  }
  return value.map((entry, index) => {
    if (typeof entry !== 'string' || !isSubject(entry)) {
      throw invalid(`${name}[${index}] 必须是账号标识或内容地址`)
    }
    return entry
  })
}

export function normalizeModerationActPayload(raw: unknown): ModerationActPayload {
  const payload = asRecord(raw, 'payload')
  rejectUnknown(
    payload,
    [
      'subjects',
      'action',
      'comment',
      'reason',
      'labels',
      'durationInHours',
      'reportId',
      'acknowledgeAccountSubjects',
    ],
    'payload',
  )
  const subjects = readSubjects(payload.subjects, 'payload.subjects', 100)
  if (
    typeof payload.action !== 'string' ||
    !(MODERATION_ACTIONS as readonly string[]).includes(payload.action)
  ) {
    throw invalid('payload.action 不是受支持的处置动作')
  }
  const action = payload.action as ModerationActionName
  const comment = optionalText(payload.comment, 'payload.comment', 2000)
  const reason = optionalText(payload.reason, 'payload.reason', 200)
  const durationInHours = optionalInt(payload.durationInHours, 'payload.durationInHours', 0, 87600)
  const reportId = optionalInt(payload.reportId, 'payload.reportId', 1, 2147483647)

  let labels: string[] | undefined
  if (payload.labels !== undefined) {
    if (!Array.isArray(payload.labels) || payload.labels.length === 0 || payload.labels.length > 10) {
      throw invalid('payload.labels 必须包含 1 到 10 个标签')
    }
    labels = payload.labels.map((entry, index) => {
      if (typeof entry !== 'string' || !entry.trim() || entry.length > 64) {
        throw invalid(`payload.labels[${index}] 不是有效的标签`)
      }
      return entry.trim()
    })
  }
  if (action === 'label' && !labels) {
    throw invalid('标签处置必须提供 payload.labels')
  }
  if (action !== 'label' && labels) {
    throw invalid('只有标签处置可以携带 payload.labels')
  }

  if (payload.acknowledgeAccountSubjects !== undefined && typeof payload.acknowledgeAccountSubjects !== 'boolean') {
    throw invalid('payload.acknowledgeAccountSubjects 必须是布尔值')
  }

  return {
    subjects,
    action,
    ...(comment ? { comment } : {}),
    ...(reason ? { reason } : {}),
    ...(labels ? { labels } : {}),
    ...(durationInHours !== undefined ? { durationInHours } : {}),
    ...(reportId !== undefined ? { reportId } : {}),
    ...(payload.acknowledgeAccountSubjects !== undefined
      ? { acknowledgeAccountSubjects: payload.acknowledgeAccountSubjects }
      : {}),
  }
}

export function normalizeVerificationGrantPayload(raw: unknown): VerificationGrantPayload {
  const payload = asRecord(raw, 'payload')
  rejectUnknown(payload, ['verifications'], 'payload')
  if (
    !Array.isArray(payload.verifications) ||
    payload.verifications.length === 0 ||
    payload.verifications.length > 100
  ) {
    throw invalid('payload.verifications 必须包含 1 到 100 条认证')
  }
  return {
    verifications: payload.verifications.map((entry, index) => {
      const item = asRecord(entry, `payload.verifications[${index}]`)
      rejectUnknown(item, ['subject', 'handle', 'displayName'], `payload.verifications[${index}]`)
      if (typeof item.subject !== 'string' || !isDidString(item.subject)) {
        throw invalid(`payload.verifications[${index}].subject 必须是账号标识`)
      }
      return {
        subject: item.subject,
        handle: requiredText(item.handle, `payload.verifications[${index}].handle`, 253),
        displayName: requiredText(
          item.displayName,
          `payload.verifications[${index}].displayName`,
          200,
        ),
      }
    }),
  }
}

export function normalizeVerificationRevokePayload(raw: unknown): VerificationRevokePayload {
  const payload = asRecord(raw, 'payload')
  rejectUnknown(payload, ['uris', 'reason'], 'payload')
  if (!Array.isArray(payload.uris) || payload.uris.length === 0 || payload.uris.length > 100) {
    throw invalid('payload.uris 必须包含 1 到 100 条认证记录')
  }
  const uris = payload.uris.map((entry, index) => {
    if (typeof entry !== 'string' || !entry.startsWith('at://')) {
      throw invalid(`payload.uris[${index}] 必须是认证记录地址`)
    }
    return entry
  })
  const reason = optionalText(payload.reason, 'payload.reason', 500)
  return { uris, ...(reason ? { reason } : {}) }
}

function accountUpdateFields(payload: Record<string, unknown>): {
  email?: string
  handle?: string
} {
  const email = optionalText(payload.email, 'payload.email', 320)
  if (email && (!email.includes('@') || /\s/.test(email))) {
    throw invalid('payload.email 不是有效的邮箱地址')
  }
  const handle = optionalText(payload.handle, 'payload.handle', 253)
  if (handle && !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(handle)) {
    throw invalid('payload.handle 不是有效的域名格式')
  }
  return { ...(email ? { email } : {}), ...(handle ? { handle } : {}) }
}

function readPassword(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.length < 8 || value.length > 256) {
    throw invalid('payload.password 长度必须在 8 到 256 个字符之间')
  }
  return value
}

export function normalizeAccountUpdatePayload(raw: unknown): AccountUpdatePayload {
  const payload = asRecord(raw, 'payload')
  rejectUnknown(payload, ['did', 'email', 'handle', 'password'], 'payload')
  if (typeof payload.did !== 'string' || !isDidString(payload.did)) {
    throw invalid('payload.did 必须是账号标识')
  }
  const fields = accountUpdateFields(payload)
  const password = readPassword(payload.password)
  if (!fields.email && !fields.handle && !password) {
    throw invalid('payload 至少需要提供邮箱、账号名或密码')
  }
  return { did: payload.did, ...fields, ...(password ? { password } : {}) }
}

export function normalizeStoredAccountUpdatePayload(raw: unknown): AccountUpdatePayload {
  const payload = asRecord(raw, 'payload')
  rejectUnknown(payload, ['did', 'email', 'handle', 'passwordSealed'], 'payload')
  if (typeof payload.did !== 'string' || !isDidString(payload.did)) {
    throw invalid('payload.did 必须是账号标识')
  }
  const fields = accountUpdateFields(payload)
  const sealed = payload.passwordSealed
  if (sealed !== undefined && (typeof sealed !== 'string' || !/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/.test(sealed))) {
    throw invalid('payload.passwordSealed 格式无效')
  }
  if (!fields.email && !fields.handle && !sealed) {
    throw invalid('payload 至少需要提供邮箱、账号名或密码')
  }
  return {
    did: payload.did,
    ...fields,
    ...(typeof sealed === 'string' ? { passwordSealed: sealed } : {}),
  }
}

export function normalizeAccountDeletePayload(raw: unknown): AccountDeletePayload {
  const payload = asRecord(raw, 'payload')
  rejectUnknown(payload, ['did'], 'payload')
  if (typeof payload.did !== 'string' || !isDidString(payload.did)) {
    throw invalid('payload.did 必须是账号标识')
  }
  return { did: payload.did }
}

export function normalizeNotificationSendPayload(raw: unknown): NotificationSendPayload {
  const payload = asRecord(raw, 'payload')
  rejectUnknown(payload, ['recipients', 'subject', 'contentMarkdown', 'templateId'], 'payload')
  if (!Array.isArray(payload.recipients) || payload.recipients.length === 0 || payload.recipients.length > 100) {
    throw invalid('payload.recipients 必须包含 1 到 100 个账号')
  }
  const recipients = payload.recipients.map((entry, index) => {
    if (typeof entry !== 'string' || !isDidString(entry)) {
      throw invalid(`payload.recipients[${index}] 必须是账号标识`)
    }
    return entry
  })
  return {
    recipients,
    subject: requiredText(payload.subject, 'payload.subject', 500),
    contentMarkdown: requiredText(payload.contentMarkdown, 'payload.contentMarkdown', 20000),
    ...(optionalText(payload.templateId, 'payload.templateId', 128)
      ? { templateId: optionalText(payload.templateId, 'payload.templateId', 128) as string }
      : {}),
  }
}

export function normalizePolicyWritePayload(raw: unknown): PolicyWritePayload {
  const payload = asRecord(raw, 'payload')
  rejectUnknown(payload, ['operation', 'input'], 'payload')
  if (
    typeof payload.operation !== 'string' ||
    !(POLICY_OPERATIONS as readonly string[]).includes(payload.operation)
  ) {
    throw invalid('payload.operation 不是受支持的策略操作')
  }
  const input = asRecord(payload.input, 'payload.input')
  if (JSON.stringify(input).length > 100000) throw invalid('payload.input 超出大小限制')
  return { operation: payload.operation as PolicyOperation, input }
}
