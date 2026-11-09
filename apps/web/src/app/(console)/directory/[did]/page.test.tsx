import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  Account,
  AccountModerationResult,
  EventView,
  IndexerStatus,
  ReportView,
  RoleBinding,
} from '@/lib/data/types'
import { AdminApiError } from '@/lib/api/admin-client'
import AccountDetailPage from '@/app/(console)/directory/[did]/page'

const mocks = vi.hoisted(() => ({
  did: 'did:plc:alice7x4k2m6q3n5p4w',
  permissions: ['directory.read', 'role.read', 'settings.read'] as string[],
  getAccount: vi.fn(),
  getRole: vi.fn(),
  getAccountProfile: vi.fn(),
  updateAccountProfile: vi.fn(),
  exportAccount: vi.fn(),
  getAccountModeration: vi.fn(),
  listEvents: vi.fn(),
  listReports: vi.fn(),
  getReport: vi.fn(),
  actOnReport: vi.fn(),
  getAccountAdminInfo: vi.fn(),
  updateAccountAdmin: vi.fn(),
  deleteAccountAdmin: vi.fn(),
  disableAccountInvites: vi.fn(),
  callAdmin: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ did: mocks.did }),
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/components/auth/auth-provider', () => ({
  useAuth: () => ({
    identity: {
      did: 'did:web:ops.selfcommand.example',
      role: 'admin',
      permissions: mocks.permissions,
    },
    callAdmin: mocks.callAdmin,
  }),
}))

vi.mock('@/lib/data/use-data-provider', () => {
  const provider = {
    getAccount: mocks.getAccount,
    getRole: mocks.getRole,
    getAccountProfile: mocks.getAccountProfile,
    updateAccountProfile: mocks.updateAccountProfile,
    exportAccount: mocks.exportAccount,
    getAccountModeration: mocks.getAccountModeration,
    listEvents: mocks.listEvents,
    listReports: mocks.listReports,
    getReport: mocks.getReport,
    actOnReport: mocks.actOnReport,
    getAccountAdminInfo: mocks.getAccountAdminInfo,
    updateAccountAdmin: mocks.updateAccountAdmin,
    deleteAccountAdmin: mocks.deleteAccountAdmin,
    disableAccountInvites: mocks.disableAccountInvites,
  }
  return { useDataProvider: () => provider }
})

vi.mock('@/components/layout/workspace-provider', () => ({
  useWorkspace: () => ({
    pageSize: 10,
    dateFormat: 'date-time' as const,
    features: {
      auditExport: true,
      roleBulk: true,
      indexerControls: true,
      systemStatus: true,
      accountOperations: false,
      approvals: true,
      securityCenter: true,
      dashboardTrends: true,
    },
  }),
}))

const account: Account = {
  did: 'did:plc:alice7x4k2m6q3n5p4w',
  handle: 'alice.example.com',
  status: 'active',
  lastEventAt: '2026-10-29T07:40:02.000Z',
  indexedAt: '2026-10-29T07:41:14.000Z',
}

const indexer: IndexerStatus = {
  backfillComplete: true,
  lastIndexedAt: '2026-10-29T07:41:00.000Z',
  cursor: '48213917',
}

const role: RoleBinding = {
  subject: account.did,
  role: 'operator',
  grantedBy: 'did:plc:bootstrapadmin',
  note: '内容运营',
  createdAt: '2026-10-20T02:00:00.000Z',
  updatedAt: '2026-10-20T02:00:00.000Z',
}

const event: EventView = {
  id: 9001,
  eventType: 'modEventTakedown',
  subject: account.did,
  subjectType: 'account',
  createdBy: 'did:plc:moderator7',
  creatorHandle: 'moderator.example.com',
  createdAt: '2026-10-28T03:00:00.000Z',
  comment: '屡次发布违规内容',
}

const report: ReportView = {
  id: 4321,
  status: 'open',
  subject: account.did,
  subjectType: 'account',
  reportType: 'tools.ozone.report.defs#reasonSpam',
  reportedBy: 'did:plc:reporter5',
  createdAt: '2026-10-28T01:00:00.000Z',
}

const moderation: AccountModerationResult = {
  overview: {
    did: account.did,
    status: 'active',
    takendown: false,
    muted: false,
    eventCount: 3,
    openReportCount: 1,
    lastReviewedAt: '2026-10-28T03:00:00.000Z',
  },
  events: [event],
  reports: [report],
}

describe('account detail page', () => {
  beforeEach(() => {
    mocks.did = account.did
    mocks.permissions = ['directory.read', 'role.read', 'settings.read']
    mocks.getAccount.mockReset()
    mocks.getRole.mockReset()
    mocks.getAccountProfile.mockReset()
    mocks.updateAccountProfile.mockReset()
    mocks.exportAccount.mockReset()
    mocks.getAccountModeration.mockReset()
    mocks.listEvents.mockReset()
    mocks.listReports.mockReset()
    mocks.getReport.mockReset()
    mocks.actOnReport.mockReset()
    mocks.getAccountAdminInfo.mockReset()
    mocks.updateAccountAdmin.mockReset()
    mocks.deleteAccountAdmin.mockReset()
    mocks.disableAccountInvites.mockReset()
    mocks.callAdmin.mockReset()
    mocks.getAccount.mockResolvedValue({ account, indexer })
    mocks.getRole.mockResolvedValue(role)
    mocks.getAccountModeration.mockResolvedValue(moderation)
    mocks.listEvents.mockResolvedValue({ events: [event] })
    mocks.listReports.mockResolvedValue({ reports: [report] })
    mocks.callAdmin.mockResolvedValue({
      settings: { integrations: { ozoneUrl: 'https://ozone.example.com' } },
    })
  })

  it('renders account, role binding and external admin links', async () => {
    const user = userEvent.setup()
    render(<AccountDetailPage />)

    expect(
      await screen.findByRole('heading', { name: 'alice.example.com' }),
    ).toBeInTheDocument()
    expect(screen.getByText(account.did)).toBeInTheDocument()
    expect(await screen.findByText('运营')).toBeInTheDocument()
    expect(screen.getByText('内容运营')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '账号管理' }))
    const ozone = await screen.findByRole('link', { name: /在 Ozone 审核后台中查找/ })
    expect(ozone).toHaveAttribute(
      'href',
      `https://ozone.example.com/search?term=${encodeURIComponent(account.did)}`,
    )
  })

  it('renders the account administration panel for account admins', async () => {
    mocks.permissions = ['directory.read', 'settings.read', 'account.admin']
    mocks.getAccountAdminInfo.mockResolvedValue({
      did: account.did,
      handle: account.handle,
      email: 'alice@example.com',
      emailConfirmed: true,
      invitesDisabled: false,
    })
    const user = userEvent.setup()
    render(<AccountDetailPage />)

    await screen.findByRole('heading', { name: 'alice.example.com' })
    await user.click(screen.getByRole('tab', { name: '账号管理' }))

    expect(await screen.findByLabelText('邮箱')).toHaveValue('alice@example.com')
    expect(screen.getByRole('button', { name: '保存账号资料' })).toBeInTheDocument()
    expect(mocks.getAccountAdminInfo).toHaveBeenCalledWith(account.did)
  })

  it('hides the account administration panel without account.admin', async () => {
    const user = userEvent.setup()
    render(<AccountDetailPage />)

    await screen.findByRole('heading', { name: 'alice.example.com' })
    await user.click(screen.getByRole('tab', { name: '账号管理' }))

    expect(screen.queryByText('账号资料')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '保存账号资料' }),
    ).not.toBeInTheDocument()
    expect(mocks.getAccountAdminInfo).not.toHaveBeenCalled()
  })

  it('loads moderation overview, events and reports in account tabs', async () => {
    mocks.permissions = [
      'directory.read',
      'role.read',
      'settings.read',
      'moderation.read',
    ]
    const user = userEvent.setup()
    render(<AccountDetailPage />)

    expect(await screen.findByText('处置记录数')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '处置记录' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '处置对象' })).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '处置记录' }))
    expect(await screen.findByText('下架处置')).toBeInTheDocument()
    expect(screen.getByText('屡次发布违规内容')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '举报记录' }))
    expect(await screen.findByText('垃圾信息')).toBeInTheDocument()
    expect(mocks.listEvents).toHaveBeenCalledWith(
      expect.objectContaining({ did: account.did }),
    )
    expect(mocks.listReports).toHaveBeenCalledWith(
      expect.objectContaining({ did: account.did }),
    )
  })

  it('hides moderation tabs when the reader lacks moderation.read', async () => {
    render(<AccountDetailPage />)

    expect(await screen.findByText('账号信息')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '处置记录' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '举报记录' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '处置对象' })).not.toBeInTheDocument()
    expect(screen.queryByText('审核概览')).not.toBeInTheDocument()
    expect(mocks.getAccountModeration).not.toHaveBeenCalled()
  })

  it('hides role details when the reader lacks role.read', async () => {
    mocks.permissions = ['directory.read']
    render(<AccountDetailPage />)

    expect(
      await screen.findByRole('heading', { name: 'alice.example.com' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('当前账号没有查看角色绑定的权限。如需核实该账号的后台角色，请联系管理员。'),
    ).toBeInTheDocument()
    expect(mocks.getRole).not.toHaveBeenCalled()
  })

  it('explains when the account is not in the directory', async () => {
    mocks.getAccount.mockRejectedValue(new AdminApiError('not_found', 404))
    render(<AccountDetailPage />)

    expect(await screen.findByText('未找到该账号')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /返回账号目录/ }).length).toBeGreaterThan(0)
  })

  it('rejects an invalid account identifier before calling the provider', async () => {
    mocks.did = 'not-a-did'
    render(<AccountDetailPage />)

    expect(screen.getByText('账号标识格式不正确')).toBeInTheDocument()
    expect(mocks.getAccount).not.toHaveBeenCalled()
  })
})
