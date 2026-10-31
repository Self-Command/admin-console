import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminApiError } from '@/lib/api/admin-client'
import type { ModerationAnalyticsResult } from '@/lib/data/types'
import ModerationAnalyticsPage from '@/app/(console)/moderation/analytics/page'

const mocks = vi.hoisted(() => ({
  permissions: ['analytics.read'] as string[],
  getModerationAnalytics: vi.fn(),
  getRandomAccount: vi.fn(),
  exportAnalytics: vi.fn(),
  downloadTextFile: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/components/auth/auth-provider', () => ({
  useAuth: () => ({
    identity: {
      did: 'did:web:ops.selfcommand.example',
      role: 'viewer',
      permissions: mocks.permissions,
    },
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
    warning: vi.fn(),
  },
}))

vi.mock('@/lib/download', () => ({
  downloadTextFile: mocks.downloadTextFile,
}))

vi.mock('@/lib/data/use-data-provider', () => {
  const provider = {
    getModerationAnalytics: mocks.getModerationAnalytics,
    getRandomAccount: mocks.getRandomAccount,
    exportAnalytics: mocks.exportAnalytics,
  }
  return { useDataProvider: () => provider }
})

const analytics: ModerationAnalyticsResult = {
  summary: {
    pendingCount: 12,
    closedCount: 34,
    escalatedCount: 3,
    inboundCount: 45,
    actionedCount: 20,
    acknowledgedCount: 8,
    closureTargetMetRate: 92,
    closureTargetOverdueCount: 4,
  },
  days: [
    {
      day: '2026-10-28',
      inboundCount: 5,
      pendingCount: 12,
      closedCount: 7,
      escalatedCount: 1,
      actionedCount: 6,
      acknowledgedCount: 4,
    },
    {
      day: '2026-10-29',
      inboundCount: 9,
      pendingCount: 12,
      closedCount: 4,
      escalatedCount: 0,
      actionedCount: 3,
      acknowledgedCount: 2,
    },
  ],
}

function summaryCard(label: string): HTMLElement {
  const card = screen.getByText(label).closest('div')
  if (!card) throw new Error(`${label} card not found`)
  return card
}

describe('moderation analytics page', () => {
  beforeEach(() => {
    mocks.permissions = ['analytics.read']
    mocks.getModerationAnalytics.mockReset()
    mocks.getRandomAccount.mockReset()
    mocks.exportAnalytics.mockReset()
    mocks.downloadTextFile.mockReset()
    mocks.toastSuccess.mockReset()
    mocks.toastError.mockReset()
    mocks.getModerationAnalytics.mockResolvedValue(analytics)
    mocks.getRandomAccount.mockResolvedValue({
      did: 'did:plc:random7x4k2m6q3n5p',
      handle: 'random.example.com',
      status: 'active',
    })
    mocks.exportAnalytics.mockResolvedValue({
      filename: '审核分析-20261030-1030.csv',
      contentType: 'text/csv;charset=utf-8',
      content: 'day,inboundCount\n2026-10-28,5\n',
      rows: 2,
    })
  })

  it('renders the summary cards and daily table for the default range', async () => {
    render(<ModerationAnalyticsPage />)

    expect(await screen.findByText('待处理举报')).toBeInTheDocument()
    expect(within(summaryCard('待处理举报')).getByText('12')).toBeInTheDocument()
    expect(within(summaryCard('已结案举报')).getByText('34')).toBeInTheDocument()
    expect(within(summaryCard('按时结案率')).getByText('92%')).toBeInTheDocument()
    expect(within(summaryCard('超时未结案')).getByText('4')).toBeInTheDocument()

    expect(mocks.getModerationAnalytics).toHaveBeenCalledWith(7)
    expect(screen.getByText(/最近 7 天/)).toBeInTheDocument()

    const row = screen.getByText('2026-10-28').closest('tr')
    if (!row) throw new Error('day row not found')
    expect(within(row).getByText('5')).toBeInTheDocument()
    expect(within(row).getByText('7')).toBeInTheDocument()
    expect(within(row).getByText('6')).toBeInTheDocument()
    expect(within(row).getByText('4')).toBeInTheDocument()

    const header = screen.getByRole('row', { name: /日期/ })
    expect(within(header).getByText('新增举报')).toBeInTheDocument()
    expect(within(header).getByText('升级处理')).toBeInTheDocument()
  })

  it('reloads the aggregates when the range changes', async () => {
    const user = userEvent.setup()
    render(<ModerationAnalyticsPage />)

    await screen.findByText('待处理举报')
    await user.click(screen.getByRole('button', { name: '近 30 天' }))

    await waitFor(() => expect(mocks.getModerationAnalytics).toHaveBeenLastCalledWith(30))
    expect(await screen.findByText(/最近 30 天/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '近 90 天' }))
    await waitFor(() => expect(mocks.getModerationAnalytics).toHaveBeenLastCalledWith(90))
  })

  it('exports the daily aggregates for the selected range', async () => {
    const user = userEvent.setup()
    render(<ModerationAnalyticsPage />)

    await screen.findByText('待处理举报')
    await user.click(screen.getByRole('button', { name: '导出数据' }))

    await waitFor(() => expect(mocks.exportAnalytics).toHaveBeenCalledWith(7))
    expect(mocks.downloadTextFile).toHaveBeenCalledWith(
      '审核分析-20261030-1030.csv',
      expect.stringContaining('2026-10-28'),
      'text/csv;charset=utf-8',
    )
    expect(mocks.toastSuccess).toHaveBeenCalledWith('已导出最近 7 天的审核统计数据。')

    await user.click(screen.getByRole('button', { name: '近 30 天' }))
    await waitFor(() =>
      expect(mocks.getModerationAnalytics).toHaveBeenLastCalledWith(30),
    )
    await user.click(screen.getByRole('button', { name: '导出数据' }))
    await waitFor(() => expect(mocks.exportAnalytics).toHaveBeenLastCalledWith(30))
  })

  it('reports an export rejected by the rate limit', async () => {
    mocks.exportAnalytics.mockRejectedValue(
      new AdminApiError('validation', 429, 'RateLimited'),
    )
    const user = userEvent.setup()
    render(<ModerationAnalyticsPage />)

    await screen.findByText('待处理举报')
    await user.click(screen.getByRole('button', { name: '导出数据' }))

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('操作过于频繁，请稍后再试。'),
    )
    expect(mocks.downloadTextFile).not.toHaveBeenCalled()
  })

  it('explains when the selected range has no daily data', async () => {
    mocks.getModerationAnalytics.mockResolvedValue({ ...analytics, days: [] })
    render(<ModerationAnalyticsPage />)

    expect(await screen.findByText('每日审核数据')).toBeInTheDocument()
    expect(
      screen.getByText('所选时间范围内没有审核数据。举报产生后，统计数据会随审核操作更新。'),
    ).toBeInTheDocument()
  })

  it('draws a random account and links to its detail page', async () => {
    const user = userEvent.setup()
    render(<ModerationAnalyticsPage />)

    await screen.findByText('待处理举报')
    await user.click(screen.getByRole('button', { name: '随机抽查账号' }))

    expect(await screen.findByText('random.example.com')).toBeInTheDocument()
    expect(screen.getByText('正常')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /查看账号详情/ })).toHaveAttribute(
      'href',
      `/directory/${encodeURIComponent('did:plc:random7x4k2m6q3n5p')}`,
    )

    await user.click(screen.getByRole('button', { name: '换一个' }))
    await waitFor(() => expect(mocks.getRandomAccount).toHaveBeenCalledTimes(2))
  })

  it('explains when the directory has no account to sample', async () => {
    mocks.getRandomAccount.mockRejectedValue(new AdminApiError('not_found', 404))
    const user = userEvent.setup()
    render(<ModerationAnalyticsPage />)

    await screen.findByText('待处理举报')
    await user.click(screen.getByRole('button', { name: '随机抽查账号' }))

    expect(
      await screen.findByText('账号目录中暂无可抽查的账号，请等待目录同步完成后再试。'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /查看账号详情/ }),
    ).not.toBeInTheDocument()
  })

  it('reports random sampling failures', async () => {
    mocks.getRandomAccount.mockRejectedValue(new AdminApiError('network', null))
    const user = userEvent.setup()
    render(<ModerationAnalyticsPage />)

    await screen.findByText('待处理举报')
    await user.click(screen.getByRole('button', { name: '随机抽查账号' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '无法连接后台服务，请检查网络后重试。',
    )
  })

  it('reports aggregate failures and retries the request', async () => {
    mocks.getModerationAnalytics
      .mockRejectedValueOnce(new AdminApiError('network', null))
      .mockResolvedValueOnce(analytics)
    const user = userEvent.setup()
    render(<ModerationAnalyticsPage />)

    expect(await screen.findByText('审核分析加载失败')).toBeInTheDocument()
    expect(
      screen.getByText('无法连接后台服务，请检查网络后重试。'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /重试/ }))
    expect(await screen.findByText('待处理举报')).toBeInTheDocument()
    expect(mocks.getModerationAnalytics).toHaveBeenCalledTimes(2)
  })

  it('explains when the reader lacks analytics.read', () => {
    mocks.permissions = []
    render(<ModerationAnalyticsPage />)

    expect(screen.getByText('没有查看审核分析的权限')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '随机抽查账号' }),
    ).not.toBeInTheDocument()
    expect(mocks.getModerationAnalytics).not.toHaveBeenCalled()
  })
})
