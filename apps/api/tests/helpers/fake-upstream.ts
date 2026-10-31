import {
  notConfigured,
  type UpstreamCallOptions,
  type UpstreamHealth,
  type XrpcClient,
} from '../../src/upstream/client.js'

export type FakeUpstreamCall = {
  nsid: string
  options: UpstreamCallOptions | undefined
}

export type FakeUpstreamHandler = (
  nsid: string,
  options: UpstreamCallOptions | undefined,
) => unknown

export type FakeUpstream = XrpcClient & { calls: FakeUpstreamCall[] }

export function createFakeUpstream(
  handler: FakeUpstreamHandler,
  options: { name?: string; configured?: boolean } = {},
): FakeUpstream {
  const configured = options.configured ?? true
  const calls: FakeUpstreamCall[] = []
  return {
    name: options.name ?? 'fake-upstream',
    configured,
    calls,
    async call<T>(nsid: string, callOptions?: UpstreamCallOptions): Promise<T> {
      calls.push({ nsid, options: callOptions })
      if (!configured) throw notConfigured(options.name ?? 'fake-upstream')
      return handler(nsid, callOptions) as T
    },
    async probe(): Promise<UpstreamHealth> {
      return configured
        ? { status: 'ok', latencyMs: 1 }
        : { status: 'unavailable', detail: '未配置管理员凭据' }
    },
  }
}

const ISO = '2026-10-29T08:00:00.000Z'
const POST_URI = 'at://did:plc:e2eauthor/app.bsky.feed.post/3kabc'

export const FAKE_REPORT = {
  id: 1,
  status: 'open',
  subject: { type: 'account', subject: 'did:plc:e2eaccount' },
  reportType: 'com.atproto.moderation.defs#reasonOther',
  reportedBy: 'did:plc:e2ereporter',
  createdAt: ISO,
}

function fakeQueue(): unknown {
  return {
    id: 1,
    name: '举报处理队列',
    enabled: true,
    createdBy: 'did:plc:e2eadmin',
    createdAt: ISO,
    updatedAt: ISO,
  }
}

export const FAKE_VERIFICATION = {
  uri: 'at://did:plc:e2eadmin/tools.ozone.verification.defs#verification/1',
  issuer: 'did:plc:e2eadmin',
  subject: 'did:plc:e2etarget',
  handle: 'target.e2e.test',
  displayName: '目标账号',
  createdAt: ISO,
}

export const FAKE_ACCOUNT_VIEW = {
  did: 'did:plc:e2eaccount',
  handle: 'account.e2e.test',
  email: 'account@e2e.test',
  emailConfirmedAt: ISO,
  indexedAt: ISO,
  invitesDisabled: false,
  invitedBy: {
    code: 'invite-parent',
    available: 1,
    disabled: false,
    forAccount: 'did:plc:e2eaccount',
    createdBy: 'did:plc:e2einviter',
    createdAt: ISO,
    uses: [],
  },
  invites: [
    {
      code: 'invite-one',
      available: 2,
      disabled: false,
      forAccount: 'did:plc:e2eaccount',
      createdBy: 'did:plc:e2eaccount',
      createdAt: ISO,
      uses: [{ usedBy: 'did:plc:e2eused', usedAt: ISO }],
    },
  ],
  relatedRecords: [],
  threatSignatures: [{ property: 'foo', value: 'bar' }],
}

export const FAKE_FOLLOW_ACCOUNT = {
  did: 'did:plc:e2efollow',
  handle: 'follow.e2e.test',
  displayName: '关注账号',
}

export const FAKE_LIST = {
  uri: 'at://did:plc:e2eaccount/app.bsky.graph.list/3klist',
  cid: 'bafyreie2elist',
  name: '重点账号',
  purpose: 'modlist',
  indexedAt: ISO,
}

export const FAKE_INBOX_NOTIFICATION = {
  id: 1,
  reason: 'reportResolved',
  section: 'reports',
  isRead: false,
  createdAt: ISO,
  target: {
    $type: 'tools.ozone.inbox.defs#reportRef',
    reportId: 9,
  },
}

export const FAKE_TEMPLATE = {
  id: '1',
  name: '账号通知',
  subject: '账号通知',
  contentMarkdown: '您收到一条通知。',
  disabled: false,
  createdAt: ISO,
  updatedAt: ISO,
}

export function createFakeOzone(): FakeUpstream {
  return createFakeUpstream(
    (nsid, options) => {
      switch (nsid) {
        case 'tools.ozone.report.queryReports':
          return { reports: [] }
        case 'tools.ozone.report.getReport':
          return FAKE_REPORT
        case 'tools.ozone.report.listActivities':
          return { activities: [] }
        case 'tools.ozone.report.closeReports':
          return { closedCount: 0 }
        case 'tools.ozone.report.getLiveStats':
          return { stats: { pendingCount: 0, closedCount: 0 } }
        case 'tools.ozone.report.getHistoricalStats':
          return { stats: [] }
        case 'tools.ozone.queue.listQueues':
          return { queues: [] }
        case 'tools.ozone.queue.createQueue':
        case 'tools.ozone.queue.updateQueue':
          return fakeQueue()
        case 'tools.ozone.queue.deleteQueue':
          return { deleted: true, reportsMigrated: 0 }
        case 'tools.ozone.queue.routeReports':
          return { assigned: 0, unmatched: 0 }
        case 'tools.ozone.moderation.queryEvents':
          return { events: [] }
        case 'tools.ozone.moderation.queryStatuses':
          return { subjectStatuses: [] }
        case 'tools.ozone.moderation.getEvent':
          return {
            id: 1,
            event: {
              $type: 'tools.ozone.moderation.defs#modEventComment',
              comment: '审核备注',
            },
            subject: { did: 'did:plc:e2eaccount' },
            createdBy: 'did:plc:e2eadmin',
            createdAt: ISO,
          }
        case 'tools.ozone.moderation.getRecords':
          return { records: [] }
        case 'tools.ozone.moderation.getRepo': {
          const did =
            typeof options?.params?.did === 'string' ? options.params.did : 'did:plc:e2eaccount'
          return { did, moderation: {} }
        }
        case 'tools.ozone.moderation.emitEvent':
          return { id: 42 }
        case 'tools.ozone.moderation.listScheduledActions':
          return { actions: [] }
        case 'tools.ozone.moderation.cancelScheduledActions':
          return { results: [] }
        case 'tools.ozone.verification.listVerifications':
          return { verifications: [FAKE_VERIFICATION] }
        case 'tools.ozone.verification.grantVerifications': {
          const body = options?.body as
            | { verifications?: { subject: string; handle: string; displayName: string }[] }
            | undefined
          return {
            verifications: (body?.verifications ?? []).map((entry) => ({
              ...FAKE_VERIFICATION,
              subject: entry.subject,
              handle: entry.handle,
              displayName: entry.displayName,
            })),
            failedVerifications: [],
          }
        }
        case 'tools.ozone.verification.revokeVerifications': {
          const body = options?.body as { uris?: string[] } | undefined
          return {
            revokedVerifications: body?.uris ?? [],
            failedRevocations: [],
          }
        }
        case 'tools.ozone.communication.listTemplates':
          return { communicationTemplates: [FAKE_TEMPLATE] }
        case 'tools.ozone.communication.createTemplate':
        case 'tools.ozone.communication.updateTemplate':
          return FAKE_TEMPLATE
        case 'tools.ozone.communication.deleteTemplate':
          return {}
        case 'tools.ozone.setting.listOptions':
          return { options: [] }
        case 'tools.ozone.setting.upsertOption':
          return {
            option: {
              key: 'tools.ozone.setting.test',
              scope: 'instance',
              value: { enabled: true },
              description: '接口开关',
              lastUpdatedBy: 'did:plc:e2eadmin',
              updatedAt: ISO,
            },
          }
        case 'tools.ozone.setting.removeOptions':
          return {}
        case 'tools.ozone.set.querySets':
          return { sets: [] }
        case 'tools.ozone.set.getValues':
          return {
            set: {
              name: 'e2e-set',
              description: '测试集合',
              setSize: 0,
              createdAt: ISO,
              updatedAt: ISO,
            },
            values: [],
          }
        case 'tools.ozone.set.upsertSet':
          return {
            name: 'e2e-set',
            description: '测试集合',
            setSize: 0,
            createdAt: ISO,
            updatedAt: ISO,
          }
        case 'tools.ozone.set.addValues':
        case 'tools.ozone.set.deleteValues':
        case 'tools.ozone.set.deleteSet':
          return {}
        case 'tools.ozone.safelink.queryRules':
          return { rules: [] }
        case 'tools.ozone.safelink.queryEvents':
          return { events: [] }
        case 'tools.ozone.signature.searchAccounts':
          return { accounts: [FAKE_ACCOUNT_VIEW] }
        case 'tools.ozone.signature.findRelatedAccounts':
          return {
            accounts: [
              {
                account: FAKE_ACCOUNT_VIEW,
                similarities: [{ property: 'foo', value: 'bar' }],
              },
            ],
          }
        case 'tools.ozone.signature.findCorrelation':
          return { details: [{ property: 'foo', value: 'bar' }] }
        case 'tools.ozone.inbox.listNotifications':
          return { notifications: [FAKE_INBOX_NOTIFICATION] }
        case 'tools.ozone.inbox.getUnreadCount':
          return {
            unreadCounts: { total: 3, reports: 2, subjects: 1, accountStatus: 0 },
          }
        case 'tools.ozone.inbox.getNotificationPreferences':
          return { preferences: { reports: true, account: true, labels: false } }
        case 'tools.ozone.safelink.addRule':
        case 'tools.ozone.safelink.updateRule':
        case 'tools.ozone.safelink.removeRule':
          return {
            url: 'spam.example',
            pattern: 'domain',
            action: 'block',
            reason: 'spam',
            createdBy: 'did:plc:e2eadmin',
            createdAt: ISO,
          }
        case 'com.atproto.server.describeServer':
          return { did: 'did:web:ozone.e2e.test' }
        default:
          return {}
      }
    },
    { name: 'Ozone' },
  )
}

export function createFakePds(): FakeUpstream {
  return createFakeUpstream(
    (nsid, options) => {
      if (nsid === 'com.atproto.admin.sendEmail') return { sent: true }
      if (nsid === 'com.atproto.admin.getAccountInfo') {
        const did =
          typeof options?.params?.did === 'string'
            ? options.params.did
            : FAKE_ACCOUNT_VIEW.did
        return { ...FAKE_ACCOUNT_VIEW, did }
      }
      return {}
    },
    { name: 'PDS' },
  )
}

export function createFakeAppview(): FakeUpstream {
  return createFakeUpstream(
    (nsid, options) => {
      if (nsid === 'app.bsky.feed.searchPosts') return { posts: [] }
      if (nsid === 'app.bsky.labeler.getServices') {
        return {
          views: [
            {
              did: 'did:web:ozone.e2e.test',
              creator: {
                did: 'did:web:ozone.e2e.test',
                handle: 'ozone.e2e.test',
                displayName: '社区审核服务',
              },
              policies: {
                labelValueDefinitions: [
                  {
                    identifier: 'spam',
                    severity: 'alert',
                    blurs: 'content',
                    defaultSetting: 'warn',
                    adultOnly: false,
                    locales: [{ lang: 'zh', name: '垃圾信息' }],
                  },
                ],
              },
            },
          ],
        }
      }
      if (nsid === 'app.bsky.graph.getFollows') {
        return { subject: { did: 'did:plc:e2eaccount' }, follows: [FAKE_FOLLOW_ACCOUNT] }
      }
      if (nsid === 'app.bsky.graph.getFollowers') {
        return { subject: { did: 'did:plc:e2eaccount' }, followers: [FAKE_FOLLOW_ACCOUNT] }
      }
      if (nsid === 'app.bsky.graph.getBlocks') {
        return { blocks: [FAKE_FOLLOW_ACCOUNT] }
      }
      if (nsid === 'app.bsky.graph.getLists') {
        return { lists: [FAKE_LIST] }
      }
      if (nsid === 'app.bsky.feed.getAuthorFeed') {
        return {
          feed: [
            {
              post: {
                uri: POST_URI,
                cid: 'bafyreie2epostcid',
                author: { did: 'did:plc:e2eaccount', handle: 'account.e2e.test' },
                record: { text: '账号帖子内容' },
                indexedAt: ISO,
              },
            },
          ],
        }
      }
      if (nsid === 'app.bsky.feed.getPosts') {
        const uris = Array.isArray(options?.params?.uris) ? options.params.uris : []
        const uri = typeof uris[0] === 'string' ? uris[0] : undefined
        return {
          posts: uri
            ? [
                {
                  uri,
                  cid: 'bafyreie2efakecid',
                  author: { did: 'did:plc:e2eauthor', handle: 'author.e2e.test' },
                  record: { text: '社区内容' },
                  indexedAt: ISO,
                },
              ]
            : [],
        }
      }
      return {}
    },
    { name: 'AppView' },
  )
}
