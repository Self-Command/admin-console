import { com } from '@admin/lexicons'
import type { Logger } from '../logger.js'
import { callUpstream, type XrpcClient } from '../upstream/client.js'
import { bool, integer, iso, nonNegative, oneOf, rec, shape, str } from './values.js'

export type NotificationView = com.selfcommand.admin.inbox.defs.NotificationView
export type NotificationTarget = com.selfcommand.admin.inbox.defs.NotificationTarget
export type UnreadCounts = com.selfcommand.admin.inbox.defs.UnreadCounts
export type NotificationPreferences = com.selfcommand.admin.inbox.defs.NotificationPreferences
export type NotificationListResult =
  com.selfcommand.admin.inbox.listNotifications.$OutputBody

export type InboxDeps = {
  ozone: XrpcClient
  logger: Logger
}

const SECTIONS = ['reports', 'subjects', 'accountStatus'] as const

const TARGET_TYPES: Record<string, NotificationTarget['type']> = {
  reportRef: 'report',
  subjectRef: 'subject',
  standingRef: 'standing',
}

function positive(value: unknown): number | undefined {
  const parsed = integer(value)
  return parsed !== undefined && parsed >= 1 ? parsed : undefined
}

function targetType(value: unknown): NotificationTarget['type'] {
  const type = str(value, 256)
  const suffix = type?.split('#').at(-1)
  return (suffix && TARGET_TYPES[suffix]) || 'unknown'
}

function subjectText(value: unknown): string | undefined {
  if (typeof value === 'string') return str(value)
  const subject = rec(value)
  return str(subject?.uri) ?? str(subject?.did)
}

function normalizeTarget(raw: unknown): NotificationTarget {
  const target = rec(raw)
  const type = targetType(target?.$type)
  if (!target) return { type }
  const reportId = positive(target.reportId)
  const subject = subjectText(target.subject)
  const status = str(target.status, 32)
  const actionType = str(target.actionType, 128)
  const actionId = positive(target.actionId)
  const standing = str(target.standing, 32)
  const previousStanding = str(target.previousStanding, 32)
  const appealOutcome = str(target.appealOutcome, 32)
  return {
    type,
    ...(reportId !== undefined ? { reportId } : {}),
    ...(subject ? { subject } : {}),
    ...(status ? { status } : {}),
    ...(actionType ? { actionType } : {}),
    ...(actionId !== undefined ? { actionId } : {}),
    ...(standing ? { standing } : {}),
    ...(previousStanding ? { previousStanding } : {}),
    ...(appealOutcome ? { appealOutcome } : {}),
  }
}

export function normalizeNotificationView(raw: unknown): NotificationView {
  const notification = rec(raw)
  const id = positive(notification?.id)
  const reason = str(notification?.reason, 64)
  const isRead = bool(notification?.isRead)
  const createdAt = iso(notification?.createdAt)
  if (id === undefined || !reason || isRead === undefined || !createdAt) {
    throw shape('通知')
  }
  const section = oneOf(notification?.section, SECTIONS)
  return {
    id,
    reason: reason as NotificationView['reason'],
    ...(section ? { section } : {}),
    target: normalizeTarget(notification?.target),
    isRead,
    createdAt: createdAt as NotificationView['createdAt'],
  }
}

export async function listUserNotifications(
  deps: InboxDeps,
  params: {
    did: string
    section?: 'reports' | 'subjects' | 'accountStatus'
    reasons?: string[]
    unreadOnly?: boolean
    cursor?: string
    limit: number
  },
): Promise<NotificationListResult> {
  const raw = await callUpstream<unknown>(
    deps.ozone,
    'tools.ozone.inbox.listNotifications',
    {
      params: {
        did: params.did,
        ...(params.section ? { section: params.section } : {}),
        ...(params.reasons?.length ? { reasons: params.reasons } : {}),
        ...(params.unreadOnly !== undefined
          ? { unreadOnly: params.unreadOnly }
          : {}),
        ...(params.cursor ? { cursor: params.cursor } : {}),
        limit: params.limit,
      },
    },
  )
  const body = rec(raw)
  const notifications = body?.notifications
  if (!body || !Array.isArray(notifications)) throw shape('通知')
  const cursor = str(body.cursor)
  return {
    notifications: notifications.map(normalizeNotificationView),
    ...(cursor ? { cursor } : {}),
  }
}

export async function getUserUnreadCount(
  deps: InboxDeps,
  params: { did: string; section?: string },
): Promise<UnreadCounts> {
  const raw = await callUpstream<unknown>(
    deps.ozone,
    'tools.ozone.inbox.getUnreadCount',
    {
      params: {
        did: params.did,
        ...(params.section ? { section: params.section } : {}),
      },
    },
  )
  const body = rec(raw)
  const counts = rec(body?.unreadCounts)
  const total = nonNegative(counts?.total)
  if (!counts || total === undefined) throw shape('通知')
  const reports = nonNegative(counts.reports)
  const subjects = nonNegative(counts.subjects)
  const accountStatus = nonNegative(counts.accountStatus)
  return {
    total,
    ...(reports !== undefined ? { reports } : {}),
    ...(subjects !== undefined ? { subjects } : {}),
    ...(accountStatus !== undefined ? { accountStatus } : {}),
  }
}

export async function getUserNotificationPreferences(
  deps: InboxDeps,
  params: { did: string },
): Promise<NotificationPreferences> {
  const raw = await callUpstream<unknown>(
    deps.ozone,
    'tools.ozone.inbox.getNotificationPreferences',
    { params: { did: params.did } },
  )
  const body = rec(raw)
  const preferences = rec(body?.preferences)
  const reports = bool(preferences?.reports)
  const account = bool(preferences?.account)
  const labels = bool(preferences?.labels)
  if (
    !preferences ||
    reports === undefined ||
    account === undefined ||
    labels === undefined
  ) {
    throw shape('通知')
  }
  return { reports, account, labels }
}
