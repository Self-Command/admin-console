import { describe, expect, it } from 'vitest'
import { silentLogger } from '../src/logger.js'
import {
  getUserNotificationPreferences,
  getUserUnreadCount,
  listUserNotifications,
} from '../src/services/inbox.js'
import { createFakeUpstream } from './helpers/fake-upstream.js'

const DID = 'did:plc:alice'
const ISO = '2026-10-29T08:00:00.000Z'
const SHAPE_ERROR = '上游服务返回了无法识别的通知数据，请稍后重试。'

const NOTIFICATION = {
  id: 1,
  reason: 'actionTaken',
  section: 'subjects',
  target: {
    $type: 'tools.ozone.inbox.defs#subjectRef',
    subject: {
      $type: 'com.atproto.repo.strongRef',
      uri: 'at://did:plc:alice/app.bsky.feed.post/3kpost',
      cid: 'bafyreipost',
    },
    actionType: 'takedown',
    actionId: 7,
  },
  isRead: false,
  createdAt: ISO,
}

function deps(ozone: ReturnType<typeof createFakeUpstream>) {
  return { ozone, logger: silentLogger }
}

describe('user notification listing', () => {
  it('maps notifications with section, array reasons and paging params', async () => {
    const ozone = createFakeUpstream((nsid) =>
      nsid === 'tools.ozone.inbox.listNotifications'
        ? { notifications: [NOTIFICATION], cursor: 'next-page' }
        : {},
    )

    const result = await listUserNotifications(deps(ozone), {
      did: DID,
      section: 'subjects',
      reasons: ['actionTaken', 'appealResolved'],
      unreadOnly: true,
      cursor: 'page-1',
      limit: 20,
    })

    expect(ozone.calls).toHaveLength(1)
    expect(ozone.calls[0]?.nsid).toBe('tools.ozone.inbox.listNotifications')
    expect(ozone.calls[0]?.options?.params).toStrictEqual({
      did: DID,
      section: 'subjects',
      reasons: ['actionTaken', 'appealResolved'],
      unreadOnly: true,
      cursor: 'page-1',
      limit: 20,
    })
    expect(result).toStrictEqual({
      notifications: [
        {
          id: 1,
          reason: 'actionTaken',
          section: 'subjects',
          target: {
            type: 'subject',
            subject: 'at://did:plc:alice/app.bsky.feed.post/3kpost',
            actionType: 'takedown',
            actionId: 7,
          },
          isRead: false,
          createdAt: ISO,
        },
      ],
      cursor: 'next-page',
    })
  })

  it('maps report, standing and unknown targets and omits absent sections', async () => {
    const ozone = createFakeUpstream(() => ({
      notifications: [
        {
          id: 2,
          reason: 'reportResolved',
          target: {
            $type: 'tools.ozone.inbox.defs#reportRef',
            reportId: 9,
            subject: {
              $type: 'com.atproto.admin.defs#repoRef',
              did: 'did:plc:reported',
            },
            status: 'resolved',
          },
          isRead: true,
          createdAt: ISO,
        },
        {
          id: 3,
          reason: 'standingChanged',
          target: {
            $type: 'tools.ozone.inbox.defs#standingRef',
            standing: 'warning',
            previousStanding: 'good',
          },
          isRead: true,
          createdAt: ISO,
        },
        {
          id: 4,
          reason: 'actionReversed',
          target: { $type: 'com.example.custom#otherRef', reportId: 5 },
          isRead: false,
          createdAt: ISO,
        },
        { id: 5, reason: 'actionTaken', isRead: false, createdAt: ISO },
      ],
    }))

    const result = await listUserNotifications(deps(ozone), {
      did: DID,
      limit: 10,
    })

    expect(result.notifications.map((entry) => entry.target)).toStrictEqual([
      {
        type: 'report',
        reportId: 9,
        subject: 'did:plc:reported',
        status: 'resolved',
      },
      { type: 'standing', standing: 'warning', previousStanding: 'good' },
      { type: 'unknown', reportId: 5 },
      { type: 'unknown' },
    ])
    expect(result.notifications[0]).not.toHaveProperty('section')
    expect(result).not.toHaveProperty('cursor')
  })

  const INVALID_NOTIFICATIONS: Array<[string, Record<string, unknown>]> = [
    ['id', { ...NOTIFICATION, id: 0 }],
    ['isRead', { ...NOTIFICATION, isRead: 'yes' }],
    ['createdAt', { ...NOTIFICATION, createdAt: 'not-a-date' }],
    ['reason', { ...NOTIFICATION, reason: '   ' }],
  ]

  it.each(INVALID_NOTIFICATIONS)(
    'rejects notifications without a valid %s',
    async (_field, notification) => {
      const ozone = createFakeUpstream(() => ({
        notifications: [notification],
      }))

      await expect(
        listUserNotifications(deps(ozone), { did: DID, limit: 10 }),
      ).rejects.toMatchObject({
        status: 502,
        body: { error: 'UpstreamUnavailable', message: SHAPE_ERROR },
      })
    },
  )

  it('rejects non-array notification payloads', async () => {
    const ozone = createFakeUpstream(() => ({ notifications: {} }))

    await expect(
      listUserNotifications(deps(ozone), { did: DID, limit: 10 }),
    ).rejects.toMatchObject({
      status: 502,
      body: { error: 'UpstreamUnavailable', message: SHAPE_ERROR },
    })
  })

  it('returns an empty page and drops an empty cursor', async () => {
    const ozone = createFakeUpstream(() => ({
      notifications: [],
      cursor: '',
    }))

    const result = await listUserNotifications(deps(ozone), {
      did: DID,
      limit: 10,
    })

    expect(result).toStrictEqual({ notifications: [] })
  })

  it('passes through NotConfigured when Ozone has no credential', async () => {
    const ozone = createFakeUpstream(() => ({}), { configured: false })

    await expect(
      listUserNotifications(deps(ozone), { did: DID, limit: 10 }),
    ).rejects.toMatchObject({
      status: 503,
      body: { error: 'NotConfigured' },
    })
  })
})

describe('user unread counts', () => {
  it('maps counts for a section', async () => {
    const ozone = createFakeUpstream((nsid) =>
      nsid === 'tools.ozone.inbox.getUnreadCount'
        ? {
            unreadCounts: {
              total: 4,
              reports: 2,
              subjects: 1,
              accountStatus: 1,
            },
          }
        : {},
    )

    const counts = await getUserUnreadCount(deps(ozone), {
      did: DID,
      section: 'reports',
    })

    expect(ozone.calls[0]?.nsid).toBe('tools.ozone.inbox.getUnreadCount')
    expect(ozone.calls[0]?.options?.params).toStrictEqual({
      did: DID,
      section: 'reports',
    })
    expect(counts).toStrictEqual({
      total: 4,
      reports: 2,
      subjects: 1,
      accountStatus: 1,
    })
  })

  it('omits counts and section that upstream does not return', async () => {
    const ozone = createFakeUpstream(() => ({
      unreadCounts: { total: 0 },
    }))

    const counts = await getUserUnreadCount(deps(ozone), { did: DID })

    expect(ozone.calls[0]?.options?.params).toStrictEqual({ did: DID })
    expect(counts).toStrictEqual({ total: 0 })
  })

  it('rejects counts without a non-negative total', async () => {
    const ozone = createFakeUpstream(() => ({
      unreadCounts: { total: -1, reports: 2 },
    }))

    await expect(
      getUserUnreadCount(deps(ozone), { did: DID }),
    ).rejects.toMatchObject({
      status: 502,
      body: { error: 'UpstreamUnavailable', message: SHAPE_ERROR },
    })
  })
})

describe('user notification preferences', () => {
  it('maps the three preference flags', async () => {
    const ozone = createFakeUpstream((nsid) =>
      nsid === 'tools.ozone.inbox.getNotificationPreferences'
        ? { preferences: { reports: true, account: false, labels: true } }
        : {},
    )

    const preferences = await getUserNotificationPreferences(deps(ozone), {
      did: DID,
    })

    expect(ozone.calls[0]?.nsid).toBe(
      'tools.ozone.inbox.getNotificationPreferences',
    )
    expect(ozone.calls[0]?.options?.params).toStrictEqual({ did: DID })
    expect(preferences).toStrictEqual({
      reports: true,
      account: false,
      labels: true,
    })
  })

  it('rejects preferences with missing flags', async () => {
    const ozone = createFakeUpstream(() => ({
      preferences: { reports: true, account: false },
    }))

    await expect(
      getUserNotificationPreferences(deps(ozone), { did: DID }),
    ).rejects.toMatchObject({
      status: 502,
      body: { error: 'UpstreamUnavailable', message: SHAPE_ERROR },
    })
  })
})
