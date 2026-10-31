import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReportView } from '@/lib/data/types'
import { AdminApiError } from '@/lib/api/admin-client'
import ModerationReportsPage from '@/app/(console)/moderation/reports/page'

const mocks = vi.hoisted(() => ({
  permissions: ['moderation.read'] as string[],
  listReports: vi.fn(),
  listQueues: vi.fn(),
  getReport: vi.fn(),
  actOnReport: vi.fn(),
}))

vi.mock('@/components/auth/auth-provider', () => ({
  useAuth: () => ({
    identity: {
      did: 'did:web:ops.selfcommand.example',
      role: 'admin',
      permissions: mocks.permissions,
    },
    callAdmin: vi.fn(),
  }),
}))

vi.mock('@/components/layout/workspace-provider', () => ({
  useWorkspace: () => ({
    status: 'ready',
    pageSize: 10,
    preferences: {},
    savingPreferences: false,
    savePreferences: vi.fn(),
  }),
}))

vi.mock('@/lib/data/use-data-provider', () => {
  const provider = {
    listReports: mocks.listReports,
    listQueues: mocks.listQueues,
    getReport: mocks.getReport,
    actOnReport: mocks.actOnReport,
  }
  return { useDataProvider: () => provider }
})

const report: ReportView = {
  id: 4321,
  status: 'open',
  subject: 'did:plc:alice7x4k2m6q3n5p4w',
  subjectType: 'account',
  reportType: 'tools.ozone.report.defs#reasonSpam',
  reportedBy: 'did:plc:reporter5',
  createdAt: '2026-10-28T01:00:00.000Z',
}

const secondReport: ReportView = {
  ...report,
  id: 4322,
  reportType: 'tools.ozone.report.defs#reasonHarassment',
  subject: 'at://did:plc:bob/app.bsky.feed.post/3kxyz',
  subjectType: 'record',
}

describe('moderation reports page', () => {
  beforeEach(() => {
    mocks.permissions = ['moderation.read']
    mocks.listReports.mockReset()
    mocks.listQueues.mockReset()
    mocks.getReport.mockReset()
    mocks.actOnReport.mockReset()
    mocks.listQueues.mockResolvedValue({
      queues: [{ id: 2, name: '默认队列', enabled: true, createdAt: '', updatedAt: '' }],
    })
    mocks.listReports.mockResolvedValue({ reports: [report], cursor: 'cursor-2' })
  })

  it('renders reports with the default open filter', async () => {
    render(<ModerationReportsPage />)

    expect(await screen.findByText('垃圾信息')).toBeInTheDocument()
    expect(screen.getByText('#4321')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '按举报状态过滤' })).toHaveValue('open')
    expect(mocks.listReports).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'open',
        limit: 10,
        sort: 'createdAt',
        direction: 'desc',
      }),
    )
  })

  it('shows the empty state when no report matches', async () => {
    mocks.listReports.mockResolvedValue({ reports: [] })
    render(<ModerationReportsPage />)

    expect(await screen.findByText('没有匹配的举报')).toBeInTheDocument()
  })

  it('reports failures and retries the request', async () => {
    mocks.listReports.mockRejectedValueOnce(new AdminApiError('network', null))
    const user = userEvent.setup()
    render(<ModerationReportsPage />)

    expect(await screen.findByText('举报列表加载失败')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /重试/ }))

    expect(await screen.findByText('垃圾信息')).toBeInTheDocument()
    expect(mocks.listReports).toHaveBeenCalledTimes(2)
  })

  it('rejects an invalid subject filter before querying', async () => {
    const user = userEvent.setup()
    render(<ModerationReportsPage />)

    await screen.findByText('垃圾信息')
    await user.type(screen.getByLabelText('按举报对象过滤'), 'not-a-subject')
    await user.click(screen.getByRole('button', { name: '应用' }))

    expect(
      screen.getByText('请输入账号标识或内容地址，例如 did:plc:… 或 at://…'),
    ).toBeInTheDocument()
    expect(mocks.listReports).toHaveBeenCalledTimes(1)
  })

  it('loads the next page with the returned cursor', async () => {
    mocks.listReports
      .mockResolvedValueOnce({ reports: [report], cursor: 'cursor-2' })
      .mockResolvedValueOnce({ reports: [secondReport] })
    const user = userEvent.setup()
    render(<ModerationReportsPage />)

    await screen.findByText('垃圾信息')
    await user.click(screen.getByRole('button', { name: '下一页' }))

    expect(await screen.findByText('#4322')).toBeInTheDocument()
    expect(mocks.listReports).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'cursor-2' }),
    )
  })

  it('explains when the reader lacks moderation.read', async () => {
    mocks.permissions = []
    render(<ModerationReportsPage />)

    expect(await screen.findByText('没有查看举报的权限')).toBeInTheDocument()
    expect(mocks.listReports).not.toHaveBeenCalled()
  })
})
