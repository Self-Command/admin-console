import { com } from '@admin/lexicons'
import { isAtUriString, isDidString } from '@atproto/lex-schema'
import { LexServerError } from '@atproto/lex-server'
import { sql, type Kysely } from 'kysely'
import {
  auditErrorCode,
  writeAudit,
  type AuditExecutor,
  type RequestMeta,
} from '../audit.js'
import { isSoleAdmin } from '../auth/roles.js'
import type { ApprovalActionName, Database } from '../db/types.js'
import type { Logger } from '../logger.js'
import { isApprovalRequiredFor } from '../settings/approvals.js'
import { callUpstream, type XrpcClient } from '../upstream/client.js'
import {
  normalizeModerationActPayload,
  invalid,
  type ModerationActPayload,
} from './action-payloads.js'
import {
  approvalRequired,
  executeWithApproval,
  type ApprovalContext,
  type ApprovalPayload,
} from './approvals.js'
import { bool, integer, iso, list, nonNegative, oneOf, rec, shape, str } from './values.js'

export type ReportView = com.selfcommand.admin.defs.ReportView
export type EventView = com.selfcommand.admin.defs.EventView
export type StatusView = com.selfcommand.admin.defs.StatusView
export type EventBatchSummary = com.selfcommand.admin.defs.EventBatchSummary
export type QueueView = com.selfcommand.admin.defs.QueueView
export type QueueStats = com.selfcommand.admin.defs.QueueStats
export type ScheduledActionView = com.selfcommand.admin.defs.ScheduledActionView
export type AccountOverview = com.selfcommand.admin.defs.AccountOverview
export type AnalyticsSummary = com.selfcommand.admin.defs.AnalyticsSummary
export type AnalyticsDay = com.selfcommand.admin.defs.AnalyticsDay
export type EmittedEvent = { subject: string; eventId: number }
export type FailedSubject = { subject: string; message: string }

export type ModerationDeps = {
  ozone: XrpcClient
  logger: Logger
}

export type ModerationWriteContext = ModerationDeps & {
  db: Kysely<Database>
  actor: string
  meta: RequestMeta
  ttlHours: number
}

const OZONE = {
  reportList: 'tools.ozone.report.queryReports',
  reportGet: 'tools.ozone.report.getReport',
  reportAssign: 'tools.ozone.report.assignModerator',
  reportUnassign: 'tools.ozone.report.unassignModerator',
  reportClose: 'tools.ozone.report.closeReports',
  activityCreate: 'tools.ozone.report.createActivity',
  activityList: 'tools.ozone.report.listActivities',
  queueList: 'tools.ozone.queue.listQueues',
  queueCreate: 'tools.ozone.queue.createQueue',
  queueUpdate: 'tools.ozone.queue.updateQueue',
  queueDelete: 'tools.ozone.queue.deleteQueue',
  queueAssign: 'tools.ozone.queue.assignModerator',
  queueUnassign: 'tools.ozone.queue.unassignModerator',
  queueRoute: 'tools.ozone.queue.routeReports',
  eventList: 'tools.ozone.moderation.queryEvents',
  eventGet: 'tools.ozone.moderation.getEvent',
  statusQuery: 'tools.ozone.moderation.queryStatuses',
  eventEmit: 'tools.ozone.moderation.emitEvent',
  scheduledList: 'tools.ozone.moderation.listScheduledActions',
  scheduledCancel: 'tools.ozone.moderation.cancelScheduledActions',
  getRepo: 'tools.ozone.moderation.getRepo',
  getRecords: 'tools.ozone.moderation.getRecords',
  liveStats: 'tools.ozone.report.getLiveStats',
  historicalStats: 'tools.ozone.report.getHistoricalStats',
} as const

const ACTIVITY = {
  close: 'tools.ozone.report.defs#closeActivity',
  escalation: 'tools.ozone.report.defs#escalationActivity',
  reopen: 'tools.ozone.report.defs#reopenActivity',
} as const

const MOD_EVENT = {
  takedown: 'tools.ozone.moderation.defs#modEventTakedown',
  reverseTakedown: 'tools.ozone.moderation.defs#modEventReverseTakedown',
  acknowledge: 'tools.ozone.moderation.defs#modEventAcknowledge',
  escalate: 'tools.ozone.moderation.defs#modEventEscalate',
  comment: 'tools.ozone.moderation.defs#modEventComment',
  label: 'tools.ozone.moderation.defs#modEventLabel',
  mute: 'tools.ozone.moderation.defs#modEventMute',
  unmute: 'tools.ozone.moderation.defs#modEventUnmute',
} as const

const REPORT_STATUSES = ['open', 'closed', 'escalated', 'queued', 'assigned'] as const
const SUBJECT_TYPES = ['account', 'record', 'message', 'conversation'] as const
const REVIEW_STATES = ['open', 'closed', 'escalated', 'none'] as const
const OZONE_REVIEW_STATE: Record<(typeof REVIEW_STATES)[number], string> = {
  open: 'tools.ozone.moderation.defs#reviewOpen',
  closed: 'tools.ozone.moderation.defs#reviewClosed',
  escalated: 'tools.ozone.moderation.defs#reviewEscalated',
  none: 'tools.ozone.moderation.defs#reviewNone',
}
const SCHEDULED_STATUSES = ['pending', 'executed', 'cancelled', 'failed'] as const
const ACCOUNT_STATUSES = [
  'active',
  'deactivated',
  'suspended',
  'takendown',
  'deleted',
  'unknown',
] as const

function labelValues(...sources: unknown[]): string[] | undefined {
  const values: string[] = []
  for (const source of sources) {
    for (const entry of list(source)) {
      const value = str(entry, 64)
      if (value && !values.includes(value)) values.push(value)
    }
  }
  return values.length ? values.slice(0, 10) : undefined
}

function subjectType(value: unknown): ReportView['subjectType'] | undefined {
  return oneOf(value, SUBJECT_TYPES)
}

function inferSubjectType(subject: string): ReportView['subjectType'] | undefined {
  if (subject.startsWith('did:')) return 'account'
  if (subject.includes('/chat.bsky.convo.message/')) return 'message'
  if (subject.includes('/chat.bsky.convo/')) return 'conversation'
  if (subject.startsWith('at://')) return 'record'
  return undefined
}

function reportStatus(value: unknown): ReportView['status'] | undefined {
  return oneOf(value, REPORT_STATUSES)
}

export function normalizeReportView(raw: unknown): ReportView {
  const report = rec(raw)
  const subjectView = rec(report?.subject)
  const reporter = rec(report?.reporter)
  const statusView = rec(report?.subjectStatus) ?? rec(subjectView?.status)
  const reporterView = rec(reporter?.profile) ?? rec(reporter?.repo)
  const id = integer(report?.id)
  const status = reportStatus(report?.status)
  const subject = str(subjectView?.subject)
  const reportType = str(report?.reportType, 128)
  const reportedBy = str(report?.reportedBy)
  const createdAt = iso(report?.createdAt)
  if (!report || id === undefined || !status || !subject || !reportType || !reportedBy || !createdAt) {
    throw shape('举报')
  }
  const assignment = rec(report.assignment)
  const queue = rec(report.queue)
  const actions = list(report.actions)
  const closedAction = actions
    .map((entry) => rec(entry))
    .find((entry) => str(rec(entry?.event)?.$type)?.endsWith('#closeActivity'))
  const closedAt = iso(closedAction?.createdAt)
  const reopenedAt = actions
    .map((entry) => rec(entry))
    .filter((entry) => str(rec(entry?.event)?.$type)?.endsWith('#reopenActivity'))
    .map((entry) => iso(entry?.createdAt))
    .filter((value): value is string => value !== undefined)
    .at(-1)
  const actuallyClosedAt =
    closedAt && (!reopenedAt || closedAt > reopenedAt) ? closedAt : undefined
  const subjectTypeValue = subjectType(subjectView?.type) ?? inferSubjectType(subject)
  const reporterHandle = str(reporterView?.handle, 256)
  const subjectHandle =
    str(rec(subjectView?.repo)?.handle, 256) ?? str(statusView?.subjectRepoHandle, 256)
  const comment = str(report.comment, 2000)
  const updatedAt = iso(report.updatedAt)
  const queueId = integer(queue?.id)
  const priorityScore = nonNegative(report.priorityScore)
  const actionNote = str(report.actionNote, 1000)
  const assignedTo = str(assignment?.did)
  const closedBy = str(closedAction?.createdBy)
  const eventId = integer(report.eventId)
  const relatedReportCount = nonNegative(report.relatedReportCount)

  return {
    id,
    status,
    subject,
    ...(subjectTypeValue ? { subjectType: subjectTypeValue } : {}),
    reportType,
    reportedBy: reportedBy as ReportView['reportedBy'],
    ...(reporterHandle ? { reporterHandle } : {}),
    ...(subjectHandle ? { subjectHandle } : {}),
    ...(comment ? { comment } : {}),
    createdAt: createdAt as ReportView['createdAt'],
    ...(updatedAt ? { updatedAt: updatedAt as ReportView['updatedAt'] } : {}),
    ...(queueId !== undefined ? { queueId } : {}),
    ...(priorityScore !== undefined && priorityScore <= 100
      ? { priorityScore }
      : {}),
    ...(actionNote ? { actionNote } : {}),
    ...(assignedTo ? { assignedTo: assignedTo as ReportView['assignedTo'] } : {}),
    ...(closedBy ? { closedBy: closedBy as ReportView['closedBy'] } : {}),
    ...(actuallyClosedAt ? { closedAt: actuallyClosedAt as ReportView['closedAt'] } : {}),
    ...(eventId !== undefined ? { eventId } : {}),
    ...(relatedReportCount !== undefined ? { relatedReportCount } : {}),
  }
}

function eventSubjectOf(value: unknown): string | undefined {
  if (typeof value === 'string') return str(value)
  const subject = rec(value)
  return (
    str(subject?.subject) ??
    str(subject?.did) ??
    str(subject?.uri) ??
    str(subject?.messageId) ??
    str(subject?.convoId)
  )
}

export function normalizeEventView(raw: unknown): EventView {
  const event = rec(raw)
  const eventBody = rec(event?.event)
  const eventType =
    str(eventBody?.$type, 128)?.split('#').at(-1) ?? str(event?.eventType, 128)
  const id = integer(event?.id)
  const subject = eventSubjectOf(event?.subject)
  const createdBy = str(event?.createdBy)
  const createdAt = iso(event?.createdAt)
  if (!event || id === undefined || !eventType || !subject || !createdBy || !createdAt) {
    throw shape('审核事件')
  }
  const labels = labelValues(eventBody?.createLabelVals ?? event.labels)
  const subjectTypeValue = subjectType(event.subjectType) ?? inferSubjectType(subject)
  const creatorHandle = str(event.creatorHandle, 256)
  const subjectHandle = str(event.subjectHandle, 256)
  const comment = str(eventBody?.comment, 2000) ?? str(event.comment, 2000)
  const durationInHours = nonNegative(eventBody?.durationInHours ?? event.durationInHours)
  return {
    id,
    eventType,
    subject,
    ...(subjectTypeValue ? { subjectType: subjectTypeValue } : {}),
    createdBy: createdBy as EventView['createdBy'],
    ...(creatorHandle ? { creatorHandle } : {}),
    ...(subjectHandle ? { subjectHandle } : {}),
    createdAt: createdAt as EventView['createdAt'],
    ...(comment ? { comment } : {}),
    ...(durationInHours !== undefined ? { durationInHours } : {}),
    ...(labels ? { labels } : {}),
  }
}

function reviewStateOf(value: unknown): StatusView['reviewState'] | undefined {
  const raw = str(value, 128)
  if (!raw) return undefined
  const short = raw.split('#').at(-1)?.replace(/^review/, '').toLowerCase()
  return oneOf(short, REVIEW_STATES)
}

export function normalizeStatusView(raw: unknown): StatusView {
  const view = rec(raw)
  const id = integer(view?.id)
  const subject = eventSubjectOf(view?.subject)
  const review = reviewStateOf(view?.reviewState)
  const createdAt = iso(view?.createdAt)
  const updatedAt = iso(view?.updatedAt)
  if (!view || id === undefined || !subject || !review || !createdAt || !updatedAt) {
    throw shape('处置状态')
  }
  const subjectTypeValue = subjectType(rec(view.subject)?.type) ?? inferSubjectType(subject)
  const subjectHandle = str(view.subjectRepoHandle, 256)
  const takendown = bool(view.takendown)
  const muteUntil = iso(view.muteUntil)
  const muted =
    muteUntil !== undefined ? Date.parse(muteUntil) > Date.now() : undefined
  const comment = str(view.comment, 2000)
  const priorityScore = nonNegative(view.priorityScore)
  const lastReportedAt = iso(view.lastReportedAt)
  const lastReviewedAt = iso(view.lastReviewedAt)
  const lastReviewedBy = str(view.lastReviewedBy)
  const tags = labelValues(view.tags)
  return {
    id,
    subject,
    ...(subjectTypeValue ? { subjectType: subjectTypeValue } : {}),
    ...(subjectHandle ? { subjectHandle } : {}),
    reviewState: review,
    ...(takendown !== undefined ? { takendown } : {}),
    ...(muted !== undefined ? { muted } : {}),
    ...(comment ? { comment } : {}),
    ...(priorityScore !== undefined && priorityScore <= 100 ? { priorityScore } : {}),
    ...(lastReportedAt ? { lastReportedAt: lastReportedAt as StatusView['lastReportedAt'] } : {}),
    ...(lastReviewedAt ? { lastReviewedAt: lastReviewedAt as StatusView['lastReviewedAt'] } : {}),
    ...(lastReviewedBy ? { lastReviewedBy: lastReviewedBy as StatusView['lastReviewedBy'] } : {}),
    ...(tags ? { tags } : {}),
    createdAt: createdAt as StatusView['createdAt'],
    updatedAt: updatedAt as StatusView['updatedAt'],
  }
}

const QUEUE_STAT_FIELDS = [
  'pendingCount',
  'closedCount',
  'escalatedCount',
  'inboundCount',
  'actionedCount',
  'acknowledgedCount',
] as const

function queueStats(raw: unknown): QueueStats | undefined {
  const stats = rec(raw)
  if (!stats) return undefined
  const view: QueueStats = {}
  for (const field of QUEUE_STAT_FIELDS) {
    const value = nonNegative(stats[field])
    if (value !== undefined) view[field] = value
  }
  return Object.keys(view).length ? view : undefined
}

export function normalizeQueueView(raw: unknown): QueueView {
  const queue = rec(raw)
  const id = integer(queue?.id)
  const name = str(queue?.name, 100)
  const createdBy = str(queue?.createdBy)
  const createdAt = iso(queue?.createdAt)
  const updatedAt = iso(queue?.updatedAt)
  if (
    !queue ||
    id === undefined ||
    !name ||
    !createdBy ||
    !createdAt ||
    !updatedAt ||
    bool(queue.enabled) === undefined
  ) {
    throw shape('举报队列')
  }
  const subjectTypes = list(queue.subjectTypes)
    .map((entry) => subjectType(entry))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
  const reportTypes = list(queue.reportTypes)
    .map((entry) => str(entry, 128))
    .filter((entry): entry is string => entry !== undefined)
  const stats = queueStats(queue.stats)
  const description = str(queue.description, 500)
  const collection = str(queue.collection, 128)
  return {
    id,
    name,
    enabled: bool(queue.enabled) as boolean,
    ...(description ? { description } : {}),
    ...(subjectTypes.length ? { subjectTypes } : {}),
    ...(collection ? { collection: collection as QueueView['collection'] } : {}),
    ...(reportTypes.length ? { reportTypes: reportTypes.slice(0, 50) } : {}),
    createdBy: createdBy as QueueView['createdBy'],
    createdAt: createdAt as QueueView['createdAt'],
    updatedAt: updatedAt as QueueView['updatedAt'],
    ...(stats ? { stats } : {}),
  }
}

export function normalizeScheduledActionView(raw: unknown): ScheduledActionView {
  const action = rec(raw)
  const id = integer(action?.id)
  const name = str(action?.action, 64)
  const subject = str(action?.did)
  const status = oneOf(action?.status, SCHEDULED_STATUSES)
  const createdBy = str(action?.createdBy)
  const createdAt = iso(action?.createdAt)
  if (!action || id === undefined || !name || !subject || !status || !createdBy || !createdAt) {
    throw shape('定时处置')
  }
  const executeAt = iso(action.executeAt)
  const executeAfter = iso(action.executeAfter)
  const executeUntil = iso(action.executeUntil)
  const comment = str(rec(action.eventData)?.comment, 500) ?? str(action.comment, 500)
  const updatedAt = iso(action.updatedAt)
  const lastFailureReason = str(action.lastFailureReason, 500)
  return {
    id,
    action: name,
    subject: subject as ScheduledActionView['subject'],
    status,
    ...(executeAt ? { executeAt: executeAt as ScheduledActionView['executeAt'] } : {}),
    ...(executeAfter ? { executeAfter: executeAfter as ScheduledActionView['executeAfter'] } : {}),
    ...(executeUntil ? { executeUntil: executeUntil as ScheduledActionView['executeUntil'] } : {}),
    ...(comment ? { comment } : {}),
    createdBy: createdBy as ScheduledActionView['createdBy'],
    createdAt: createdAt as ScheduledActionView['createdAt'],
    ...(updatedAt ? { updatedAt: updatedAt as ScheduledActionView['updatedAt'] } : {}),
    ...(lastFailureReason ? { lastFailureReason } : {}),
  }
}

function accountStatus(value: unknown): AccountOverview['status'] | undefined {
  return oneOf(value, ACCOUNT_STATUSES)
}

export function normalizeAccountOverview(raw: {
  repo: unknown
  events: unknown[]
  reports: unknown[]
}): AccountOverview {
  const repo = rec(raw.repo)
  const did = str(repo?.did)
  if (!repo || !did || !isDidString(did)) throw shape('账号')
  const moderation = rec(repo.moderation)
  const status = rec(moderation?.subjectStatus)
  const hosting = rec(status?.hosting)
  const muteUntil = iso(status?.muteUntil)
  const suspendUntil = iso(status?.suspendUntil)
  const now = Date.now()
  const takendown = bool(status?.takendown) ?? false
  const statusValue =
    accountStatus(hosting?.status) ??
    (takendown
      ? 'takendown'
      : iso(repo.deactivatedAt)
        ? 'deactivated'
        : suspendUntil && Date.parse(suspendUntil) > now
          ? 'suspended'
          : 'active')
  const labels = labelValues(
    list(repo.labels).map((label) => rec(label)?.val),
    status?.tags,
  )
  const handle = str(repo.handle, 256)
  const reviewState = str(status?.reviewState, 64)
  const lastReviewedAt = iso(status?.lastReviewedAt)
  const lastReportedAt = iso(status?.lastReportedAt)
  return {
    did: did as AccountOverview['did'],
    ...(handle ? { handle } : {}),
    status: statusValue,
    ...(reviewState ? { reviewState } : {}),
    takendown,
    muted: Boolean(muteUntil && Date.parse(muteUntil) > now),
    ...(lastReviewedAt
      ? { lastReviewedAt: lastReviewedAt as AccountOverview['lastReviewedAt'] }
      : {}),
    ...(lastReportedAt
      ? { lastReportedAt: lastReportedAt as AccountOverview['lastReportedAt'] }
      : {}),
    eventCount: raw.events.length,
    openReportCount: raw.reports.length,
    ...(labels ? { labels } : {}),
  }
}

export function normalizeLiveSummary(raw: unknown): AnalyticsSummary {
  const stats = rec(raw) ?? {}
  const rate = integer(stats.closureTargetMetRate)
  return {
    pendingCount: nonNegative(stats.pendingCount) ?? 0,
    closedCount: nonNegative(stats.closedCount) ?? 0,
    escalatedCount: nonNegative(stats.escalatedCount) ?? 0,
    inboundCount: nonNegative(stats.inboundCount) ?? 0,
    actionedCount: nonNegative(stats.actionedCount) ?? 0,
    acknowledgedCount: nonNegative(stats.acknowledgedCount) ?? 0,
    ...(rate !== undefined
      ? { closureTargetMetRate: Math.min(100, Math.max(0, Math.round(rate))) }
      : {}),
    ...(nonNegative(stats.closureTargetOverdueCount) !== undefined
      ? { closureTargetOverdueCount: nonNegative(stats.closureTargetOverdueCount) }
      : {}),
  }
}

export function normalizeAnalyticsDay(raw: unknown): AnalyticsDay {
  const stats = rec(raw)
  const day = str(stats?.date, 10) ?? str(stats?.day, 10)
  if (!stats || !day) throw shape('审核统计')
  return {
    day,
    pendingCount: nonNegative(stats.pendingCount) ?? 0,
    closedCount: nonNegative(stats.closedCount) ?? 0,
    escalatedCount: nonNegative(stats.escalatedCount) ?? 0,
    inboundCount: nonNegative(stats.inboundCount) ?? 0,
    actionedCount: nonNegative(stats.actionedCount) ?? 0,
    acknowledgedCount: nonNegative(stats.acknowledgedCount) ?? 0,
  }
}

export async function listReports(
  deps: ModerationDeps,
  params: {
    status?: string
    queueId?: number
    reportTypes?: string[]
    subject?: string
    did?: string
    subjectType?: string
    reportedAfter?: string
    reportedBefore?: string
    assignedTo?: string
    isMuted?: boolean
    sort?: string
    direction?: string
    limit: number
    cursor?: string
  },
): Promise<{ reports: ReportView[]; cursor?: string }> {
  const result = await callUpstream<{ reports?: unknown[]; cursor?: string }>(
    deps.ozone,
    OZONE.reportList,
    {
      params: {
        status: params.status ?? 'open',
        queueId: params.queueId,
        reportTypes: params.reportTypes,
        subject: params.subject,
        did: params.did,
        subjectType: params.subjectType,
        reportedAfter: params.reportedAfter,
        reportedBefore: params.reportedBefore,
        assignedTo: params.assignedTo,
        isMuted: params.isMuted,
        sortField: params.sort ?? 'createdAt',
        sortDirection: params.direction ?? 'desc',
        limit: params.limit,
        cursor: params.cursor,
      },
    },
  )
  return {
    reports: list(result.reports).map(normalizeReportView),
    ...(result.cursor !== undefined ? { cursor: result.cursor } : {}),
  }
}

export async function getReport(
  deps: ModerationDeps,
  id: number,
): Promise<com.selfcommand.admin.moderation.report.get.$OutputBody> {
  const [raw, activities] = await Promise.all([
    callUpstream<unknown>(deps.ozone, OZONE.reportGet, { params: { id } }),
    callUpstream<{ activities?: unknown[] }>(deps.ozone, OZONE.activityList, {
      params: { reportId: id, limit: 50 },
    }).catch(() => ({ activities: [] })),
  ])
  const report = normalizeReportView(raw)
  return {
    report,
    detail: { report: raw, activities: list(activities.activities) } as never,
  }
}

async function reportSubject(
  ozone: XrpcClient,
  reportId: number,
): Promise<{ subject: string; did: string }> {
  const raw = await callUpstream<unknown>(ozone, OZONE.reportGet, {
    params: { id: reportId },
  })
  const report = rec(raw)
  const subjectView = rec(report?.subject)
  const subject = str(subjectView?.subject)
  if (!report || !subject) throw shape('举报')
  const did =
    subject.startsWith('did:')
      ? subject
      : (subject.slice('at://'.length).split('/')[0] ?? subject)
  return { subject, did }
}

export type ReportActResult = com.selfcommand.admin.moderation.report.act.$OutputBody

export async function actOnReport(
  ctx: ModerationWriteContext,
  input: com.selfcommand.admin.moderation.report.act.$InputBody,
): Promise<ReportActResult> {
  const action = input.action
  const reportId = input.reportId
  const comment = str(input.comment, 2000)
  const queueId = integer(input.queueId)
  if (action !== 'close' && (input.scope !== undefined || input.reportTypes !== undefined)) {
    throw invalid('关闭范围只适用于结案操作')
  }

  const audit = async (result: 'success' | 'error', detail: string) => {
    await writeAudit(ctx.db, ctx.logger, {
      actor: ctx.actor,
      action: 'com.selfcommand.admin.moderation.report.act',
      targetType: 'report',
      target: String(reportId),
      result,
      detail,
      ...ctx.meta,
    })
  }

  try {
    if (action === 'assign') {
      const did = str(input.did) ?? ctx.actor
      if (!isDidString(did)) throw invalid('指派对象必须是有效的账号标识')
      const assignment = await callUpstream<unknown>(ctx.ozone, OZONE.reportAssign, {
        method: 'POST',
        body: {
          reportId,
          did,
          ...(queueId !== undefined ? { queueId } : {}),
          isPermanent: true,
        },
      })
      await audit('success', `将举报指派给 ${did}`)
      return { ok: true, assignment: assignment as never }
    }

    if (action === 'unassign') {
      await callUpstream<unknown>(ctx.ozone, OZONE.reportUnassign, {
        method: 'POST',
        body: { reportId },
      })
      await audit('success', '取消举报指派')
      return { ok: true }
    }

    if (action === 'close') {
      const scope = input.scope ?? 'current'
      if (scope === 'current') {
        await callUpstream<unknown>(ctx.ozone, OZONE.activityCreate, {
          method: 'POST',
          body: {
            reportId,
            activity: { $type: ACTIVITY.close },
            ...(comment ? { internalNote: comment } : {}),
          },
        })
        await audit('success', '结案当前举报')
        return { ok: true, closedCount: 1 }
      }
      const target = await reportSubject(ctx.ozone, reportId)
      const reportTypes = list(input.reportTypes)
        .map((entry) => str(entry, 128))
        .filter((entry): entry is string => entry !== undefined)
      if (scope === 'types' && reportTypes.length === 0) {
        throw invalid('按类型结案时必须提供举报类型')
      }
      const result = await callUpstream<{ closedCount?: number }>(ctx.ozone, OZONE.reportClose, {
        method: 'POST',
        body: {
          subject: target.subject,
          ...(scope === 'all' && target.subject.startsWith('did:')
            ? { includeAllOwned: true }
            : {}),
          ...(scope === 'types' ? { reportTypes } : {}),
          ...(comment ? { internalNote: comment } : {}),
        },
      })
      const closedCount = nonNegative(result.closedCount) ?? 0
      await audit('success', `结案 ${closedCount} 条举报`)
      return { ok: true, closedCount }
    }

    if (action === 'escalate' || action === 'reopen') {
      await callUpstream<unknown>(ctx.ozone, OZONE.activityCreate, {
        method: 'POST',
        body: {
          reportId,
          activity: {
            $type: action === 'escalate' ? ACTIVITY.escalation : ACTIVITY.reopen,
          },
          ...(comment ? { internalNote: comment } : {}),
        },
      })
      await audit('success', action === 'escalate' ? '升级举报' : '重新打开举报')
      return { ok: true }
    }

    throw invalid('举报操作不是受支持的动作')
  } catch (error) {
    await audit('error', `操作未完成（错误码：${auditErrorCode(error)}）`)
    throw error
  }
}

export async function listQueues(
  deps: ModerationDeps,
  params: { enabled?: boolean; limit: number; cursor?: string },
): Promise<{ queues: QueueView[]; cursor?: string }> {
  const result = await callUpstream<{ queues?: unknown[]; cursor?: string }>(
    deps.ozone,
    OZONE.queueList,
    { params: { enabled: params.enabled, limit: params.limit, cursor: params.cursor } },
  )
  return {
    queues: list(result.queues).map(normalizeQueueView),
    ...(result.cursor !== undefined ? { cursor: result.cursor } : {}),
  }
}

export type QueueActResult = com.selfcommand.admin.moderation.queue.act.$OutputBody

export async function actOnQueue(
  ctx: ModerationWriteContext,
  input: com.selfcommand.admin.moderation.queue.act.$InputBody,
): Promise<QueueActResult> {
  const action = input.action
  const queueId = integer(input.queueId)
  const did = str(input.did)
  const audit = async (result: 'success' | 'error', detail: string) => {
    await writeAudit(ctx.db, ctx.logger, {
      actor: ctx.actor,
      action: 'com.selfcommand.admin.moderation.queue.act',
      targetType: 'queue',
      target: queueId !== undefined ? String(queueId) : 'new',
      result,
      detail,
      ...ctx.meta,
    })
  }

  try {
    if (action === 'create') {
      const name = str(input.name, 100)
      if (!name) throw invalid('队列名称不能为空')
      const queue = await callUpstream<unknown>(ctx.ozone, OZONE.queueCreate, {
        method: 'POST',
        body: {
          name,
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.subjectTypes !== undefined ? { subjectTypes: input.subjectTypes } : {}),
          ...(input.collection !== undefined ? { collection: input.collection } : {}),
          ...(input.reportTypes !== undefined ? { reportTypes: input.reportTypes } : {}),
        },
      })
      await audit('success', `创建举报队列「${name}」`)
      return { queue: normalizeQueueView(queue) }
    }

    if (action === 'update') {
      if (queueId === undefined) throw invalid('修改队列必须提供队列编号')
      if (
        input.name === undefined &&
        input.description === undefined &&
        input.enabled === undefined
      ) {
        throw invalid('至少需要修改一项队列设置')
      }
      const queue = await callUpstream<unknown>(ctx.ozone, OZONE.queueUpdate, {
        method: 'POST',
        body: {
          queueId,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        },
      })
      await audit('success', `修改举报队列 #${queueId}`)
      return { queue: normalizeQueueView(queue) }
    }

    if (action === 'delete') {
      if (queueId === undefined) throw invalid('删除队列必须提供队列编号')
      const migrateToQueueId = integer(input.migrateToQueueId)
      if (migrateToQueueId === undefined) {
        const queues = await listQueues(ctx, { limit: 100 })
        const target = queues.queues.find((queue) => queue.id === queueId)
        if (target && (target.stats?.pendingCount ?? 0) > 0) {
          throw new LexServerError(409, {
            error: 'QueueNotEmpty',
            message: '该队列仍有待处理举报，请选择迁移目标队列后再删除。',
          })
        }
      }
      const result = await callUpstream<{
        deleted?: boolean
        reportsMigrated?: number
      }>(ctx.ozone, OZONE.queueDelete, {
        method: 'POST',
        body: {
          queueId,
          ...(migrateToQueueId !== undefined ? { migrateToQueueId } : {}),
        },
      })
      await audit('success', `删除举报队列 #${queueId}`)
      return {
        deleted: bool(result.deleted) ?? false,
        ...(nonNegative(result.reportsMigrated) !== undefined
          ? { reportsMigrated: nonNegative(result.reportsMigrated) }
          : {}),
      }
    }

    if (action === 'assign' || action === 'unassign') {
      if (queueId === undefined) throw invalid('队列指派必须提供队列编号')
      if (!did || !isDidString(did)) throw invalid('审核员标识必须是有效的账号标识')
      await callUpstream<unknown>(
        ctx.ozone,
        action === 'assign' ? OZONE.queueAssign : OZONE.queueUnassign,
        { method: 'POST', body: { queueId, did } },
      )
      await audit('success', `${action === 'assign' ? '指派' : '取消指派'}队列 #${queueId} 的审核员`)
      return {}
    }

    if (action === 'route') {
      const startReportId = integer(input.startReportId)
      const endReportId = integer(input.endReportId)
      if (startReportId === undefined || endReportId === undefined) {
        throw invalid('路由举报必须提供起始和结束举报编号')
      }
      const result = await callUpstream<{ assigned?: number; unmatched?: number }>(
        ctx.ozone,
        OZONE.queueRoute,
        { method: 'POST', body: { startReportId, endReportId } },
      )
      const assigned = nonNegative(result.assigned) ?? 0
      const unmatched = nonNegative(result.unmatched) ?? 0
      await audit('success', `路由举报：已分配 ${assigned} 条，未匹配 ${unmatched} 条`)
      return { assigned, unmatched }
    }

    throw invalid('队列操作不是受支持的动作')
  } catch (error) {
    await audit('error', `操作未完成（错误码：${auditErrorCode(error)}）`)
    throw error
  }
}

export async function listEvents(
  deps: ModerationDeps,
  params: {
    subject?: string
    did?: string
    includeAllUserRecords?: boolean
    types?: string[]
    createdBy?: string
    createdAfter?: string
    createdBefore?: string
    hasComment?: boolean
    comment?: string
    direction?: string
    limit: number
    cursor?: string
    batchId?: string
  },
): Promise<{ events: EventView[]; cursor?: string }> {
  const result = await callUpstream<{ events?: unknown[]; cursor?: string }>(
    deps.ozone,
    OZONE.eventList,
    {
      params: {
        subject: params.subject,
        did: params.did,
        includeAllUserRecords: params.includeAllUserRecords,
        types: params.types,
        createdBy: params.createdBy,
        createdAfter: params.createdAfter,
        createdBefore: params.createdBefore,
        hasComment: params.hasComment,
        comment: params.comment,
        sortDirection: params.direction ?? 'desc',
        limit: params.limit,
        cursor: params.cursor,
        batchId: params.batchId,
      },
    },
  )
  return {
    events: list(result.events).map(normalizeEventView),
    ...(result.cursor !== undefined ? { cursor: result.cursor } : {}),
  }
}

export async function getEvent(
  deps: ModerationDeps,
  id: number,
): Promise<com.selfcommand.admin.moderation.event.get.$OutputBody> {
  return {
    event: (await callUpstream<unknown>(deps.ozone, OZONE.eventGet, {
      params: { id },
    })) as never,
  }
}

export async function queryStatuses(
  deps: ModerationDeps,
  params: {
    subject?: string
    subjectType?: string
    reviewState?: string
    takendown?: boolean
    lastReviewedBy?: string
    reportedAfter?: string
    reportedBefore?: string
    reviewedAfter?: string
    reviewedBefore?: string
    limit: number
    cursor?: string
  },
): Promise<{ statuses: StatusView[]; cursor?: string }> {
  let reviewState: string | undefined
  if (params.reviewState !== undefined) {
    const short = oneOf(params.reviewState, REVIEW_STATES)
    if (!short) throw invalid('处置状态筛选值无效，可选 open、closed、escalated、none。')
    reviewState = OZONE_REVIEW_STATE[short]
  }
  const result = await callUpstream<{ subjectStatuses?: unknown[]; cursor?: string }>(
    deps.ozone,
    OZONE.statusQuery,
    {
      params: {
        subject: params.subject,
        subjectType: params.subjectType,
        reviewState,
        takendown: params.takendown,
        lastReviewedBy: params.lastReviewedBy,
        reportedAfter: params.reportedAfter,
        reportedBefore: params.reportedBefore,
        reviewedAfter: params.reviewedAfter,
        reviewedBefore: params.reviewedBefore,
        limit: params.limit,
        cursor: params.cursor,
      },
    },
  )
  return {
    statuses: list(result.subjectStatuses).map(normalizeStatusView),
    ...(result.cursor !== undefined ? { cursor: result.cursor } : {}),
  }
}

const EVENT_BATCH_PAGE_SIZE = 100
const EVENT_BATCH_MAX_EVENTS = 500

export async function getEventBatch(
  deps: ModerationDeps,
  batchId: string,
): Promise<EventBatchSummary> {
  const id = str(batchId, 256)
  if (!id) throw invalid('请提供事件批次标识。')
  const typeCounts = new Map<string, number>()
  const creators = new Set<string>()
  let scanned = 0
  let truncated = false
  let createdAfter: string | undefined
  let createdBefore: string | undefined
  let cursor: string | undefined

  while (scanned < EVENT_BATCH_MAX_EVENTS) {
    const result = await callUpstream<{ events?: unknown[]; cursor?: string }>(
      deps.ozone,
      OZONE.eventList,
      {
        params: {
          batchId: id,
          sortDirection: 'asc',
          limit: Math.min(EVENT_BATCH_PAGE_SIZE, EVENT_BATCH_MAX_EVENTS - scanned),
          cursor,
        },
      },
    )
    const events = list(result.events)
    if (!events.length) break
    for (const raw of events) {
      const event = normalizeEventView(raw)
      typeCounts.set(event.eventType, (typeCounts.get(event.eventType) ?? 0) + 1)
      creators.add(event.createdBy)
      if (!createdAfter || event.createdAt < createdAfter) createdAfter = event.createdAt
      if (!createdBefore || event.createdAt > createdBefore) createdBefore = event.createdAt
      scanned += 1
    }
    const next = str(result.cursor, 2048)
    if (!next) break
    if (scanned >= EVENT_BATCH_MAX_EVENTS) {
      truncated = true
      break
    }
    cursor = next
  }

  return {
    batchId: id,
    totalEvents: scanned,
    scannedEvents: scanned,
    truncated,
    ...(createdAfter ? { createdAfter: createdAfter as EventBatchSummary['createdAfter'] } : {}),
    ...(createdBefore ? { createdBefore: createdBefore as EventBatchSummary['createdBefore'] } : {}),
    typeCounts: [...typeCounts.entries()]
      .map(([eventType, count]) => ({ eventType, count }))
      .sort((a, b) => b.count - a.count || a.eventType.localeCompare(b.eventType)),
    ...(creators.size
      ? {
          createdBy: [...creators]
            .slice(0, 50)
            .map((did) => did as NonNullable<EventBatchSummary['createdBy']>[number]),
        }
      : {}),
  }
}

type EmitSubject =
  | { key: string; input: { $type: 'com.atproto.admin.defs#repoRef'; did: string } }
  | { key: string; input: { $type: 'com.atproto.repo.strongRef'; uri: string; cid: string } }

function isRecordUri(value: string): boolean {
  if (!isAtUriString(value) || isChatUri(value)) return false
  const segments = value.slice('at://'.length).split('/')
  return segments.length === 3 && segments.every((segment) => segment.length > 0)
}

function isChatUri(value: string): boolean {
  return value.includes('/chat.bsky.convo')
}

async function resolveEmitSubjects(
  ozone: XrpcClient,
  subjects: string[],
): Promise<EmitSubject[]> {
  const recordUris = subjects.filter((subject) => subject.startsWith('at://') && !isChatUri(subject))
  const cids = new Map<string, string>()
  if (recordUris.length) {
    const result = await callUpstream<{ records?: unknown[] }>(ozone, OZONE.getRecords, {
      params: { uris: recordUris },
    })
    for (const entry of list(result.records)) {
      const record = rec(entry)
      const uri = str(record?.uri)
      const cid = str(record?.cid, 128)
      if (uri && cid) cids.set(uri, cid)
    }
  }

  return subjects.map((subject) => {
    if (isChatUri(subject)) {
      throw invalid('暂不支持直接处置聊天内容，请在举报详情中处理该会话。')
    }
    if (subject.startsWith('did:')) {
      if (!isDidString(subject)) throw invalid('账号标识格式不正确')
      return {
        key: subject,
        input: { $type: 'com.atproto.admin.defs#repoRef', did: subject },
      }
    }
    if (!isRecordUri(subject)) throw invalid('内容地址格式不正确')
    const cid = cids.get(subject)
    if (!cid) throw invalid('所选内容不存在或已被删除，请刷新后重试。')
    return {
      key: subject,
      input: { $type: 'com.atproto.repo.strongRef', uri: subject, cid },
    }
  })
}

function buildModerationEvent(payload: ModerationActPayload): Record<string, unknown> {
  const comment = payload.comment
  const duration = payload.durationInHours
  const base = { ...(comment ? { comment } : {}) }
  switch (payload.action) {
    case 'takedown':
      return {
        $type: MOD_EVENT.takedown,
        ...base,
        ...(duration !== undefined ? { durationInHours: duration } : {}),
        ...(payload.acknowledgeAccountSubjects !== undefined
          ? { acknowledgeAccountSubjects: payload.acknowledgeAccountSubjects }
          : {}),
        ...(payload.reason ? { policies: [payload.reason] } : {}),
      }
    case 'reverseTakedown':
      return {
        $type: MOD_EVENT.reverseTakedown,
        ...base,
        ...(payload.reason ? { policies: [payload.reason] } : {}),
      }
    case 'acknowledge':
      return {
        $type: MOD_EVENT.acknowledge,
        ...base,
        ...(payload.acknowledgeAccountSubjects !== undefined
          ? { acknowledgeAccountSubjects: payload.acknowledgeAccountSubjects }
          : {}),
      }
    case 'escalate':
      return { $type: MOD_EVENT.escalate, ...base }
    case 'comment':
      if (!comment) throw invalid('添加备注时必须填写备注内容')
      return { $type: MOD_EVENT.comment, comment }
    case 'label':
      return {
        $type: MOD_EVENT.label,
        createLabelVals: payload.labels ?? [],
        negateLabelVals: [],
        ...base,
        ...(duration !== undefined ? { durationInHours: duration } : {}),
      }
    case 'mute':
      if (duration === undefined) throw invalid('账号限制必须提供持续时长（小时）')
      return {
        $type: MOD_EVENT.mute,
        durationInHours: duration,
        ...base,
      }
    case 'unmute':
      return { $type: MOD_EVENT.unmute, ...base }
  }
}

export type ModerationEmitContext = {
  ozone: XrpcClient
  logger: Logger
  db: AuditExecutor
  actor: string
  meta: RequestMeta
}

export async function emitModerationEvents(
  ctx: ModerationEmitContext,
  payload: ModerationActPayload,
  options: { approvalId?: string; requireAll?: boolean } = {},
): Promise<{ events: EmittedEvent[]; failed: FailedSubject[] }> {
  const event = buildModerationEvent(payload)
  const subjects = await resolveEmitSubjects(ctx.ozone, payload.subjects)
  const events: EmittedEvent[] = []
  const failed: FailedSubject[] = []

  for (const subject of subjects) {
    try {
      const raw = await callUpstream<unknown>(ctx.ozone, OZONE.eventEmit, {
        method: 'POST',
        body: {
          event,
          subject: subject.input,
          createdBy: ctx.actor,
          ...(payload.reportId !== undefined
            ? { reportAction: { ids: [payload.reportId] } }
            : {}),
        },
      })
      const eventId = integer(rec(raw)?.id)
      if (eventId === undefined) throw shape('处置结果')
      events.push({ subject: subject.key, eventId })
    } catch (error) {
      failed.push({
        subject: subject.key,
        message:
          error instanceof LexServerError
            ? error.message
            : '上游服务未返回处置结果，请稍后重试。',
      })
    }
  }

  const detail = `处置动作：${payload.action}；成功 ${events.length} 个，失败 ${failed.length} 个${
    events.length ? `；事件编号 ${events.map((entry) => entry.eventId).join('、')}` : ''
  }`
  await writeAudit(ctx.db, ctx.logger, {
    actor: ctx.actor,
    action: 'com.selfcommand.admin.moderation.act',
    targetType: payload.subjects.length === 1 ? 'moderation' : 'moderation-batch',
    target: payload.subjects.length === 1 ? payload.subjects[0] : `batch:${payload.subjects.length}`,
    result: failed.length ? 'error' : 'success',
    detail,
    ...(options.approvalId ? { approvalId: options.approvalId } : {}),
    ...ctx.meta,
  })

  if (options.requireAll && failed.length) {
    throw new LexServerError(502, {
      error: 'UpstreamUnavailable',
      message: `有 ${failed.length} 个对象未能完成处置，请在审核事件中核对后重试。`,
    })
  }
  return { events, failed }
}

function requiredApproval(payload: ModerationActPayload): ApprovalActionName | undefined {
  const destructive = ['takedown', 'label', 'mute'].includes(payload.action)
  if (!destructive) return undefined
  if (payload.subjects.length === 1) {
    return payload.action === 'label' ? undefined : 'moderation.takedown'
  }
  return 'moderation.batch'
}

async function requiredApprovalFor(
  db: Kysely<Database>,
  payload: ModerationActPayload,
): Promise<ApprovalActionName | undefined> {
  const builtIn = requiredApproval(payload)
  if (builtIn) return builtIn
  if (payload.action === 'label' && payload.subjects.length === 1) {
    return (await isApprovalRequiredFor(db, 'moderation.label'))
      ? 'moderation.label'
      : undefined
  }
  return undefined
}

function approvalContext(ctx: ModerationWriteContext): ApprovalContext {
  return {
    db: ctx.db,
    logger: ctx.logger,
    actor: ctx.actor,
    meta: ctx.meta,
    ttlHours: ctx.ttlHours,
  }
}

export type ModerationActResult = com.selfcommand.admin.moderation.act.$OutputBody

export async function actOnSubjects(
  ctx: ModerationWriteContext,
  input: com.selfcommand.admin.moderation.act.$InputBody,
): Promise<ModerationActResult> {
  const { approvalId: rawApprovalId, ...rest } = input
  const payload = normalizeModerationActPayload(rest)
  const required = await requiredApprovalFor(ctx.db, payload)
  const approvalId = str(rawApprovalId, 64)

  if (approvalId) {
    if (!required) throw invalid('该处置动作无需审批，请移除审批编号')
    let result: { events: EmittedEvent[]; failed: FailedSubject[] } | undefined
    await executeWithApproval(approvalContext(ctx), {
      id: approvalId,
      action: required,
      payload: { ...payload } as ApprovalPayload,
      run: async (trx) => {
        result = await emitModerationEvents(
          { ...ctx, db: trx, meta: ctx.meta },
          payload,
          { approvalId, requireAll: true },
        )
      },
    })
    if (!result) throw invalid('审批执行未返回处置结果')
    return result
  }

  if (required && !(await isSoleAdmin(ctx.db))) {
    throw approvalRequired(required)
  }
  return emitModerationEvents(ctx, payload)
}

export async function listScheduledActions(
  deps: ModerationDeps,
  input: com.selfcommand.admin.moderation.scheduled.list.$InputBody,
): Promise<{ actions: ScheduledActionView[]; cursor?: string }> {
  const result = await callUpstream<{ actions?: unknown[]; cursor?: string }>(
    deps.ozone,
    OZONE.scheduledList,
    {
      method: 'POST',
      body: {
        statuses: input.statuses ?? ['pending'],
        ...(input.subjects !== undefined ? { subjects: input.subjects } : {}),
        limit: input.limit ?? 50,
        ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
      },
    },
  )
  return {
    actions: list(result.actions).map(normalizeScheduledActionView),
    ...(result.cursor !== undefined ? { cursor: result.cursor } : {}),
  }
}

export async function cancelScheduledActions(
  ctx: ModerationWriteContext,
  input: com.selfcommand.admin.moderation.scheduled.cancel.$InputBody,
): Promise<com.selfcommand.admin.moderation.scheduled.cancel.$OutputBody> {
  const subjects = input.subjects.filter((subject) => isDidString(subject))
  if (!subjects.length) throw invalid('至少需要一个有效的账号标识')
  try {
    const results = await callUpstream<unknown>(ctx.ozone, OZONE.scheduledCancel, {
      method: 'POST',
      body: {
        subjects,
        ...(input.comment !== undefined ? { comment: input.comment } : {}),
      },
    })
    await writeAudit(ctx.db, ctx.logger, {
      actor: ctx.actor,
      action: 'com.selfcommand.admin.moderation.scheduled.cancel',
      targetType: 'moderation',
      target: subjects.length === 1 ? subjects[0] : `batch:${subjects.length}`,
      result: 'success',
      detail: `取消 ${subjects.length} 个账号的定时处置`,
      ...ctx.meta,
    })
    return { results: results as never }
  } catch (error) {
    await writeAudit(ctx.db, ctx.logger, {
      actor: ctx.actor,
      action: 'com.selfcommand.admin.moderation.scheduled.cancel',
      targetType: 'moderation',
      target: subjects.length === 1 ? subjects[0] : `batch:${subjects.length}`,
      result: 'error',
      detail: `操作未完成（错误码：${auditErrorCode(error)}）`,
      ...ctx.meta,
    })
    throw error
  }
}

export async function getAccountOverview(
  deps: ModerationDeps,
  did: string,
): Promise<com.selfcommand.admin.moderation.account.overview.$OutputBody> {
  if (!isDidString(did)) throw invalid('账号标识格式不正确')
  const [repo, events, reports] = await Promise.all([
    callUpstream<unknown>(deps.ozone, OZONE.getRepo, { params: { did } }),
    listEvents(deps, { subject: did, limit: 20 }),
    listReports(deps, { status: 'open', did, limit: 10 }),
  ])
  const moderation = rec(rec(repo)?.moderation)
  return {
    overview: normalizeAccountOverview({
      repo,
      events: events.events,
      reports: reports.reports,
    }),
    ...(moderation?.subjectStatus !== undefined
      ? { status: moderation.subjectStatus as never }
      : {}),
    events: events.events,
    reports: reports.reports,
  }
}

export async function randomAccount(
  db: Kysely<Database>,
): Promise<com.selfcommand.admin.moderation.random.$OutputBody> {
  const row = await db
    .selectFrom('admin.account_directory')
    .select(['did', 'handle', 'status'])
    .where('status', '!=', 'deleted')
    .orderBy(sql`random()`)
    .limit(1)
    .executeTakeFirst()
  if (!row) {
    throw new LexServerError(404, {
      error: 'NotFound',
      message: '账号目录中暂无可抽查的账号，请等待同步完成。',
    })
  }
  return {
    overview: {
      did: row.did as AccountOverview['did'],
      ...(row.handle ? { handle: row.handle } : {}),
      status: accountStatus(row.status) ?? 'unknown',
    },
  }
}

export async function moderationAnalytics(
  deps: ModerationDeps,
  params: { days: number; queueId?: number },
): Promise<com.selfcommand.admin.moderation.analytics.$OutputBody> {
  const now = new Date()
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
      (params.days - 1) * 24 * 60 * 60 * 1000,
  )
  const [live, history] = await Promise.all([
    callUpstream<{ stats?: unknown }>(deps.ozone, OZONE.liveStats, {
      params: { queueId: params.queueId },
    }),
    callUpstream<{ stats?: unknown[] }>(deps.ozone, OZONE.historicalStats, {
      params: {
        queueId: params.queueId,
        startDate: start.toISOString(),
        endDate: now.toISOString(),
        limit: Math.min(100, params.days + 1),
      },
    }),
  ])
  const days = list(history.stats).map(normalizeAnalyticsDay)
  days.sort((left, right) => left.day.localeCompare(right.day))
  return { summary: normalizeLiveSummary(live.stats), days }
}
