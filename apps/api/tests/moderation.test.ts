import { LexServerError } from '@atproto/lex-server'
import { describe, expect, it } from 'vitest'
import { silentLogger } from '../src/logger.js'
import type { ModerationWriteContext } from '../src/services/moderation.js'
import {
  actOnSubjects,
  getEventBatch,
  listEvents,
  normalizeAccountOverview,
  normalizeEventView,
  normalizeQueueView,
  normalizeReportView,
  normalizeScheduledActionView,
  normalizeStatusView,
  queryStatuses,
} from '../src/services/moderation.js'
import { createFakeUpstream } from './helpers/fake-upstream.js'

const REPORT = {
  id: 12,
  status: 'open',
  subject: { type: 'record', subject: 'at://did:plc:author/app.bsky.feed.post/3k' },
  reportType: 'com.atproto.moderation.defs#reasonSpam',
  reportedBy: 'did:plc:reporter',
  createdAt: '2026-10-29T01:02:03.000Z',
  reporter: { profile: { handle: 'reporter.test' } },
  subjectStatus: { subjectRepoHandle: 'author.test' },
  queue: { id: 3 },
  priorityScore: 60,
  comment: '重复发布广告',
}

describe('report view normalization', () => {
  it('maps an Ozone report into the admin view', () => {
    expect(normalizeReportView(REPORT)).toEqual({
      id: 12,
      status: 'open',
      subject: REPORT.subject.subject,
      subjectType: 'record',
      reportType: REPORT.reportType,
      reportedBy: REPORT.reportedBy,
      reporterHandle: 'reporter.test',
      subjectHandle: 'author.test',
      comment: '重复发布广告',
      createdAt: REPORT.createdAt,
      queueId: 3,
      priorityScore: 60,
    })
  })

  it('derives close time only when it follows the last reopen', () => {
    const view = normalizeReportView({
      ...REPORT,
      actions: [
        { event: { $type: 'tools.ozone.report.defs#closeActivity' }, createdAt: '2026-10-29T02:00:00.000Z' },
        { event: { $type: 'tools.ozone.report.defs#reopenActivity' }, createdAt: '2026-10-29T03:00:00.000Z' },
      ],
    })
    expect(view.closedAt).toBeUndefined()
  })

  it('rejects reports missing required fields', () => {
    expect(() => normalizeReportView({ ...REPORT, subject: undefined })).toThrow(LexServerError)
    expect(() => normalizeReportView({ ...REPORT, status: 'unknown' })).toThrow(/无法识别的举报/)
  })
})

describe('event and queue view normalization', () => {
  it('maps event type, subject and comment', () => {
    const view = normalizeEventView({
      id: 5,
      event: {
        $type: 'tools.ozone.moderation.defs#modEventTakedown',
        comment: '下架违规内容',
        durationInHours: 72,
      },
      subject: { did: 'did:plc:target' },
      createdBy: 'did:plc:admin',
      creatorHandle: 'admin.test',
      createdAt: '2026-10-29T01:00:00.000Z',
    })
    expect(view).toEqual({
      id: 5,
      eventType: 'modEventTakedown',
      subject: 'did:plc:target',
      subjectType: 'account',
      createdBy: 'did:plc:admin',
      creatorHandle: 'admin.test',
      createdAt: '2026-10-29T01:00:00.000Z',
      comment: '下架违规内容',
      durationInHours: 72,
    })
  })

  it('rejects events without an identifiable type', () => {
    expect(() =>
      normalizeEventView({ id: 1, subject: { did: 'did:plc:x' }, createdBy: 'did:plc:y', createdAt: '2026-10-29T01:00:00.000Z' }),
    ).toThrow(/无法识别的审核事件/)
  })

  it('maps queues and scheduled actions', () => {
    expect(
      normalizeQueueView({
        id: 2,
        name: '内容举报',
        enabled: true,
        description: '处理内容类举报',
        subjectTypes: ['record'],
        reportTypes: ['spam'],
        createdBy: 'did:plc:admin',
        createdAt: '2026-10-29T01:00:00.000Z',
        updatedAt: '2026-10-29T02:00:00.000Z',
        stats: { pendingCount: 4, closedCount: 10, ignored: 1 },
      }),
    ).toEqual({
      id: 2,
      name: '内容举报',
      enabled: true,
      description: '处理内容类举报',
      subjectTypes: ['record'],
      reportTypes: ['spam'],
      createdBy: 'did:plc:admin',
      createdAt: '2026-10-29T01:00:00.000Z',
      updatedAt: '2026-10-29T02:00:00.000Z',
      stats: { pendingCount: 4, closedCount: 10 },
    })

    expect(
      normalizeScheduledActionView({
        id: 9,
        action: 'takedown',
        did: 'did:plc:target',
        status: 'pending',
        executeAt: '2026-10-30T01:00:00.000Z',
        eventData: { comment: '到期下架' },
        createdBy: 'did:plc:admin',
        createdAt: '2026-10-29T01:00:00.000Z',
      }),
    ).toMatchObject({
      id: 9,
      action: 'takedown',
      subject: 'did:plc:target',
      status: 'pending',
      executeAt: '2026-10-30T01:00:00.000Z',
      comment: '到期下架',
    })

    expect(() => normalizeQueueView({ id: 1 })).toThrow(/无法识别的举报队列/)
    expect(() => normalizeScheduledActionView({ id: 1 })).toThrow(/无法识别的定时处置/)
  })
})

describe('account overview normalization', () => {
  it('derives account status from hosting, takedown and suspension', () => {
    expect(
      normalizeAccountOverview({
        repo: {
          did: 'did:plc:target',
          handle: 'target.test',
          labels: [{ val: 'spam' }],
          moderation: {
            subjectStatus: {
              takendown: true,
              hosting: { status: 'takendown' },
              lastReportedAt: '2026-10-28T01:00:00.000Z',
            },
          },
        },
        events: [{ id: 1 }, { id: 2 }],
        reports: [{ id: 1 }],
      }),
    ).toEqual({
      did: 'did:plc:target',
      handle: 'target.test',
      status: 'takendown',
      takendown: true,
      muted: false,
      lastReportedAt: '2026-10-28T01:00:00.000Z',
      eventCount: 2,
      openReportCount: 1,
      labels: ['spam'],
    })

    expect(() => normalizeAccountOverview({ repo: { did: 'not-a-did' }, events: [], reports: [] })).toThrow(
      /无法识别的账号/,
    )
  })
})

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
  ozone: ModerationWriteContext['ozone'],
): ModerationWriteContext {
  return {
    db: db as ModerationWriteContext['db'],
    ozone,
    logger: silentLogger,
    actor: 'did:plc:moderator',
    meta: {},
    ttlHours: 24,
  }
}

describe('moderation act approvals', () => {
  const SUBJECT = 'did:plc:target'

  it('ignores the approval id when normalizing the moderation payload', async () => {
    const ozone = createFakeUpstream(() => {
      throw new Error('upstream should not be called')
    })
    const ctx = writeContext(fakeAdminCount(1), ozone)

    await expect(
      actOnSubjects(ctx, {
        subjects: [SUBJECT],
        action: 'comment',
        comment: '补充备注',
        approvalId: 'a'.repeat(32),
      }),
    ).rejects.toMatchObject({
      status: 400,
      body: { message: '该处置动作无需审批，请移除审批编号' },
    })
    expect(ozone.calls).toHaveLength(0)
  })

  it('requires an approval for a single destructive action when other admins exist', async () => {
    const ozone = createFakeUpstream(() => {
      throw new Error('upstream should not be called')
    })
    const ctx = writeContext(fakeAdminCount(2), ozone)

    await expect(
      actOnSubjects(ctx, { subjects: [SUBJECT], action: 'takedown', comment: '违规内容' }),
    ).rejects.toMatchObject({ status: 409, body: { error: 'ApprovalRequired' } })
    expect(ozone.calls).toHaveLength(0)
  })

  it('executes non-destructive actions without an approval', async () => {
    const ozone = createFakeUpstream((nsid) =>
      nsid === 'tools.ozone.moderation.emitEvent' ? { id: 42 } : {},
    )
    const ctx = writeContext(fakeAdminCount(3), ozone)

    await expect(
      actOnSubjects(ctx, { subjects: [SUBJECT], action: 'comment', comment: '已核查' }),
    ).resolves.toEqual({ events: [{ subject: SUBJECT, eventId: 42 }], failed: [] })
    const emit = ozone.calls.find((call) => call.nsid === 'tools.ozone.moderation.emitEvent')
    expect(emit?.options?.body).toMatchObject({
      createdBy: 'did:plc:moderator',
      subject: { $type: 'com.atproto.admin.defs#repoRef', did: SUBJECT },
    })
  })

  it('accepts DID-based record URIs and resolves their CID before emitting', async () => {
    const uri = 'at://did:plc:author/app.bsky.feed.post/3kxyz'
    const ozone = createFakeUpstream((nsid) => {
      if (nsid === 'tools.ozone.moderation.getRecords') {
        return { records: [{ uri, cid: 'bafyreicid' }] }
      }
      if (nsid === 'tools.ozone.moderation.emitEvent') return { id: 43 }
      return {}
    })
    const ctx = writeContext(fakeAdminCount(1), ozone)

    await expect(
      actOnSubjects(ctx, { subjects: [uri], action: 'takedown', comment: '违规内容' }),
    ).resolves.toEqual({ events: [{ subject: uri, eventId: 43 }], failed: [] })
    const emit = ozone.calls.find((call) => call.nsid === 'tools.ozone.moderation.emitEvent')
    expect(emit?.options?.body).toMatchObject({
      subject: { $type: 'com.atproto.repo.strongRef', uri, cid: 'bafyreicid' },
    })
  })
})

const STATUS = {
  id: 31,
  subject: { $type: 'com.atproto.admin.defs#repoRef', did: 'did:plc:target' },
  subjectRepoHandle: 'target.test',
  reviewState: 'tools.ozone.moderation.defs#reviewEscalated',
  takendown: true,
  muteUntil: '2099-01-01T00:00:00.000Z',
  priorityScore: 80,
  comment: '待复核',
  tags: ['spam', 'repeat'],
  lastReportedAt: '2026-10-29T02:00:00.000Z',
  lastReviewedAt: '2026-10-29T03:00:00.000Z',
  lastReviewedBy: 'did:plc:moderator',
  createdAt: '2026-10-28T01:00:00.000Z',
  updatedAt: '2026-10-29T03:00:00.000Z',
}

function fakeEvent(
  id: number,
  eventType: string,
  createdAt: string,
  createdBy = 'did:plc:moderator',
): unknown {
  return {
    id,
    event: { $type: `tools.ozone.moderation.defs#${eventType}` },
    subject: { did: 'did:plc:target' },
    createdBy,
    createdAt,
  }
}

describe('status query and event batch', () => {
  it('maps an Ozone subject status into the admin view', () => {
    expect(normalizeStatusView(STATUS)).toEqual({
      id: 31,
      subject: 'did:plc:target',
      subjectType: 'account',
      subjectHandle: 'target.test',
      reviewState: 'escalated',
      takendown: true,
      muted: true,
      comment: '待复核',
      priorityScore: 80,
      lastReportedAt: '2026-10-29T02:00:00.000Z',
      lastReviewedAt: '2026-10-29T03:00:00.000Z',
      lastReviewedBy: 'did:plc:moderator',
      tags: ['spam', 'repeat'],
      createdAt: '2026-10-28T01:00:00.000Z',
      updatedAt: '2026-10-29T03:00:00.000Z',
    })
    expect(() => normalizeStatusView({ ...STATUS, reviewState: 'pending' })).toThrow(
      /无法识别的处置状态/,
    )
  })

  it('maps review state filters and pagination to the Ozone query', async () => {
    const ozone = createFakeUpstream((nsid) =>
      nsid === 'tools.ozone.moderation.queryStatuses'
        ? { subjectStatuses: [STATUS], cursor: 'next-page' }
        : {},
    )

    const result = await queryStatuses(
      { ozone, logger: silentLogger },
      {
        reviewState: 'open',
        subjectType: 'account',
        takendown: true,
        lastReviewedBy: 'did:plc:moderator',
        reportedAfter: '2026-10-01T00:00:00.000Z',
        limit: 25,
        cursor: 'page-1',
      },
    )

    expect(result.cursor).toBe('next-page')
    expect(result.statuses[0]).toMatchObject({ id: 31, reviewState: 'escalated' })
    expect(ozone.calls[0]?.options?.params).toMatchObject({
      reviewState: 'tools.ozone.moderation.defs#reviewOpen',
      subjectType: 'account',
      takendown: true,
      lastReviewedBy: 'did:plc:moderator',
      reportedAfter: '2026-10-01T00:00:00.000Z',
      limit: 25,
      cursor: 'page-1',
    })
  })

  it('rejects unknown review states without calling upstream', async () => {
    const ozone = createFakeUpstream(() => {
      throw new Error('upstream should not be called')
    })
    await expect(
      queryStatuses({ ozone, logger: silentLogger }, { reviewState: 'pending', limit: 50 }),
    ).rejects.toMatchObject({ status: 400 })
    expect(ozone.calls).toHaveLength(0)
  })

  it('surfaces upstream failures as a service error', async () => {
    const ozone = createFakeUpstream(() => {
      throw new Error('ozone offline')
    })
    await expect(
      queryStatuses({ ozone, logger: silentLogger }, { limit: 50 }),
    ).rejects.toBeInstanceOf(LexServerError)
  })

  it('passes the batch id through the event list', async () => {
    const ozone = createFakeUpstream(() => ({ events: [] }))
    await listEvents({ ozone, logger: silentLogger }, { limit: 20, batchId: 'batch-9' })
    expect(ozone.calls[0]?.nsid).toBe('tools.ozone.moderation.queryEvents')
    expect(ozone.calls[0]?.options?.params).toMatchObject({ batchId: 'batch-9' })
  })

  it('aggregates a batch across pages', async () => {
    const ozone = createFakeUpstream((nsid, options) => {
      if (nsid !== 'tools.ozone.moderation.queryEvents') return {}
      if (!options?.params?.cursor) {
        return {
          events: [
            fakeEvent(1, 'modEventTakedown', '2026-10-29T01:00:00.000Z', 'did:plc:a'),
            fakeEvent(2, 'modEventComment', '2026-10-29T02:00:00.000Z', 'did:plc:b'),
          ],
          cursor: 'page-2',
        }
      }
      return { events: [fakeEvent(3, 'modEventTakedown', '2026-10-29T03:00:00.000Z', 'did:plc:a')] }
    })

    const summary = await getEventBatch({ ozone, logger: silentLogger }, 'batch-1')

    expect(summary).toEqual({
      batchId: 'batch-1',
      totalEvents: 3,
      scannedEvents: 3,
      truncated: false,
      createdAfter: '2026-10-29T01:00:00.000Z',
      createdBefore: '2026-10-29T03:00:00.000Z',
      typeCounts: [
        { eventType: 'modEventTakedown', count: 2 },
        { eventType: 'modEventComment', count: 1 },
      ],
      createdBy: ['did:plc:a', 'did:plc:b'],
    })
    expect(ozone.calls).toHaveLength(2)
    expect(ozone.calls.every((call) => call.options?.params?.batchId === 'batch-1')).toBe(true)
  })

  it('stops at the scan limit and marks the summary truncated', async () => {
    let page = 0
    const ozone = createFakeUpstream((nsid) => {
      if (nsid !== 'tools.ozone.moderation.queryEvents') return {}
      page += 1
      return {
        events: Array.from({ length: 100 }, (_, index) =>
          fakeEvent(page * 100 + index, 'modEventComment', '2026-10-29T01:00:00.000Z'),
        ),
        cursor: `page-${page + 1}`,
      }
    })

    const summary = await getEventBatch({ ozone, logger: silentLogger }, 'batch-cap')

    expect(summary.scannedEvents).toBe(500)
    expect(summary.truncated).toBe(true)
    expect(ozone.calls).toHaveLength(5)
    expect(summary.typeCounts).toEqual([{ eventType: 'modEventComment', count: 500 }])
  })

  it('requires a batch id', async () => {
    const ozone = createFakeUpstream(() => {
      throw new Error('upstream should not be called')
    })
    await expect(getEventBatch({ ozone, logger: silentLogger }, '  ')).rejects.toMatchObject({
      status: 400,
    })
    expect(ozone.calls).toHaveLength(0)
  })
})
