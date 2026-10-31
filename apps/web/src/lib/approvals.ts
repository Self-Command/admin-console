import type {
  ApprovalAction,
  ApprovalStatus,
  ModerationAction,
  ModerationSubjectType,
  PolicyOperation,
  VerificationGrantInput,
  VerificationView,
} from '@/lib/data/types'
import { AdminApiError } from '@/lib/api/admin-client'
import type { RoleName } from '@/lib/roles'
import { roleLabels } from '@/lib/roles'

export const approvalActionLabels: Record<ApprovalAction, string> = {
  'settings.resetAll': '全部恢复默认设置',
  'role.revoke': '撤销管理员角色',
  'role.demote': '降级管理员角色',
  'role.import': '批量导入角色',
  'moderation.takedown': '内容处置',
  'moderation.batch': '批量内容处置',
  'moderation.label': '内容打标',
  'verification.grant': '授予认证',
  'verification.revoke': '撤销认证',
  'account.admin.update': '调整账号资料',
  'account.admin.delete': '删除账号',
  'notifications.send': '发送系统通知',
  'policy.write': '发布社区政策',
  'announcement.publish': '发布站内公告',
  'announcement.archive': '下线站内公告',
}

export const approvalActionDescriptions: Record<ApprovalAction, string> = {
  'settings.resetAll': '把全部运行时设置恢复为内置默认值，并记录设置版本。',
  'role.revoke': '移除目标账号的管理员角色，该账号将立即失去后台权限。',
  'role.demote': '把目标管理员降级为运营或只读角色。',
  'role.import': '按导入批次创建多条角色绑定，任一行冲突则整批不写入。',
  'moderation.takedown': '对单个对象执行下架或禁言，并写入处置记录。',
  'moderation.batch': '对多个对象批量执行下架、打标或禁言，全部成功后才视为完成。',
  'moderation.label': '为单个对象添加审核标签；该动作仅在审批范围中追加后要求审批。',
  'verification.grant': '为目标账号授予认证，认证信息同步到公开资料。',
  'verification.revoke': '撤销目标账号的认证，公开资料会在短时间内同步。',
  'account.admin.update': '调整账号资料或运营备注，不影响账号自有内容。',
  'account.admin.delete': '永久删除目标账号及其数据，操作不可撤销。',
  'notifications.send': '向选定账号发送系统通知，通知会展示在客户端。',
  'policy.write': '发布或更新社区政策文本，保存后立即对客户端生效。',
  'announcement.publish': '把公告草稿发布到选定位置，发布后客户端可见。',
  'announcement.archive': '将已发布的公告下线，客户端不再展示该公告。',
}

export const approvalStatusLabels: Record<ApprovalStatus, string> = {
  pending: '待审批',
  executed: '已执行',
  rejected: '已拒绝',
  cancelled: '已撤回',
  expired: '已过期',
  failed: '执行失败',
}

export const approvalStatusVariants: Record<
  ApprovalStatus,
  'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive'
> = {
  pending: 'warning',
  executed: 'success',
  rejected: 'outline',
  cancelled: 'outline',
  expired: 'outline',
  failed: 'destructive',
}

export type ApprovalRequestDraft = {
  action: ApprovalAction
  targetType?: string
  target?: string
  summary: string
  payload: Record<string, unknown>
}

export function isApprovalRequired(cause: unknown): boolean {
  return (
    cause instanceof AdminApiError &&
    cause.kind === 'conflict' &&
    cause.code === 'ApprovalRequired'
  )
}

export function revokeApprovalDraft(subject: string): ApprovalRequestDraft {
  return {
    action: 'role.revoke',
    targetType: 'role',
    target: subject,
    summary: `撤销 ${subject} 的管理员角色`,
    payload: { subject },
  }
}

export function demoteApprovalDraft(
  subject: string,
  role: Exclude<RoleName, 'admin'>,
  note?: string,
): ApprovalRequestDraft {
  return {
    action: 'role.demote',
    targetType: 'role',
    target: subject,
    summary: `将 ${subject} 降级为${roleLabels[role]}角色`,
    payload: { subject, role, ...(note ? { note } : {}) },
  }
}

export function importApprovalDraft(
  bindings: Array<{ subject: string; role: RoleName; note?: string }>,
): ApprovalRequestDraft {
  return {
    action: 'role.import',
    targetType: 'role',
    target: 'batch',
    summary: `批量导入 ${bindings.length} 条角色绑定`,
    payload: { bindings },
  }
}

export function resetAllApprovalDraft(reason?: string): ApprovalRequestDraft {
  return {
    action: 'settings.resetAll',
    targetType: 'settings',
    target: 'all',
    summary: '将全部设置恢复内置默认值',
    payload: reason ? { reason } : {},
  }
}

export function verificationGrantApprovalDraft(
  verifications: VerificationGrantInput[],
): ApprovalRequestDraft {
  const first = verifications.length === 1 ? verifications[0] : undefined
  return {
    action: 'verification.grant',
    targetType: 'verification',
    target: first ? first.subject : 'batch',
    summary: first
      ? `为 ${first.displayName}（@${first.handle}）授予认证`
      : `为 ${verifications.length} 个账号授予认证`,
    payload: { verifications },
  }
}

export function verificationRevokeApprovalDraft(
  verifications: VerificationView[],
  reason?: string,
): ApprovalRequestDraft {
  const uris = verifications.map((item) => item.uri)
  const first = verifications.length === 1 ? verifications[0] : undefined
  return {
    action: 'verification.revoke',
    targetType: 'verification',
    target: first ? first.subject : 'batch',
    summary: first
      ? `撤销 ${first.displayName || (first.handle ? `@${first.handle}` : first.subject)} 的认证`
      : `撤销 ${uris.length} 条账号认证`,
    payload: { uris, ...(reason ? { reason } : {}) },
  }
}

export type NotificationApprovalInput = {
  recipients: string[]
  subject: string
  contentMarkdown: string
  templateId?: string
}

export function notificationSendApprovalDraft(
  input: NotificationApprovalInput,
): ApprovalRequestDraft {
  const first = input.recipients.length === 1 ? input.recipients[0] : undefined
  return {
    action: 'notifications.send',
    targetType: 'notification',
    target: first ?? `batch:${input.recipients.length}`,
    summary: first
      ? `向 ${first} 发送通知「${input.subject}」`
      : `向 ${input.recipients.length} 个账号发送通知「${input.subject}」`,
    payload: {
      recipients: input.recipients,
      subject: input.subject,
      contentMarkdown: input.contentMarkdown,
      ...(input.templateId ? { templateId: input.templateId } : {}),
    },
  }
}

export function policyWriteApprovalDraft(input: {
  operation: PolicyOperation
  input: Record<string, unknown>
  summary: string
  target?: string
}): ApprovalRequestDraft {
  return {
    action: 'policy.write',
    targetType: 'policy',
    ...(input.target ? { target: input.target } : {}),
    summary: input.summary,
    payload: { operation: input.operation, input: input.input },
  }
}

export type AccountAdminUpdateApprovalInput = {
  did: string
  email?: string
  handle?: string
  password?: string
}

function accountAdminFields(input: AccountAdminUpdateApprovalInput): string[] {
  return [
    ...(input.email ? ['邮箱'] : []),
    ...(input.handle ? ['账号名'] : []),
    ...(input.password ? ['密码'] : []),
  ]
}

export function accountAdminUpdateApprovalDraft(
  input: AccountAdminUpdateApprovalInput,
): ApprovalRequestDraft {
  return {
    action: 'account.admin.update',
    targetType: 'account',
    target: input.did,
    summary: `修改账号 ${input.did} 的${accountAdminFields(input).join('、')}`,
    payload: {
      did: input.did,
      ...(input.email ? { email: input.email } : {}),
      ...(input.handle ? { handle: input.handle } : {}),
      ...(input.password ? { password: input.password } : {}),
    },
  }
}

export function accountAdminDeleteApprovalDraft(
  did: string,
  handle?: string,
): ApprovalRequestDraft {
  return {
    action: 'account.admin.delete',
    targetType: 'account',
    target: did,
    summary: handle ? `删除账号 @${handle}` : `删除账号 ${did}`,
    payload: { did },
  }
}

export type ModerationApprovalInput = {
  subjects: string[]
  action: ModerationAction
  comment?: string
  reason?: string
  labels?: string[]
  durationInHours?: number
  reportId?: number
  acknowledgeAccountSubjects?: boolean
  subjectType?: ModerationSubjectType
}

export type ModerationApprovalAction =
  | 'moderation.takedown'
  | 'moderation.batch'
  | 'moderation.label'

export function requiredModerationApproval(
  subjects: string[],
  action: ModerationAction,
): ModerationApprovalAction | undefined {
  if (action !== 'takedown' && action !== 'label' && action !== 'mute') return undefined
  if (subjects.length > 1) return 'moderation.batch'
  return action === 'label' ? undefined : 'moderation.takedown'
}

export function announcementPublishApprovalDraft(announcement: {
  id: number
  title: string
}): ApprovalRequestDraft {
  return {
    action: 'announcement.publish',
    targetType: 'announcement',
    target: String(announcement.id),
    summary: `发布公告「${announcement.title}」`,
    payload: { announcementId: announcement.id },
  }
}

export function announcementArchiveApprovalDraft(announcement: {
  id: number
  title: string
}): ApprovalRequestDraft {
  return {
    action: 'announcement.archive',
    targetType: 'announcement',
    target: String(announcement.id),
    summary: `下线公告「${announcement.title}」`,
    payload: { announcementId: announcement.id },
  }
}

export function moderationApprovalDraft(
  input: ModerationApprovalInput,
  action: ModerationApprovalAction,
): ApprovalRequestDraft {
  const target = input.subjects.length === 1 ? input.subjects[0] : 'batch'
  return {
    action,
    targetType: input.subjectType ?? (input.subjects.length > 1 ? 'batch' : 'record'),
    target,
    summary:
      input.subjects.length === 1
        ? `对 ${input.subjects[0]} 执行${moderationActionLabels[input.action]}`
        : `对 ${input.subjects.length} 个对象执行${moderationActionLabels[input.action]}`,
    payload: {
      subjects: input.subjects,
      action: input.action,
      ...(input.comment ? { comment: input.comment } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.labels && input.labels.length > 0 ? { labels: input.labels } : {}),
      ...(input.durationInHours !== undefined
        ? { durationInHours: input.durationInHours }
        : {}),
      ...(input.reportId !== undefined ? { reportId: input.reportId } : {}),
      ...(input.acknowledgeAccountSubjects
        ? { acknowledgeAccountSubjects: true }
        : {}),
    },
  }
}

export const moderationActionLabels: Record<ModerationAction, string> = {
  takedown: '下架处置',
  reverseTakedown: '解除下架',
  acknowledge: '标记已处理',
  escalate: '升级处置',
  comment: '添加备注',
  label: '添加标签',
  mute: '禁言',
  unmute: '解除禁言',
}

export const moderationActionDescriptions: Record<ModerationAction, string> = {
  takedown: '对象将从客户端移除，需要他人审批后执行。',
  reverseTakedown: '撤销此前的下架处置，对象重新对客户端可见。',
  acknowledge: '记录已完成人工查看，不改变对象状态。',
  escalate: '把对象升级为更高级别处理，交由管理员跟进。',
  comment: '仅为对象添加内部备注，不影响展示。',
  label: '为对象添加审核标签，标签会同步到客户端。',
  mute: '限制对象作者发言，需要他人审批后执行。',
  unmute: '解除此前的禁言限制。',
}

export const destructiveModerationActions: ModerationAction[] = ['takedown', 'mute', 'label']
