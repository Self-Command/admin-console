import type {
  ModerationAction,
  ModerationSubjectType,
  ReportAction,
  ReportStatus,
  ReviewState,
  ScheduledActionStatus,
} from '@/lib/data/types'

export const reportStatusLabels: Record<ReportStatus, string> = {
  open: '待处理',
  closed: '已结案',
  escalated: '已升级',
  queued: '排队中',
  assigned: '已分配',
}

export const reportStatusVariants: Record<
  ReportStatus,
  'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive'
> = {
  open: 'warning',
  closed: 'success',
  escalated: 'destructive',
  queued: 'secondary',
  assigned: 'default',
}

export const reportActionLabels: Record<ReportAction, string> = {
  assign: '分配处理人',
  unassign: '取消分配',
  close: '结案',
  escalate: '升级处理',
  reopen: '重新打开',
}

export const subjectTypeLabels: Record<ModerationSubjectType, string> = {
  account: '账号',
  record: '内容',
  message: '消息',
  conversation: '会话',
}

export const reviewStateLabels: Record<ReviewState, string> = {
  open: '待处理',
  closed: '已结案',
  escalated: '已升级',
  none: '未审核',
}

export const reviewStateVariants: Record<
  ReviewState,
  'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive'
> = {
  open: 'warning',
  closed: 'success',
  escalated: 'destructive',
  none: 'outline',
}

export function isReversibleEvent(eventType: string): boolean {
  return (
    eventType === 'modEventTakedown' ||
    eventType === 'modEventMute' ||
    eventType === 'modEventMuteReporter'
  )
}

const REPORT_TYPE_LABELS: Record<string, string> = {
  reasonSpam: '垃圾信息',
  reasonViolation: '违反社区准则',
  reasonMisleading: '误导性内容',
  reasonSexual: '性相关不当内容',
  reasonRude: '不友善内容',
  reasonHarassment: '骚扰',
  reasonHate: '仇恨言论',
  reasonSelfHarm: '自伤相关',
  reasonThreat: '威胁',
  reasonImpersonation: '冒用身份',
  reasonChildSafety: '未成年人安全',
  reasonTerrorism: '恐怖主义内容',
  reasonGraphicMedia: '血腥内容',
  reasonIllegal: '违法内容',
  reasonViolence: '暴力内容',
  reasonRule: '规则违规',
  reasonAppeal: '申诉',
  reasonOther: '其他原因',
}

export function reportTypeLabel(value: string): string {
  const name = value.includes('#') ? value.split('#').at(-1) ?? value : value
  return REPORT_TYPE_LABELS[name] ?? '其他原因'
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  modEventTakedown: '下架处置',
  modEventReverseTakedown: '解除下架',
  modEventAcknowledge: '标记已处理',
  modEventEscalate: '升级处置',
  modEventComment: '添加备注',
  modEventLabel: '添加标签',
  modEventMute: '禁言',
  modEventUnmute: '解除禁言',
  modEventMuteReporter: '限制举报人',
  modEventUnmuteReporter: '解除举报人限制',
  modEventEmail: '发送通知',
  modEventResolveAppeal: '处理申诉',
  modEventReport: '新增举报',
  modEventDivert: '转移处理',
  modEventTag: '更新标签',
  modEventPriorityScore: '调整优先级',
  modEventAgeAssurance: '年龄核验',
}

export function eventTypeLabel(value: string): string {
  return EVENT_TYPE_LABELS[value] ?? '其他处置事件'
}

export const eventTypeOptions = Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}))

export const scheduledStatusLabels: Record<ScheduledActionStatus, string> = {
  pending: '待执行',
  executed: '已执行',
  cancelled: '已取消',
  failed: '执行失败',
}

export const scheduledStatusVariants: Record<
  ScheduledActionStatus,
  'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive'
> = {
  pending: 'warning',
  executed: 'success',
  cancelled: 'outline',
  failed: 'destructive',
}

export type ModerationActionOption = {
  value: ModerationAction
  label: string
  description: string
  tone: 'default' | 'destructive' | 'outline'
}

export const moderationActionOptions: ModerationActionOption[] = [
  {
    value: 'takedown',
    label: '下架内容',
    description: '内容从客户端移除；需要另一位管理员审批。',
    tone: 'destructive',
  },
  {
    value: 'label',
    label: '添加审核标签',
    description: '为内容添加审核标签并同步到客户端。',
    tone: 'default',
  },
  {
    value: 'mute',
    label: '禁言账号',
    description: '限制账号发言；需要另一位管理员审批。',
    tone: 'destructive',
  },
  {
    value: 'unmute',
    label: '解除禁言',
    description: '解除此前的禁言限制。',
    tone: 'outline',
  },
  {
    value: 'reverseTakedown',
    label: '解除下架',
    description: '撤销此前的下架处置，内容重新对客户端可见。',
    tone: 'outline',
  },
  {
    value: 'acknowledge',
    label: '标记已处理',
    description: '记录已完成人工查看，不改变对象状态。',
    tone: 'outline',
  },
  {
    value: 'escalate',
    label: '升级处置',
    description: '把对象升级为更高级别处理。',
    tone: 'default',
  },
  {
    value: 'comment',
    label: '添加内部备注',
    description: '仅记录处理备注，不影响对象状态。',
    tone: 'outline',
  },
]

export function isDestructiveAction(action: ModerationAction): boolean {
  return action === 'takedown' || action === 'mute' || action === 'label'
}

export function scheduledActionLabel(value: string): string {
  const known: Record<string, string> = {
    takedown: '下架处置',
    mute: '禁言',
    label: '添加标签',
    comment: '添加备注',
    escalate: '升级处置',
    acknowledge: '标记已处理',
  }
  return known[value] ?? eventTypeLabel(value)
}

export function subjectHref(
  subject: string,
  subjectType?: ModerationSubjectType,
): string | null {
  if (subject.startsWith('did:') && (subjectType === 'account' || subjectType === undefined)) {
    return `/directory/${encodeURIComponent(subject)}`
  }
  if (subject.startsWith('at://') && (subjectType === 'record' || subjectType === undefined)) {
    return `/content?uri=${encodeURIComponent(subject)}`
  }
  return null
}

export function truncateSubject(value: string, head = 22, tail = 8): string {
  if (value.length <= head + tail + 1) return value
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}
