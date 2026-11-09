import {
  LexServerAuthError,
  type LexRouterAuth,
  type ServiceAuthCredentials,
} from '@atproto/lex-server'
import { sql } from 'kysely'
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootstrapAdmin } from '../../src/auth/roles.js'
import { loadConfig, type Config } from '../../src/config.js'
import { closeDb, createDb } from '../../src/db/index.js'
import { migrateToLatest } from '../../src/db/migrations.js'
import type { AuditResult } from '../../src/db/types.js'
import { DirectoryIndexer } from '../../src/directory/indexer.js'
import type { PdsClient } from '../../src/directory/pds.js'
import type { FirehoseSource } from '../../src/directory/source.js'
import { KyselyDirectoryStore } from '../../src/directory/store.js'
import { silentLogger } from '../../src/logger.js'
import { closeServer, createAppServer } from '../../src/server.js'
import {
  createOzoneClient,
  createPdsAdminClient,
  type XrpcClient,
} from '../../src/upstream/client.js'
import {
  createFakeAppview,
  createFakeOzone,
  createFakePds,
  createFakeUpstream,
  type FakeUpstream,
} from '../helpers/fake-upstream.js'

// HTTP permission matrix against a real database. The service JWT transport is
// replaced by a token-to-DID map, but the guard, role lookup, audit trail and
// XRPC layer under test are the production ones.
//
//   ADMIN_API_E2E_DATABASE_URL=postgres://... pnpm --filter @admin/api test:e2e
// The schema `admin` is dropped and recreated; never point this at shared data.

const dbUrl = process.env.ADMIN_API_E2E_DATABASE_URL
const describeDb = dbUrl ? describe : describe.skip

const ADMIN_DID = 'did:plc:e2eadmin'
const SECOND_ADMIN = 'did:plc:e2ersecondadmin'
const MODERATOR = 'did:plc:e2emoderator'
const VIEWER = 'did:plc:e2eviewer'
const OPERATOR = 'did:plc:e2eoperator'
const NOROLE = 'did:plc:e2enorole'
const TARGET = 'did:plc:e2etarget'
const ACCOUNT_DID = 'did:plc:e2eaccount'
const DRILL_APPROVER = 'did:plc:e2edrillapprover'
const POST_URI = 'at://did:plc:e2eauthor/app.bsky.feed.post/3kabc'

type Actor =
  | 'anon'
  | 'viewer'
  | 'operator'
  | 'moderator'
  | 'admin'
  | 'admin2'
  | 'norole'
  | 'drill'
type MatrixActor = 'anon' | 'viewer' | 'operator' | 'moderator' | 'admin'

const tokens: Record<Exclude<Actor, 'anon'>, string> = {
  viewer: 'token-viewer',
  operator: 'token-operator',
  moderator: 'token-moderator',
  admin: 'token-admin',
  admin2: 'token-admin2',
  norole: 'token-norole',
  drill: 'token-drill-approver',
}

const tokenDids = new Map<string, string>([
  [tokens.viewer, VIEWER],
  [tokens.operator, OPERATOR],
  [tokens.moderator, MODERATOR],
  [tokens.admin, ADMIN_DID],
  [tokens.admin2, SECOND_ADMIN],
  [tokens.norole, NOROLE],
  [tokens.drill, DRILL_APPROVER],
])

const unusedSource: FirehoseSource = {
  async run() {
    throw new Error('not used')
  },
}

const unusedPds: PdsClient = {
  async listRepos() {
    throw new Error('not used')
  },
  async resolveHandle() {
    return null
  },
}

function makeVerifier(serviceDid: string): LexRouterAuth<ServiceAuthCredentials> {
  return async (ctx) => {
    const header = ctx.request.headers.get('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
    const subject = tokenDids.get(token)
    if (!subject) {
      throw new LexServerAuthError('AuthenticationRequired', 'Authentication required')
    }
    const now = Math.floor(Date.now() / 1000)
    return {
      did: subject as never,
      didDocument: {} as never,
      jwt: {
        payload: {
          iss: subject,
          aud: serviceDid,
          lxm: ctx.method.nsid,
          iat: now,
          exp: now + 300,
        },
      } as never,
    }
  }
}

const NSID = {
  session: 'com.selfcommand.admin.session.get',
  roleList: 'com.selfcommand.admin.role.list',
  roleGet: 'com.selfcommand.admin.role.get',
  roleCreate: 'com.selfcommand.admin.role.create',
  roleUpdate: 'com.selfcommand.admin.role.update',
  roleRevoke: 'com.selfcommand.admin.role.revoke',
  auditList: 'com.selfcommand.admin.audit.list',
  accountList: 'com.selfcommand.admin.account.list',
  accountGet: 'com.selfcommand.admin.account.get',
  accountProfileGet: 'com.selfcommand.admin.account.profile.get',
  accountProfileUpdate: 'com.selfcommand.admin.account.profile.update',
  accountExport: 'com.selfcommand.admin.account.export',
  accountBatchExport: 'com.selfcommand.admin.account.batch.export',
  accountGraph: 'com.selfcommand.admin.account.graph',
  accountPosts: 'com.selfcommand.admin.account.posts',
  signatureSearch: 'com.selfcommand.admin.signature.searchAccounts',
  signatureRelated: 'com.selfcommand.admin.signature.findRelatedAccounts',
  signatureCorrelation: 'com.selfcommand.admin.signature.findCorrelation',
  inboxList: 'com.selfcommand.admin.inbox.listNotifications',
  inboxUnread: 'com.selfcommand.admin.inbox.getUnreadCount',
  inboxPreferences: 'com.selfcommand.admin.inbox.getNotificationPreferences',
  securityAccessList: 'com.selfcommand.admin.security.access.list',
  securityBlockedList: 'com.selfcommand.admin.security.blocked.list',
  securityBlock: 'com.selfcommand.admin.security.block',
  securityUnblock: 'com.selfcommand.admin.security.unblock',
  securitySelf: 'com.selfcommand.admin.security.self',
  approvalCreate: 'com.selfcommand.admin.approval.create',
  approvalList: 'com.selfcommand.admin.approval.list',
  approvalApprove: 'com.selfcommand.admin.approval.approve',
  approvalReject: 'com.selfcommand.admin.approval.reject',
  approvalCancel: 'com.selfcommand.admin.approval.cancel',
  dashboardSeries: 'com.selfcommand.admin.dashboard.series',
  settingsReset: 'com.selfcommand.admin.settings.reset',
  contentSearch: 'com.selfcommand.admin.content.search',
  contentGet: 'com.selfcommand.admin.content.get',
  contentImageSearch: 'com.selfcommand.admin.content.imageSearch',
  reportList: 'com.selfcommand.admin.moderation.report.list',
  reportGet: 'com.selfcommand.admin.moderation.report.get',
  reportAct: 'com.selfcommand.admin.moderation.report.act',
  queueList: 'com.selfcommand.admin.moderation.queue.list',
  queueAct: 'com.selfcommand.admin.moderation.queue.act',
  eventList: 'com.selfcommand.admin.moderation.event.list',
  eventGet: 'com.selfcommand.admin.moderation.event.get',
  eventBatchGet: 'com.selfcommand.admin.moderation.events.batch.get',
  statusQuery: 'com.selfcommand.admin.moderation.status.query',
  moderationAct: 'com.selfcommand.admin.moderation.act',
  scheduledList: 'com.selfcommand.admin.moderation.scheduled.list',
  scheduledCancel: 'com.selfcommand.admin.moderation.scheduled.cancel',
  accountOverview: 'com.selfcommand.admin.moderation.account.overview',
  randomReview: 'com.selfcommand.admin.moderation.random',
  moderationAnalytics: 'com.selfcommand.admin.moderation.analytics',
  chatMetadata: 'com.selfcommand.admin.chat.metadata',
  verificationList: 'com.selfcommand.admin.verification.list',
  verificationAct: 'com.selfcommand.admin.verification.act',
  templateList: 'com.selfcommand.admin.notifications.template.list',
  templateAct: 'com.selfcommand.admin.notifications.template.act',
  notificationSend: 'com.selfcommand.admin.notifications.send',
  optionList: 'com.selfcommand.admin.policy.option.list',
  optionAct: 'com.selfcommand.admin.policy.option.act',
  setList: 'com.selfcommand.admin.policy.set.list',
  setGet: 'com.selfcommand.admin.policy.set.get',
  setAct: 'com.selfcommand.admin.policy.set.act',
  safelinkList: 'com.selfcommand.admin.policy.safelink.list',
  safelinkEvents: 'com.selfcommand.admin.policy.safelink.events',
  safelinkAct: 'com.selfcommand.admin.policy.safelink.act',
  labelerGet: 'com.selfcommand.admin.policy.labeler.get',
  accountAdminInfo: 'com.selfcommand.admin.account.admin.info',
  accountAdminUpdate: 'com.selfcommand.admin.account.admin.update',
  accountAdminDelete: 'com.selfcommand.admin.account.admin.delete',
  accountInvitesDisable: 'com.selfcommand.admin.account.invites.disable',
  contentExport: 'com.selfcommand.admin.content.export',
  analyticsExport: 'com.selfcommand.admin.analytics.export',
  announcementList: 'com.selfcommand.admin.announcement.list',
  announcementGet: 'com.selfcommand.admin.announcement.get',
  announcementCreate: 'com.selfcommand.admin.announcement.create',
  announcementUpdate: 'com.selfcommand.admin.announcement.update',
  announcementPublish: 'com.selfcommand.admin.announcement.publish',
  announcementArchive: 'com.selfcommand.admin.announcement.archive',
  announcementPublic: 'com.selfcommand.admin.announcement.public',
  settingsApprovalsGet: 'com.selfcommand.admin.settings.approvals.get',
  settingsApprovalsUpdate: 'com.selfcommand.admin.settings.approvals.update',
} as const

type QueryParams = Record<string, string | string[]>

type MatrixEntry = {
  name: string
  nsid: string
  params?: QueryParams
  body?: Record<string, unknown>
  statuses: Record<MatrixActor, number>
}

const browseEntries: MatrixEntry[] = [
  {
    name: 'account.graph',
    nsid: NSID.accountGraph,
    params: { did: ACCOUNT_DID, kind: 'follows' },
    statuses: { anon: 401, viewer: 200, operator: 200, moderator: 200, admin: 200 },
  },
  {
    name: 'account.posts',
    nsid: NSID.accountPosts,
    params: { did: ACCOUNT_DID },
    statuses: { anon: 401, viewer: 200, operator: 200, moderator: 200, admin: 200 },
  },
  {
    name: 'signature.searchAccounts',
    nsid: NSID.signatureSearch,
    params: { values: ['foo'] },
    statuses: { anon: 401, viewer: 200, operator: 200, moderator: 200, admin: 200 },
  },
  {
    name: 'signature.findRelatedAccounts',
    nsid: NSID.signatureRelated,
    params: { did: ACCOUNT_DID },
    statuses: { anon: 401, viewer: 200, operator: 200, moderator: 200, admin: 200 },
  },
  {
    name: 'signature.findCorrelation',
    nsid: NSID.signatureCorrelation,
    params: { dids: ['did:plc:e2eone', 'did:plc:e2etwo'] },
    statuses: { anon: 401, viewer: 200, operator: 200, moderator: 200, admin: 200 },
  },
  {
    name: 'inbox.listNotifications',
    nsid: NSID.inboxList,
    params: { did: ACCOUNT_DID },
    statuses: { anon: 401, viewer: 200, operator: 200, moderator: 200, admin: 200 },
  },
  {
    name: 'inbox.getUnreadCount',
    nsid: NSID.inboxUnread,
    params: { did: ACCOUNT_DID },
    statuses: { anon: 401, viewer: 200, operator: 200, moderator: 200, admin: 200 },
  },
  {
    name: 'inbox.getNotificationPreferences',
    nsid: NSID.inboxPreferences,
    params: { did: ACCOUNT_DID },
    statuses: { anon: 401, viewer: 200, operator: 200, moderator: 200, admin: 200 },
  },
]

const matrix: MatrixEntry[] = [
  {
    name: 'session.get',
    nsid: NSID.session,
    statuses: { anon: 401, viewer: 200, operator: 200, moderator: 200, admin: 200 },
  },
  {
    name: 'role.list',
    nsid: NSID.roleList,
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 403, admin: 200 },
  },
  {
    name: 'role.get',
    nsid: NSID.roleGet,
    params: { subject: VIEWER },
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 403, admin: 200 },
  },
  {
    name: 'role.create',
    nsid: NSID.roleCreate,
    body: { subject: TARGET, role: 'viewer' },
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 403, admin: 200 },
  },
  {
    name: 'role.update',
    nsid: NSID.roleUpdate,
    body: { subject: TARGET, role: 'operator' },
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 403, admin: 200 },
  },
  {
    name: 'role.revoke',
    nsid: NSID.roleRevoke,
    body: { subject: TARGET },
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 403, admin: 200 },
  },
  {
    name: 'audit.list',
    nsid: NSID.auditList,
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 403, admin: 200 },
  },
  {
    name: 'account.list',
    nsid: NSID.accountList,
    statuses: { anon: 401, viewer: 200, operator: 200, moderator: 200, admin: 200 },
  },
  {
    name: 'account.get',
    nsid: NSID.accountGet,
    params: { did: ACCOUNT_DID },
    statuses: { anon: 401, viewer: 200, operator: 200, moderator: 200, admin: 200 },
  },
  {
    name: 'account.profile.get',
    nsid: NSID.accountProfileGet,
    params: { did: ACCOUNT_DID },
    statuses: { anon: 401, viewer: 200, operator: 200, moderator: 200, admin: 200 },
  },
  {
    name: 'account.profile.update',
    nsid: NSID.accountProfileUpdate,
    body: { did: ACCOUNT_DID, note: 'e2e note' },
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 200, admin: 200 },
  },
  {
    name: 'account.export',
    nsid: NSID.accountExport,
    params: { did: ACCOUNT_DID },
    statuses: { anon: 401, viewer: 200, operator: 200, moderator: 200, admin: 200 },
  },
  {
    name: 'account.batch.export',
    nsid: NSID.accountBatchExport,
    params: { dids: ACCOUNT_DID, format: 'csv' },
    statuses: { anon: 401, viewer: 200, operator: 200, moderator: 200, admin: 200 },
  },
  {
    name: 'security.access.list',
    nsid: NSID.securityAccessList,
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 403, admin: 200 },
  },
  {
    name: 'security.blocked.list',
    nsid: NSID.securityBlockedList,
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 403, admin: 200 },
  },
  {
    name: 'security.self',
    nsid: NSID.securitySelf,
    statuses: { anon: 401, viewer: 200, operator: 200, moderator: 200, admin: 200 },
  },
  {
    name: 'security.block',
    nsid: NSID.securityBlock,
    body: { did: TARGET, reason: 'e2e 权限矩阵' },
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 403, admin: 200 },
  },
  {
    name: 'security.unblock',
    nsid: NSID.securityUnblock,
    body: { did: TARGET },
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 403, admin: 200 },
  },
  {
    // The guard admits every role that can initiate some approval action; the
    // handler then denies actions the role cannot execute.
    name: 'approval.create',
    nsid: NSID.approvalCreate,
    body: { action: 'role.revoke', payload: { subject: TARGET } },
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 403, admin: 200 },
  },
  {
    name: 'approval.list',
    nsid: NSID.approvalList,
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 403, admin: 200 },
  },
  {
    // The guard decides first; an authenticated admin reaches the handler and
    // gets 404 for a request that does not exist.
    name: 'approval.approve',
    nsid: NSID.approvalApprove,
    body: { id: 'missing-approval' },
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 403, admin: 404 },
  },
  {
    name: 'approval.reject',
    nsid: NSID.approvalReject,
    body: { id: 'missing-approval' },
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 403, admin: 404 },
  },
  {
    name: 'approval.cancel',
    nsid: NSID.approvalCancel,
    body: { id: 'missing-approval' },
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 403, admin: 404 },
  },
  {
    name: 'dashboard.series',
    nsid: NSID.dashboardSeries,
    statuses: { anon: 401, viewer: 200, operator: 200, moderator: 200, admin: 200 },
  },
  {
    // Sole admin at this point, so the guarded reset runs without an approval.
    name: 'settings.reset',
    nsid: NSID.settingsReset,
    body: {},
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 403, admin: 200 },
  },
  {
    name: 'content.search',
    nsid: NSID.contentSearch,
    params: { q: '社区' },
    statuses: { anon: 401, viewer: 200, operator: 200, moderator: 200, admin: 200 },
  },
  {
    name: 'content.get',
    nsid: NSID.contentGet,
    params: { uri: POST_URI },
    statuses: { anon: 401, viewer: 200, operator: 200, moderator: 200, admin: 200 },
  },
  {
    // The image service is not configured in the test environment.
    name: 'content.imageSearch',
    nsid: NSID.contentImageSearch,
    params: { q: '社区' },
    statuses: { anon: 401, viewer: 503, operator: 503, moderator: 503, admin: 503 },
  },
  {
    name: 'moderation.report.list',
    nsid: NSID.reportList,
    statuses: { anon: 401, viewer: 200, operator: 200, moderator: 200, admin: 200 },
  },
  {
    name: 'moderation.report.get',
    nsid: NSID.reportGet,
    params: { id: '1' },
    statuses: { anon: 401, viewer: 200, operator: 200, moderator: 200, admin: 200 },
  },
  {
    name: 'moderation.report.act',
    nsid: NSID.reportAct,
    body: { reportId: 1, action: 'close', scope: 'current', comment: '已结案' },
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 200, admin: 200 },
  },
  {
    name: 'moderation.queue.list',
    nsid: NSID.queueList,
    statuses: { anon: 401, viewer: 200, operator: 200, moderator: 200, admin: 200 },
  },
  {
    name: 'moderation.queue.act',
    nsid: NSID.queueAct,
    body: { action: 'create', name: '举报处理队列' },
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 403, admin: 200 },
  },
  {
    name: 'moderation.event.list',
    nsid: NSID.eventList,
    statuses: { anon: 401, viewer: 200, operator: 200, moderator: 200, admin: 200 },
  },
  {
    name: 'moderation.event.get',
    nsid: NSID.eventGet,
    params: { id: '1' },
    statuses: { anon: 401, viewer: 200, operator: 200, moderator: 200, admin: 200 },
  },
  {
    name: 'moderation.events.batch.get',
    nsid: NSID.eventBatchGet,
    params: { batchId: 'e2e-batch' },
    statuses: { anon: 401, viewer: 200, operator: 200, moderator: 200, admin: 200 },
  },
  {
    name: 'moderation.status.query',
    nsid: NSID.statusQuery,
    params: { reviewState: 'open' },
    statuses: { anon: 401, viewer: 200, operator: 200, moderator: 200, admin: 200 },
  },
  {
    name: 'moderation.act',
    nsid: NSID.moderationAct,
    body: { subjects: [ACCOUNT_DID], action: 'comment', comment: '已核查' },
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 200, admin: 200 },
  },
  {
    name: 'moderation.scheduled.list',
    nsid: NSID.scheduledList,
    body: {},
    statuses: { anon: 401, viewer: 200, operator: 200, moderator: 200, admin: 200 },
  },
  {
    name: 'moderation.scheduled.cancel',
    nsid: NSID.scheduledCancel,
    body: { subjects: [ACCOUNT_DID], comment: '调整计划' },
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 200, admin: 200 },
  },
  {
    name: 'moderation.account.overview',
    nsid: NSID.accountOverview,
    params: { did: ACCOUNT_DID },
    statuses: { anon: 401, viewer: 200, operator: 200, moderator: 200, admin: 200 },
  },
  {
    name: 'moderation.random',
    nsid: NSID.randomReview,
    statuses: { anon: 401, viewer: 200, operator: 200, moderator: 200, admin: 200 },
  },
  {
    name: 'moderation.analytics',
    nsid: NSID.moderationAnalytics,
    statuses: { anon: 401, viewer: 200, operator: 200, moderator: 200, admin: 200 },
  },
  {
    name: 'chat.metadata',
    nsid: NSID.chatMetadata,
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 200, admin: 200 },
  },
  {
    name: 'verification.list',
    nsid: NSID.verificationList,
    statuses: { anon: 401, viewer: 200, operator: 403, moderator: 200, admin: 200 },
  },
  {
    // The sole administrator at this point, so the grant executes directly.
    name: 'verification.act',
    nsid: NSID.verificationAct,
    body: {
      action: 'grant',
      verifications: [
        { subject: TARGET, handle: 'target.e2e.test', displayName: '目标账号' },
      ],
    },
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 200, admin: 200 },
  },
  {
    name: 'notifications.template.list',
    nsid: NSID.templateList,
    statuses: { anon: 401, viewer: 403, operator: 200, moderator: 200, admin: 200 },
  },
  {
    name: 'notifications.template.act',
    nsid: NSID.templateAct,
    body: {
      action: 'create',
      name: '账号通知',
      subject: '账号通知',
      contentMarkdown: '您收到一条通知。',
    },
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 200, admin: 200 },
  },
  {
    name: 'notifications.send',
    nsid: NSID.notificationSend,
    body: {
      recipients: [ACCOUNT_DID],
      subject: '账号通知',
      contentMarkdown: '您收到一条通知。',
    },
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 200, admin: 200 },
  },
  {
    name: 'policy.option.list',
    nsid: NSID.optionList,
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 200, admin: 200 },
  },
  {
    name: 'policy.option.act',
    nsid: NSID.optionAct,
    body: {
      operation: 'option.upsert',
      input: {
        key: 'tools.ozone.setting.test',
        scope: 'instance',
        value: { enabled: true },
      },
    },
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 403, admin: 200 },
  },
  {
    name: 'policy.set.list',
    nsid: NSID.setList,
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 200, admin: 200 },
  },
  {
    name: 'policy.set.get',
    nsid: NSID.setGet,
    params: { name: 'e2e-set' },
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 200, admin: 200 },
  },
  {
    name: 'policy.set.act',
    nsid: NSID.setAct,
    body: {
      operation: 'set.upsert',
      input: { name: 'e2e-set', description: '测试集合' },
    },
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 403, admin: 200 },
  },
  {
    name: 'policy.safelink.list',
    nsid: NSID.safelinkList,
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 200, admin: 200 },
  },
  {
    name: 'policy.safelink.events',
    nsid: NSID.safelinkEvents,
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 200, admin: 200 },
  },
  {
    name: 'policy.safelink.act',
    nsid: NSID.safelinkAct,
    body: {
      operation: 'safelink.add',
      input: { url: 'spam.example', pattern: 'domain', action: 'block', reason: 'spam' },
    },
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 403, admin: 200 },
  },
  {
    name: 'policy.labeler.get',
    nsid: NSID.labelerGet,
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 200, admin: 200 },
  },
  {
    name: 'account.admin.info',
    nsid: NSID.accountAdminInfo,
    params: { did: ACCOUNT_DID },
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 403, admin: 200 },
  },
  {
    // The sole administrator at this point, so the update executes directly.
    name: 'account.admin.update',
    nsid: NSID.accountAdminUpdate,
    body: { did: ACCOUNT_DID, handle: 'renamed.e2e.test' },
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 403, admin: 200 },
  },
  {
    name: 'account.admin.delete',
    nsid: NSID.accountAdminDelete,
    body: { did: ACCOUNT_DID },
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 403, admin: 200 },
  },
  {
    name: 'account.invites.disable',
    nsid: NSID.accountInvitesDisable,
    body: { codes: ['invite-one'] },
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 403, admin: 200 },
  },
  {
    name: 'content.export',
    nsid: NSID.contentExport,
    params: { q: '社区' },
    statuses: { anon: 401, viewer: 200, operator: 200, moderator: 200, admin: 200 },
  },
  {
    name: 'analytics.export',
    nsid: NSID.analyticsExport,
    statuses: { anon: 401, viewer: 200, operator: 200, moderator: 200, admin: 200 },
  },
  {
    name: 'announcement.list',
    nsid: NSID.announcementList,
    statuses: { anon: 401, viewer: 403, operator: 200, moderator: 200, admin: 200 },
  },
  {
    name: 'announcement.get',
    nsid: NSID.announcementGet,
    params: { id: '1' },
    statuses: { anon: 401, viewer: 403, operator: 404, moderator: 404, admin: 404 },
  },
  {
    name: 'announcement.create',
    nsid: NSID.announcementCreate,
    body: {
      title: '系统维护通知',
      body: '今晚 22:00 起进行维护，预计 30 分钟。',
      level: 'warning',
      placement: 'admin',
    },
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 403, admin: 200 },
  },
  {
    name: 'announcement.update',
    nsid: NSID.announcementUpdate,
    body: {
      id: 1,
      title: '系统维护通知',
      body: '今晚 23:00 起进行维护，预计 30 分钟。',
      level: 'warning',
      placement: 'admin',
    },
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 403, admin: 200 },
  },
  {
    // The sole administrator at this point, so publish executes directly.
    name: 'announcement.publish',
    nsid: NSID.announcementPublish,
    body: { id: 1 },
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 403, admin: 200 },
  },
  {
    name: 'announcement.archive',
    nsid: NSID.announcementArchive,
    body: { id: 1 },
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 403, admin: 200 },
  },
  {
    name: 'announcement.public',
    nsid: NSID.announcementPublic,
    statuses: { anon: 200, viewer: 200, operator: 200, moderator: 200, admin: 200 },
  },
  {
    name: 'settings.approvals.get',
    nsid: NSID.settingsApprovalsGet,
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 403, admin: 200 },
  },
  {
    name: 'settings.approvals.update',
    nsid: NSID.settingsApprovalsUpdate,
    body: { additionalActions: [] },
    statuses: { anon: 401, viewer: 403, operator: 403, moderator: 403, admin: 200 },
  },
  ...browseEntries,
]

const deniedNsids = [
  NSID.roleList,
  NSID.roleGet,
  NSID.roleCreate,
  NSID.roleUpdate,
  NSID.roleRevoke,
  NSID.auditList,
  NSID.accountProfileUpdate,
  NSID.securityAccessList,
  NSID.securityBlockedList,
  NSID.securityBlock,
  NSID.securityUnblock,
  NSID.approvalCreate,
  NSID.approvalList,
  NSID.approvalApprove,
  NSID.approvalReject,
  NSID.approvalCancel,
  NSID.settingsReset,
  NSID.verificationAct,
  NSID.templateAct,
  NSID.notificationSend,
  NSID.optionList,
  NSID.optionAct,
  NSID.setList,
  NSID.setGet,
  NSID.setAct,
  NSID.safelinkList,
  NSID.safelinkEvents,
  NSID.safelinkAct,
  NSID.labelerGet,
  NSID.accountAdminInfo,
  NSID.accountAdminUpdate,
  NSID.accountAdminDelete,
  NSID.accountInvitesDisable,
  NSID.announcementCreate,
  NSID.announcementUpdate,
  NSID.announcementPublish,
  NSID.announcementArchive,
  NSID.settingsApprovalsGet,
  NSID.settingsApprovalsUpdate,
]

describeDb('http permission matrix', () => {
  let config: Config
  let db: ReturnType<typeof createDb>
  let baseUrl: string
  let server: ReturnType<typeof createAppServer>
  let pds: FakeUpstream
  let store: KyselyDirectoryStore
  let indexer: DirectoryIndexer

  beforeAll(async () => {
    const url = dbUrl ?? ''
    config = loadConfig({
      ADMIN_API_DATABASE_URL: url,
      ADMIN_API_SERVICE_DID: 'did:web:localhost%3A2587',
      ADMIN_API_BOOTSTRAP_ADMIN_DID: ADMIN_DID,
      ADMIN_API_INDEXER_ENABLED: 'false',
      ADMIN_API_PDS_ADMIN_PASSWORD: 'e2e-pds-admin-password',
    })
    db = createDb(url, { maxConnections: 2, connectionTimeoutMs: 5000 })
    await sql`drop schema if exists admin cascade`.execute(db)
    await migrateToLatest(db)
    await bootstrapAdmin(db, config, silentLogger)
    await db
      .insertInto('admin.admin_role')
      .values([
        { did: VIEWER, role: 'viewer', granted_by: ADMIN_DID, note: null },
        { did: OPERATOR, role: 'operator', granted_by: ADMIN_DID, note: null },
        { did: MODERATOR, role: 'moderator', granted_by: ADMIN_DID, note: null },
      ])
      .execute()
    await db
      .insertInto('admin.account_directory')
      .values({
        did: ACCOUNT_DID,
        handle: 'e2e.test',
        status: 'active',
        active: true,
        last_event_at: new Date(),
      })
      .execute()

    store = new KyselyDirectoryStore(db)
    indexer = new DirectoryIndexer({
      store,
      pds: unusedPds,
      source: unusedSource,
      logger: silentLogger,
      config: config.indexer,
    })
    const verifier = makeVerifier(config.serviceDid)

    pds = createFakePds()
    server = createAppServer({
      config,
      logger: silentLogger,
      db,
      store,
      indexer,
      verifier,
      didResolver: {
        async resolve() {
          throw new Error('unresolvable in e2e tests')
        },
      } as never,
      ozone: createFakeOzone(),
      appview: createFakeAppview(),
      pds,
      senderDid: config.serviceDid,
      startedAt: Date.now(),
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await closeServer(server)
    await closeDb(db)
  })

  async function callAt(
    target: string,
    nsid: string,
    actor: Actor,
    init: { params?: QueryParams; body?: Record<string, unknown> } = {},
  ) {
    const url = new URL(`/xrpc/${nsid}`, target)
    for (const [key, value] of Object.entries(init.params ?? {})) {
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, item)
      } else {
        url.searchParams.set(key, value)
      }
    }
    const headers: Record<string, string> = {}
    if (actor !== 'anon') headers.authorization = `Bearer ${tokens[actor]}`
    if (init.body !== undefined) headers['content-type'] = 'application/json'
    const response = await fetch(url, {
      method: init.body !== undefined ? 'POST' : 'GET',
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    })
    const text = await response.text()
    let body: unknown = text
    try {
      body = JSON.parse(text)
    } catch {
      // keep the raw text for the assertion message
    }
    return { status: response.status, body }
  }

  async function call(
    nsid: string,
    actor: Actor,
    init: { params?: QueryParams; body?: Record<string, unknown> } = {},
  ) {
    return callAt(baseUrl, nsid, actor, init)
  }

  async function countAudit(actor: string, action: string, result: AuditResult) {
    const row = await db
      .selectFrom('admin.admin_audit_event')
      .select(sql<number>`count(*)::int`.as('count'))
      .where('actor_did', '=', actor)
      .where('action', '=', action)
      .where('result', '=', result)
      .executeTakeFirstOrThrow()
    return row.count
  }

  it('answers anonymous calls with 401 and role-gated calls per role', async () => {
    for (const entry of matrix) {
      for (const actor of ['anon', 'viewer', 'operator', 'moderator', 'admin'] as const) {
        const result = await call(entry.nsid, actor, { params: entry.params, body: entry.body })
        expect(
          result.status,
          `${entry.name} as ${actor}: ${JSON.stringify(result.body)}`,
        ).toBe(entry.statuses[actor])
      }
    }
  })

  it('rejects browse methods for authenticated accounts without a role', async () => {
    for (const entry of browseEntries) {
      const result = await call(entry.nsid, 'norole', { params: entry.params })
      expect(result.status, `${entry.name}: ${JSON.stringify(result.body)}`).toBe(403)
    }
  })

  it('returns normalized payloads for browse methods', async () => {
    const graph = await call(NSID.accountGraph, 'viewer', {
      params: { did: ACCOUNT_DID, kind: 'follows' },
    })
    expect(graph.status, JSON.stringify(graph.body)).toBe(200)
    expect(graph.body).toMatchObject({
      accounts: [{ did: 'did:plc:e2efollow', handle: 'follow.e2e.test' }],
    })

    const posts = await call(NSID.accountPosts, 'viewer', {
      params: { did: ACCOUNT_DID, limit: '10' },
    })
    expect(posts.status, JSON.stringify(posts.body)).toBe(200)
    expect(posts.body).toMatchObject({
      posts: [{ uri: POST_URI, text: '账号帖子内容', visibility: 'available' }],
    })

    const search = await call(NSID.signatureSearch, 'viewer', {
      params: { values: ['foo'] },
    })
    expect(search.status, JSON.stringify(search.body)).toBe(200)
    expect(search.body).toMatchObject({
      accounts: [
        {
          did: ACCOUNT_DID,
          handle: 'account.e2e.test',
          threatSignatures: [{ property: 'foo', value: 'bar' }],
        },
      ],
    })

    const related = await call(NSID.signatureRelated, 'viewer', {
      params: { did: ACCOUNT_DID },
    })
    expect(related.status, JSON.stringify(related.body)).toBe(200)
    expect(related.body).toMatchObject({
      accounts: [
        {
          account: { did: ACCOUNT_DID },
          similarities: [{ property: 'foo', value: 'bar' }],
        },
      ],
    })

    const correlation = await call(NSID.signatureCorrelation, 'viewer', {
      params: { dids: ['did:plc:e2eone', 'did:plc:e2etwo'] },
    })
    expect(correlation.status, JSON.stringify(correlation.body)).toBe(200)
    expect(correlation.body).toEqual({
      details: [{ property: 'foo', value: 'bar' }],
    })

    const notifications = await call(NSID.inboxList, 'viewer', {
      params: { did: ACCOUNT_DID },
    })
    expect(notifications.status, JSON.stringify(notifications.body)).toBe(200)
    expect(notifications.body).toMatchObject({
      notifications: [
        {
          id: 1,
          reason: 'reportResolved',
          section: 'reports',
          isRead: false,
          target: { type: 'report', reportId: 9 },
        },
      ],
    })

    const unread = await call(NSID.inboxUnread, 'viewer', {
      params: { did: ACCOUNT_DID },
    })
    expect(unread.status, JSON.stringify(unread.body)).toBe(200)
    expect(unread.body).toEqual({
      unreadCounts: { total: 3, reports: 2, subjects: 1, accountStatus: 0 },
    })

    const preferences = await call(NSID.inboxPreferences, 'viewer', {
      params: { did: ACCOUNT_DID },
    })
    expect(preferences.status, JSON.stringify(preferences.body)).toBe(200)
    expect(preferences.body).toEqual({
      preferences: { reports: true, account: true, labels: false },
    })
  })

  it('does not register inbox write methods', async () => {
    for (const nsid of [
      'com.selfcommand.admin.inbox.updateSeen',
      'com.selfcommand.admin.inbox.updateNotificationPreferences',
      'com.selfcommand.admin.inbox.submitAppeal',
    ]) {
      const result = await call(nsid, 'moderator', { body: { did: ACCOUNT_DID } })
      expect(result.status, `${nsid}: ${JSON.stringify(result.body)}`).toBe(501)
      expect((result.body as { error?: string }).error).toBe('MethodNotImplemented')
    }
  })

  it('maps upstream failures for browse methods', async () => {
    const failing = createFakeUpstream(
      () => {
        throw new Error('upstream unavailable')
      },
      { name: 'failing-upstream' },
    )
    const failingServer = createAppServer({
      config,
      logger: silentLogger,
      db,
      store,
      indexer,
      verifier: makeVerifier(config.serviceDid),
      didResolver: {
        async resolve() {
          throw new Error('unresolvable in e2e tests')
        },
      } as never,
      ozone: failing,
      appview: failing,
      pds,
      senderDid: config.serviceDid,
      startedAt: Date.now(),
    })
    await new Promise<void>((resolve) => failingServer.listen(0, '127.0.0.1', resolve))
    const target = `http://127.0.0.1:${(failingServer.address() as AddressInfo).port}`
    try {
      for (const entry of browseEntries) {
        const result = await callAt(target, entry.nsid, 'moderator', {
          params: entry.params,
        })
        expect(result.status, `${entry.name}: ${JSON.stringify(result.body)}`).toBe(502)
        expect((result.body as { error?: string }).error).toBe('UpstreamUnavailable')
      }
    } finally {
      await closeServer(failingServer)
    }
  })

  it('assigns reports without treating an omitted closure scope as invalid', async () => {
    const assigned = await call(NSID.reportAct, 'admin', {
      body: { reportId: 1, action: 'assign', did: MODERATOR },
    })
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(200)

    const rejected = await call(NSID.reportAct, 'admin', {
      body: { reportId: 1, action: 'assign', scope: 'all' },
    })
    expect(rejected.status).toBe(400)
  })

  it('returns the caller identity without requiring a role', async () => {
    const response = await call(NSID.session, 'norole')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ did: NOROLE, permissions: [] })

    const admin = await call(NSID.session, 'admin')
    expect(admin.status).toBe(200)
    expect(admin.body).toMatchObject({
      did: ADMIN_DID,
      role: 'admin',
      permissions: [
        'directory.read',
        'content.read',
        'content.write',
        'moderation.read',
        'moderation.write',
        'moderation.queue.manage',
        'verification.read',
        'verification.write',
        'notification.read',
        'notification.write',
        'policy.read',
        'policy.write',
        'account.write',
        'account.admin',
        'analytics.read',
        'role.read',
        'role.write',
        'audit.read',
        'settings.read',
        'settings.write',
        'security.read',
        'security.write',
        'chat.read',
        'announcement.read',
        'announcement.write',
        'announcement.publish',
      ],
    })

    const moderator = await call(NSID.session, 'moderator')
    expect(moderator.status).toBe(200)
    expect(moderator.body).toMatchObject({
      did: MODERATOR,
      role: 'moderator',
      permissions: [
        'directory.read',
        'content.read',
        'content.write',
        'moderation.read',
        'moderation.write',
        'verification.read',
        'verification.write',
        'notification.read',
        'notification.write',
        'policy.read',
        'account.write',
        'analytics.read',
        'chat.read',
        'announcement.read',
      ],
    })
  })

  it('records one denied audit row per authenticated rejection', async () => {
    for (const nsid of deniedNsids) {
      for (const actor of [VIEWER, OPERATOR]) {
        expect(await countAudit(actor, nsid, 'denied'), `${actor} ${nsid}`).toBe(1)
      }
    }
  })

  it('records denied audit rows when a moderator attempts restricted actions', async () => {
    for (const nsid of [
      NSID.queueAct,
      NSID.approvalCreate,
      NSID.approvalApprove,
      NSID.announcementCreate,
      NSID.announcementPublish,
      NSID.settingsApprovalsGet,
      NSID.settingsApprovalsUpdate,
    ]) {
      expect(await countAudit(MODERATOR, nsid, 'denied'), nsid).toBe(1)
    }
  })

  it('records success audit rows for admin mutations', async () => {
    for (const nsid of [NSID.roleCreate, NSID.roleUpdate, NSID.roleRevoke]) {
      expect(await countAudit(ADMIN_DID, nsid, 'success'), nsid).toBe(1)
    }
  })

  it('protects the last admin on update and revoke', async () => {
    const downgrade = await call(NSID.roleUpdate, 'admin', {
      body: { subject: ADMIN_DID, role: 'viewer' },
    })
    expect(downgrade.status).toBe(409)
    expect(downgrade.body).toMatchObject({ error: 'LastAdmin' })

    const selfRevoke = await call(NSID.roleRevoke, 'admin', {
      body: { subject: ADMIN_DID },
    })
    expect(selfRevoke.status).toBe(409)
    expect(selfRevoke.body).toMatchObject({ error: 'LastAdmin' })

    expect(await countAudit(ADMIN_DID, NSID.roleUpdate, 'error')).toBe(1)
    expect(await countAudit(ADMIN_DID, NSID.roleRevoke, 'error')).toBe(1)
  })

  it('applies role changes to the next request with the same token', async () => {
    const deniedBefore = await countAudit(OPERATOR, NSID.auditList, 'denied')

    const promote = await call(NSID.roleUpdate, 'admin', {
      body: { subject: OPERATOR, role: 'admin' },
    })
    expect(promote.status).toBe(200)

    const allowed = await call(NSID.auditList, 'operator')
    expect(allowed.status).toBe(200)

    // Demoting an administrator needs an approval from another administrator;
    // that flow is covered below, so the fixture is reset directly here.
    await db.deleteFrom('admin.admin_role').where('did', '=', OPERATOR).execute()

    const denied = await call(NSID.auditList, 'operator')
    expect(denied.status).toBe(403)
    expect(await countAudit(OPERATOR, NSID.auditList, 'denied')).toBe(deniedBefore + 1)
  })

  it('requires a second administrator to approve a high-risk action', async () => {
    const created = await call(NSID.roleCreate, 'admin', {
      body: { subject: SECOND_ADMIN, role: 'admin' },
    })
    expect(created.status).toBe(200)

    const direct = await call(NSID.roleRevoke, 'admin', {
      body: { subject: SECOND_ADMIN },
    })
    expect(direct.status).toBe(409)
    expect(direct.body).toMatchObject({ error: 'ApprovalRequired' })

    const requested = await call(NSID.approvalCreate, 'admin', {
      body: { action: 'role.revoke', payload: { subject: SECOND_ADMIN } },
    })
    expect(requested.status).toBe(200)
    const first = (
      requested.body as {
        approval: { id: string; status: string; requestedBy: string }
      }
    ).approval
    expect(first).toMatchObject({ status: 'pending', requestedBy: ADMIN_DID })

    const selfApprove = await call(NSID.approvalApprove, 'admin', {
      body: { id: first.id },
    })
    expect(selfApprove.status).toBe(403)
    expect(selfApprove.body).toMatchObject({ error: 'Forbidden' })

    const selfReject = await call(NSID.approvalReject, 'admin', {
      body: { id: first.id },
    })
    expect(selfReject.status).toBe(403)

    const rejected = await call(NSID.approvalReject, 'admin2', {
      body: { id: first.id, reason: 'e2e 复核' },
    })
    expect(rejected.status).toBe(200)
    expect(
      (rejected.body as { approval: { status: string; decidedBy: string } })
        .approval,
    ).toMatchObject({ status: 'rejected', decidedBy: SECOND_ADMIN })

    const second = await call(NSID.approvalCreate, 'admin', {
      body: { action: 'role.revoke', payload: { subject: SECOND_ADMIN } },
    })
    expect(second.status).toBe(200)
    const approvedId = (second.body as { approval: { id: string } }).approval.id

    const approved = await call(NSID.approvalApprove, 'admin2', {
      body: { id: approvedId },
    })
    expect(approved.status).toBe(200)
    expect(
      (approved.body as { approval: { status: string; decidedBy: string } })
        .approval,
    ).toMatchObject({ status: 'executed', decidedBy: SECOND_ADMIN })

    const removed = await call(NSID.roleGet, 'admin', {
      params: { subject: SECOND_ADMIN },
    })
    expect(removed.status).toBe(404)

    const third = await call(NSID.approvalCreate, 'admin', {
      body: { action: 'role.revoke', payload: { subject: SECOND_ADMIN } },
    })
    expect(third.status).toBe(200)
    const cancelledId = (third.body as { approval: { id: string } }).approval.id
    const cancelled = await call(NSID.approvalCancel, 'admin', {
      body: { id: cancelledId },
    })
    expect(cancelled.status).toBe(200)
    expect(
      (cancelled.body as { approval: { status: string } }).approval.status,
    ).toBe('cancelled')

    const restored = await call(NSID.roleCreate, 'admin', {
      body: { subject: SECOND_ADMIN, role: 'admin' },
    })
    expect(restored.status).toBe(200)

    const again = await call(NSID.approvalApprove, 'admin2', {
      body: { id: approvedId },
    })
    expect(again.status).toBe(409)
    expect(again.body).toMatchObject({ error: 'ApprovalState' })

    const stillAdmin = await call(NSID.roleGet, 'admin', {
      params: { subject: SECOND_ADMIN },
    })
    expect(stillAdmin.status).toBe(200)

    const executed = await call(NSID.approvalList, 'admin', {
      params: { status: 'executed' },
    })
    expect(executed.status).toBe(200)
    const rows = (
      executed.body as { approvals: { id: string; status: string }[] }
    ).approvals
    expect(
      rows.some((row) => row.id === approvedId && row.status === 'executed'),
    ).toBe(true)
  })

  it('returns v3 content and moderation reads with formal empty states', async () => {
    const missingQuery = await call(NSID.contentSearch, 'viewer')
    expect(missingQuery.status).toBe(400)
    expect(missingQuery.body).toMatchObject({ error: 'InvalidRequest' })

    const search = await call(NSID.contentSearch, 'viewer', {
      params: { q: '社区' },
    })
    expect(search.status).toBe(200)
    expect(search.body).toEqual({ content: [], moderationAvailable: true })

    const detail = await call(NSID.contentGet, 'viewer', {
      params: { uri: POST_URI },
    })
    expect(detail.status).toBe(200)
    expect(
      (detail.body as { record: { uri: string; author: string } }).record,
    ).toMatchObject({ uri: POST_URI, author: 'did:plc:e2eauthor' })

    const report = await call(NSID.reportGet, 'viewer', { params: { id: '1' } })
    expect(report.status).toBe(200)
    expect((report.body as { report: { id: number } }).report.id).toBe(1)

    const event = await call(NSID.eventGet, 'viewer', { params: { id: '1' } })
    expect(event.status).toBe(200)
    expect((event.body as { event: { id: number } }).event.id).toBe(1)

    const overview = await call(NSID.accountOverview, 'viewer', {
      params: { did: ACCOUNT_DID },
    })
    expect(overview.status).toBe(200)
    expect(
      (overview.body as { overview: { did: string } }).overview.did,
    ).toBe(ACCOUNT_DID)

    const random = await call(NSID.randomReview, 'viewer')
    expect(random.status).toBe(200)
    expect((random.body as { overview: { did: string } }).overview.did).toBe(
      ACCOUNT_DID,
    )

    const analytics = await call(NSID.moderationAnalytics, 'viewer')
    expect(analytics.status).toBe(200)
    expect(analytics.body).toMatchObject({
      summary: { pendingCount: 0, closedCount: 0 },
      days: [],
    })

    const unconfiguredImages = await call(NSID.contentImageSearch, 'viewer', {
      params: { q: '社区' },
    })
    expect(unconfiguredImages.status).toBe(503)
    expect(unconfiguredImages.body).toMatchObject({ error: 'NotConfigured' })

    const chat = await call(NSID.chatMetadata, 'moderator')
    expect(chat.status).toBe(200)
    expect(chat.body).toEqual({
      enabled: false,
      reason: '当前部署未接入聊天服务，聊天审核暂不可用。',
    })
  })

  it('routes high-risk moderation actions through a second approver', async () => {
    const direct = await call(NSID.moderationAct, 'moderator', {
      body: { subjects: [TARGET], action: 'takedown', comment: '违规内容' },
    })
    expect(direct.status).toBe(409)
    expect(direct.body).toMatchObject({ error: 'ApprovalRequired' })

    const requested = await call(NSID.approvalCreate, 'moderator', {
      body: {
        action: 'moderation.takedown',
        payload: {
          subjects: [TARGET],
          action: 'takedown',
          comment: '违规内容',
        },
      },
    })
    expect(requested.status).toBe(200)
    const approval = (
      requested.body as {
        approval: { id: string; status: string; requestedBy: string }
      }
    ).approval
    expect(approval).toMatchObject({ status: 'pending', requestedBy: MODERATOR })

    const selfApprove = await call(NSID.approvalApprove, 'moderator', {
      body: { id: approval.id },
    })
    expect(selfApprove.status).toBe(403)

    const executed = await call(NSID.approvalApprove, 'admin2', {
      body: { id: approval.id },
    })
    expect(executed.status).toBe(200)
    expect(
      (executed.body as { approval: { status: string } }).approval.status,
    ).toBe('executed')

    const again = await call(NSID.approvalApprove, 'admin2', {
      body: { id: approval.id },
    })
    expect(again.status).toBe(409)
    expect(again.body).toMatchObject({ error: 'ApprovalState' })

    const reused = await call(NSID.moderationAct, 'admin', {
      body: {
        subjects: [TARGET],
        action: 'takedown',
        comment: '违规内容',
        approvalId: approval.id,
      },
    })
    expect(reused.status).toBe(409)

    const unnecessary = await call(NSID.moderationAct, 'moderator', {
      body: {
        subjects: [TARGET],
        action: 'comment',
        comment: '补充备注',
        approvalId: 'a'.repeat(32),
      },
    })
    expect(unnecessary.status).toBe(400)
    expect(unnecessary.body).toMatchObject({ error: 'InvalidRequest' })

    const twoSubjects = await call(NSID.approvalCreate, 'moderator', {
      body: {
        action: 'moderation.takedown',
        payload: {
          subjects: [TARGET, ACCOUNT_DID],
          action: 'takedown',
        },
      },
    })
    expect(twoSubjects.status).toBe(400)

    const forbiddenAction = await call(NSID.approvalCreate, 'moderator', {
      body: {
        action: 'policy.write',
        payload: { operation: 'option.upsert', input: {} },
      },
    })
    expect(forbiddenAction.status).toBe(403)

    const unknownAction = await call(NSID.approvalCreate, 'admin', {
      body: { action: 'moderation.unknown', payload: {} },
    })
    expect(unknownAction.status).toBe(400)
  })

  it('returns v4 verification, notification and policy reads', async () => {
    const verifications = await call(NSID.verificationList, 'viewer', {
      params: { subject: TARGET },
    })
    expect(verifications.status).toBe(200)
    expect(
      (
        verifications.body as {
          verifications: { subject: string; isActive: boolean }[]
        }
      ).verifications[0],
    ).toMatchObject({ subject: TARGET, isActive: true })

    const badSubject = await call(NSID.verificationList, 'viewer', {
      params: { subject: 'target.e2e.test' },
    })
    expect(badSubject.status).toBe(400)
    expect(badSubject.body).toMatchObject({ error: 'InvalidRequest' })

    const templates = await call(NSID.templateList, 'moderator')
    expect(templates.status).toBe(200)
    expect(templates.body).toMatchObject({
      sendAvailable: true,
      templates: [{ id: '1', name: '账号通知' }],
    })

    const options = await call(NSID.optionList, 'moderator')
    expect(options.status).toBe(200)
    expect(options.body).toEqual({ options: [] })

    const sets = await call(NSID.setList, 'moderator')
    expect(sets.status).toBe(200)
    expect(sets.body).toEqual({ sets: [] })

    const set = await call(NSID.setGet, 'moderator', { params: { name: 'e2e-set' } })
    expect(set.status).toBe(200)
    expect(set.body).toMatchObject({
      set: { name: 'e2e-set', valuesCount: 0 },
      values: [],
    })

    const rules = await call(NSID.safelinkList, 'moderator')
    expect(rules.status).toBe(200)
    expect(rules.body).toEqual({ rules: [] })

    const events = await call(NSID.safelinkEvents, 'moderator')
    expect(events.status).toBe(200)
    expect(events.body).toEqual({ events: [] })

    const labeler = await call(NSID.labelerGet, 'moderator')
    expect(labeler.status).toBe(200)
    expect(labeler.body).toMatchObject({
      labeler: {
        available: true,
        did: 'did:web:ozone.e2e.test',
        displayName: '社区审核服务',
      },
    })
  })

  it('routes v4 verification, notification and policy writes through approval', async () => {
    const grant = {
      verifications: [
        { subject: TARGET, handle: 'target.e2e.test', displayName: '目标账号' },
      ],
    }
    const direct = await call(NSID.verificationAct, 'moderator', {
      body: { action: 'grant', ...grant },
    })
    expect(direct.status).toBe(409)
    expect(direct.body).toMatchObject({ error: 'ApprovalRequired' })

    const requested = await call(NSID.approvalCreate, 'moderator', {
      body: { action: 'verification.grant', payload: grant },
    })
    expect(requested.status).toBe(200)
    const approval = (requested.body as { approval: { id: string } }).approval
    const executed = await call(NSID.approvalApprove, 'admin2', {
      body: { id: approval.id },
    })
    expect(executed.status).toBe(200)
    expect(
      (executed.body as { approval: { status: string } }).approval.status,
    ).toBe('executed')

    const reused = await call(NSID.verificationAct, 'moderator', {
      body: { action: 'grant', ...grant, approvalId: approval.id },
    })
    expect(reused.status).toBe(403)
    expect(reused.body).toMatchObject({ error: 'Forbidden' })

    const sendBody = {
      recipients: [ACCOUNT_DID, TARGET],
      subject: '账号通知',
      contentMarkdown: '您收到一条通知。',
    }
    const directSend = await call(NSID.notificationSend, 'moderator', {
      body: sendBody,
    })
    expect(directSend.status).toBe(409)
    const sendRequest = await call(NSID.approvalCreate, 'moderator', {
      body: { action: 'notifications.send', payload: sendBody },
    })
    expect(sendRequest.status).toBe(200)
    const sendApproval = (
      sendRequest.body as { approval: { id: string } }
    ).approval
    const sendExecuted = await call(NSID.approvalApprove, 'admin2', {
      body: { id: sendApproval.id },
    })
    expect(sendExecuted.status).toBe(200)

    const policyPayload = {
      operation: 'option.upsert',
      input: {
        key: 'tools.ozone.setting.test',
        scope: 'instance',
        value: { enabled: true },
      },
    }
    const directPolicy = await call(NSID.optionAct, 'admin', {
      body: policyPayload,
    })
    expect(directPolicy.status).toBe(409)
    expect(directPolicy.body).toMatchObject({ error: 'ApprovalRequired' })
    const policyRequest = await call(NSID.approvalCreate, 'admin', {
      body: { action: 'policy.write', payload: policyPayload },
    })
    expect(policyRequest.status).toBe(200)
    const policyApproval = (
      policyRequest.body as { approval: { id: string } }
    ).approval
    const policyExecuted = await call(NSID.approvalApprove, 'admin2', {
      body: { id: policyApproval.id },
    })
    expect(policyExecuted.status).toBe(200)
  })

  it('reads account administration info and routes v5 account changes through approval', async () => {
    const info = await call(NSID.accountAdminInfo, 'admin', {
      params: { did: ACCOUNT_DID },
    })
    expect(info.status).toBe(200)
    expect(info.body).toMatchObject({
      info: {
        did: ACCOUNT_DID,
        handle: 'account.e2e.test',
        email: 'account@e2e.test',
        invitesDisabled: false,
        invites: [{ code: 'invite-one' }],
      },
    })

    const update = {
      did: ACCOUNT_DID,
      handle: 'renamed.e2e.test',
      password: 'e2e-account-password',
    }
    const direct = await call(NSID.accountAdminUpdate, 'admin', { body: update })
    expect(direct.status).toBe(409)
    expect(direct.body).toMatchObject({ error: 'ApprovalRequired' })

    const requested = await call(NSID.approvalCreate, 'admin', {
      body: { action: 'account.admin.update', payload: update },
    })
    expect(requested.status).toBe(200)
    const approval = (requested.body as { approval: { id: string } }).approval
    const stored = await db
      .selectFrom('admin.admin_approval')
      .select('payload')
      .where('id', '=', approval.id)
      .executeTakeFirstOrThrow()
    expect((stored.payload as Record<string, unknown>).passwordSealed).toBeTypeOf('string')
    expect(JSON.stringify(stored.payload)).not.toContain('e2e-account-password')

    const approved = await call(NSID.approvalApprove, 'admin2', {
      body: { id: approval.id },
    })
    expect(approved.status).toBe(200)
    expect(
      pds.calls
        .filter((entry) => entry.nsid === 'com.atproto.admin.updateAccountPassword')
        .at(-1)?.options?.body,
    ).toEqual({ did: ACCOUNT_DID, password: 'e2e-account-password' })
    const executed = await db
      .selectFrom('admin.admin_approval')
      .select('payload')
      .where('id', '=', approval.id)
      .executeTakeFirstOrThrow()
    expect((executed.payload as Record<string, unknown>).passwordSealed).toBeUndefined()

    const deleteRequest = await call(NSID.approvalCreate, 'admin', {
      body: { action: 'account.admin.delete', payload: { did: ACCOUNT_DID } },
    })
    expect(deleteRequest.status).toBe(200)
    const deleteApproval = (
      deleteRequest.body as { approval: { id: string } }
    ).approval
    const deleted = await call(NSID.approvalApprove, 'admin2', {
      body: { id: deleteApproval.id },
    })
    expect(deleted.status).toBe(200)
    expect(
      pds.calls
        .filter((entry) => entry.nsid === 'com.atproto.admin.deleteAccount')
        .at(-1)?.options?.body,
    ).toEqual({ did: ACCOUNT_DID })

    const invites = await call(NSID.accountInvitesDisable, 'admin', {
      body: { did: ACCOUNT_DID },
    })
    expect(invites.status).toBe(200)
    expect(
      pds.calls
        .slice(-2)
        .map((entry) => [entry.nsid, entry.options?.body]),
    ).toEqual([
      ['com.atproto.admin.disableAccountInvites', { account: ACCOUNT_DID }],
      ['com.atproto.admin.disableInviteCodes', { accounts: [ACCOUNT_DID] }],
    ])
  })

  it('serves published announcements anonymously and hides drafts and expired entries', async () => {
    const created = await call(NSID.announcementCreate, 'admin', {
      body: {
        title: '客户端升级说明',
        body: '请在本周内完成客户端升级。',
        level: 'info',
        placement: 'app',
      },
    })
    expect(created.status, JSON.stringify(created.body)).toBe(200)
    const createdId = (created.body as { announcement: { id: number; status: string } })
      .announcement
    expect(createdId.status).toBe('draft')

    const draftHidden = await call(NSID.announcementPublic, 'anon', {
      params: { placement: 'app' },
    })
    expect(draftHidden.status).toBe(200)
    expect((draftHidden.body as { announcements: unknown[] }).announcements).toEqual([])

    const directPublish = await call(NSID.announcementPublish, 'admin', {
      body: { id: createdId.id },
    })
    expect(directPublish.status).toBe(409)
    expect(directPublish.body).toMatchObject({ error: 'ApprovalRequired' })

    const publishRequest = await call(NSID.approvalCreate, 'admin', {
      body: {
        action: 'announcement.publish',
        payload: { announcementId: createdId.id },
      },
    })
    expect(publishRequest.status, JSON.stringify(publishRequest.body)).toBe(200)
    const publishApproval = (publishRequest.body as { approval: { id: string } })
      .approval
    const published = await call(NSID.approvalApprove, 'admin2', {
      body: { id: publishApproval.id },
    })
    expect(published.status, JSON.stringify(published.body)).toBe(200)
    expect(
      (published.body as { approval: { status: string } }).approval.status,
    ).toBe('executed')

    const response = await fetch(
      `${baseUrl}/xrpc/${NSID.announcementPublic}?placement=app`,
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('public, max-age=60')
    const body = (await response.json()) as { announcements: Record<string, unknown>[] }
    expect(body.announcements).toEqual([
      {
        title: '客户端升级说明',
        body: '请在本周内完成客户端升级。',
        level: 'info',
        placement: 'app',
      },
    ])

    const directArchive = await call(NSID.announcementArchive, 'admin', {
      body: { id: createdId.id },
    })
    expect(directArchive.status).toBe(409)
    expect(directArchive.body).toMatchObject({ error: 'ApprovalRequired' })

    const archiveRequest = await call(NSID.approvalCreate, 'admin', {
      body: {
        action: 'announcement.archive',
        payload: { announcementId: createdId.id },
      },
    })
    expect(archiveRequest.status, JSON.stringify(archiveRequest.body)).toBe(200)
    const archiveApproval = (archiveRequest.body as { approval: { id: string } })
      .approval
    const archived = await call(NSID.approvalApprove, 'admin2', {
      body: { id: archiveApproval.id },
    })
    expect(archived.status, JSON.stringify(archived.body)).toBe(200)
    const afterArchive = await call(NSID.announcementPublic, 'anon', {
      params: { placement: 'app' },
    })
    expect(afterArchive.body).toEqual({ announcements: [] })

    await db
      .insertInto('admin.admin_announcement')
      .values({
        title: '过期公告',
        body: '该公告已过期。',
        level: 'info',
        placement: 'app',
        status: 'published',
        starts_at: new Date(Date.now() - 7_200_000),
        ends_at: new Date(Date.now() - 3_600_000),
        created_by: ADMIN_DID,
        published_by: ADMIN_DID,
      })
      .execute()
    const expired = await call(NSID.announcementPublic, 'anon', {
      params: { placement: 'app' },
    })
    expect((expired.body as { announcements: unknown[] }).announcements).toEqual([])
  })

  it('rate limits public announcement reads per client', async () => {
    let allowed = 0
    let limited: Response | undefined
    for (let index = 0; index < 260; index += 1) {
      const response = await fetch(`${baseUrl}/xrpc/${NSID.announcementPublic}`)
      if (response.status === 429) {
        limited = response
        break
      }
      expect(response.status).toBe(200)
      allowed += 1
    }
    expect(allowed).toBeGreaterThan(0)
    expect(limited, 'public announcement rate limit never triggered').toBeDefined()
    expect(Number(limited?.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(await limited?.json()).toMatchObject({ error: 'RateLimited' })

    const again = await fetch(`${baseUrl}/xrpc/${NSID.announcementPublic}`)
    expect(again.status).toBe(429)
  })

  // Degradation drills from docs/development/pds-ozone-integration-drill.md §7.
  // Each drill starts its own app server against the disposable test database,
  // so a missing or broken upstream never touches the shared fixtures above.
  describe('degradation drills', () => {
    const drillServers: Server[] = []
    const drillStubs: Server[] = []

    afterAll(async () => {
      for (const server of drillServers) await closeServer(server)
      for (const stub of drillStubs) await closeServer(stub)
    })

    async function startStub(
      handler: (request: IncomingMessage, response: ServerResponse) => void,
    ): Promise<string> {
      const stub = createHttpServer(handler)
      drillStubs.push(stub)
      await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve))
      return `http://127.0.0.1:${(stub.address() as AddressInfo).port}`
    }

    async function unusedPort(): Promise<number> {
      const probe = createHttpServer()
      await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
      const port = (probe.address() as AddressInfo).port
      await new Promise<void>((resolve) => probe.close(() => resolve()))
      return port
    }

    async function startDrillServer(
      options: {
        pds?: XrpcClient
        ozone?: XrpcClient
        appview?: XrpcClient
        pdsAdminPassword?: string
      } = {},
    ): Promise<string> {
      const drillConfig = loadConfig({
        ADMIN_API_DATABASE_URL: dbUrl ?? '',
        ADMIN_API_SERVICE_DID: 'did:web:localhost%3A2587',
        ADMIN_API_BOOTSTRAP_ADMIN_DID: ADMIN_DID,
        ADMIN_API_INDEXER_ENABLED: 'false',
        ...(options.pdsAdminPassword
          ? { ADMIN_API_PDS_ADMIN_PASSWORD: options.pdsAdminPassword }
          : {}),
      })
      const store = new KyselyDirectoryStore(db)
      const indexer = new DirectoryIndexer({
        store,
        pds: unusedPds,
        source: unusedSource,
        logger: silentLogger,
        config: drillConfig.indexer,
      })
      const server = createAppServer({
        config: drillConfig,
        logger: silentLogger,
        db,
        store,
        indexer,
        verifier: makeVerifier(drillConfig.serviceDid),
        didResolver: {
          async resolve() {
            throw new Error('unresolvable in e2e tests')
          },
        } as never,
        ozone: options.ozone ?? createFakeOzone(),
        appview: options.appview ?? createFakeAppview(),
        pds: options.pds ?? createFakePds(),
        senderDid: drillConfig.serviceDid,
        startedAt: Date.now(),
      })
      drillServers.push(server)
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    }

    it('F1 answers account administration reads with NotConfigured when the PDS credential is missing', async () => {
      // The URL is never contacted: without a password the client is not configured.
      const pds = createPdsAdminClient(
        {
          pdsUrl: 'http://127.0.0.1:9',
          pdsTimeoutMs: 500,
          pdsMaxBytes: 1024 * 1024,
        },
        silentLogger,
      )
      expect(pds.configured).toBe(false)
      const drill = await startDrillServer({ pds })

      const info = await callAt(drill, NSID.accountAdminInfo, 'admin', {
        params: { did: ACCOUNT_DID },
      })
      expect(info.status).toBe(503)
      expect(info.body).toMatchObject({ error: 'NotConfigured' })
      expect((info.body as { message: string }).message).toContain('管理员凭据')

      // Directory reads keep working: the degradation is scoped to account
      // administration, which is the behaviour the web copy promises.
      const account = await callAt(drill, NSID.accountGet, 'admin', {
        params: { did: ACCOUNT_DID },
      })
      expect(account.status, JSON.stringify(account.body)).toBe(200)
    })

    it('F2 reports rejected PDS credentials as UpstreamAuthFailed and audits the failure', async () => {
      const pdsUrl = await startStub((_request, response) => {
        response.writeHead(401, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: 'AuthRequired', message: 'bad credentials' }))
      })
      const pds = createPdsAdminClient(
        {
          pdsUrl,
          pdsAdminPassword: 'stale-e2e-pds-password',
          pdsTimeoutMs: 2000,
          pdsMaxBytes: 1024 * 1024,
        },
        silentLogger,
      )
      const drill = await startDrillServer({ pds })

      // Account administration only executes directly while one administrator exists.
      await db.deleteFrom('admin.admin_role').where('did', '=', SECOND_ADMIN).execute()
      const before = await countAudit(ADMIN_DID, NSID.accountAdminUpdate, 'error')

      const update = await callAt(drill, NSID.accountAdminUpdate, 'admin', {
        body: { did: ACCOUNT_DID, handle: 'degraded.e2e.test' },
      })
      expect(update.status).toBe(502)
      expect(update.body).toMatchObject({ error: 'UpstreamAuthFailed' })
      expect((update.body as { message: string }).message).toContain('管理员凭据')

      expect(await countAudit(ADMIN_DID, NSID.accountAdminUpdate, 'error')).toBe(before + 1)
      const failure = await db
        .selectFrom('admin.admin_audit_event')
        .select(['detail'])
        .where('actor_did', '=', ADMIN_DID)
        .where('action', '=', NSID.accountAdminUpdate)
        .where('result', '=', 'error')
        .orderBy('created_at', 'desc')
        .executeTakeFirstOrThrow()
      expect(failure.detail).toContain('UpstreamAuthFailed')
    })

    it('F4 reports Ozone as unavailable when the upstream is unreachable', async () => {
      const port = await unusedPort()
      const ozone = createOzoneClient(
        {
          ozoneUrl: `http://127.0.0.1:${port}`,
          ozoneAdminPassword: 'drill-ozone-password',
          ozoneTimeoutMs: 1500,
          ozoneMaxBytes: 1024 * 1024,
        },
        silentLogger,
      )
      const drill = await startDrillServer({ ozone })

      const queues = await callAt(drill, NSID.queueList, 'admin')
      expect(queues.status).toBe(502)
      expect(queues.body).toMatchObject({ error: 'UpstreamUnavailable' })
      // No cached queue payload is served when the upstream cannot be reached.
      expect(JSON.stringify(queues.body)).not.toContain('queues')
    })

    it('F5 surfaces upstream rate limits and timeouts once, without retry amplification', async () => {
      let rateLimitedCalls = 0
      const rateUrl = await startStub((_request, response) => {
        rateLimitedCalls += 1
        response.writeHead(429, {
          'content-type': 'application/json',
          'retry-after': '30',
        })
        response.end(JSON.stringify({ error: 'RateLimitExceeded' }))
      })
      const rateLimitedBase = await startDrillServer({
        ozone: createOzoneClient(
          {
            ozoneUrl: rateUrl,
            ozoneAdminPassword: 'drill-ozone-password',
            ozoneTimeoutMs: 2000,
            ozoneMaxBytes: 1024 * 1024,
          },
          silentLogger,
        ),
      })

      const limited = await callAt(rateLimitedBase, NSID.queueList, 'admin')
      expect(limited.status).toBe(429)
      expect(limited.body).toMatchObject({ error: 'RateLimited' })
      expect(rateLimitedCalls).toBe(1)

      let slowCalls = 0
      const slowUrl = await startStub((_request, response) => {
        slowCalls += 1
        setTimeout(() => {
          response.writeHead(200, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ queues: [] }))
        }, 1500)
      })
      const slowBase = await startDrillServer({
        ozone: createOzoneClient(
          {
            ozoneUrl: slowUrl,
            ozoneAdminPassword: 'drill-ozone-password',
            ozoneTimeoutMs: 400,
            ozoneMaxBytes: 1024 * 1024,
          },
          silentLogger,
        ),
      })

      const timedOut = await callAt(slowBase, NSID.queueList, 'admin')
      expect(timedOut.status).toBe(502)
      expect(timedOut.body).toMatchObject({ error: 'UpstreamUnavailable' })
      expect(slowCalls).toBe(1)
    })

    it('F6 fails a sealed password approval after the PDS credential rotates', async () => {
      const created = await call(NSID.roleCreate, 'admin', {
        body: { subject: DRILL_APPROVER, role: 'admin' },
      })
      expect(created.status, JSON.stringify(created.body)).toBe(200)

      const update = { did: ACCOUNT_DID, password: 'e2e-rotated-password' }
      const requested = await call(NSID.approvalCreate, 'admin', {
        body: { action: 'account.admin.update', payload: update },
      })
      expect(requested.status, JSON.stringify(requested.body)).toBe(200)
      const approvalId = (requested.body as { approval: { id: string } }).approval.id

      const pending = await db
        .selectFrom('admin.admin_approval')
        .select(['payload'])
        .where('id', '=', approvalId)
        .executeTakeFirstOrThrow()
      const sealed = pending.payload as Record<string, unknown>
      expect(sealed.passwordSealed).toBeTypeOf('string')
      expect(JSON.stringify(sealed)).not.toContain('e2e-rotated-password')

      // The approving server runs with a different PDS credential, which is
      // exactly what happens after a deployment rotates the upstream secret.
      const rotatedPds = createFakePds()
      const rotatedBase = await startDrillServer({
        pds: rotatedPds,
        pdsAdminPassword: 'rotated-e2e-pds-password',
      })

      const approved = await callAt(rotatedBase, NSID.approvalApprove, 'drill', {
        body: { id: approvalId },
      })
      expect(approved.status).toBe(400)
      expect(approved.body).toMatchObject({ error: 'InvalidRequest' })
      expect((approved.body as { message: string }).message).toContain('无法解密')
      expect(rotatedPds.calls).toHaveLength(0)

      const failed = await db
        .selectFrom('admin.admin_approval')
        .select(['status', 'decided_by', 'error', 'payload'])
        .where('id', '=', approvalId)
        .executeTakeFirstOrThrow()
      expect(failed.status).toBe('failed')
      expect(failed.decided_by).toBe(DRILL_APPROVER)
      expect(failed.error ?? '').toContain('无法解密')
      expect((failed.payload as Record<string, unknown>).passwordSealed).toBeUndefined()
      expect(JSON.stringify(failed.payload)).not.toContain('e2e-rotated-password')

      const audited = await db
        .selectFrom('admin.admin_audit_event')
        .select(['result'])
        .where('actor_did', '=', DRILL_APPROVER)
        .where('action', '=', 'com.selfcommand.admin.approval.approve')
        .execute()
      expect(audited).toHaveLength(1)
      expect(audited[0]).toMatchObject({ result: 'error' })

      const list = await call(NSID.approvalList, 'admin', {
        params: { status: 'failed' },
      })
      expect(list.status).toBe(200)
      const row = (
        list.body as { approvals: { id: string; status: string; error?: string }[] }
      ).approvals.find((entry) => entry.id === approvalId)
      expect(row).toMatchObject({ status: 'failed' })
      expect(row?.error ?? '').toContain('无法解密')
    })
  })
})
