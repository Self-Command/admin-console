import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DailyMetric, DashboardSeriesResult } from '@/lib/data/types'
import { AdminApiError } from '@/lib/api/admin-client'
import { DashboardTrendsCard } from '@/components/dashboard/dashboard-trends-card'

const mocks = vi.hoisted(() => ({
  getDashboardSeries: vi.fn(),
}))

vi.mock('@/components/layout/workspace-provider', () => ({
  useWorkspace: () => ({ dateFormat: 'date' }),
}))

vi.mock('@/lib/data/use-data-provider', () => {
  const provider = { getDashboardSeries: mocks.getDashboardSeries }
  return { useDataProvider: () => provider }
})

function metric(day: string, overrides: Partial<DailyMetric> = {}): DailyMetric {
  return {
    day,
    accountsTotal: 0,
    accountsNew: 0,
    accountsActive24h: 0,
    statusCounts: {
      active: 0,
      takendown: 0,
      suspended: 0,
      deactivated: 0,
      deleted: 0,
      unknown: 0,
    },
    auditTotal: 0,
    auditDenied: 0,
    ...overrides,
  }
}

function series(overrides: Partial<DashboardSeriesResult> = {}): DashboardSeriesResult {
  return {
    days: 30,
    indexerEnabled: true,
    generatedAt: '2026-10-29T04:00:00.000Z',
    points: [
      metric('2026-09-30', { accountsTotal: 980, auditTotal: 42, auditDenied: 3 }),
      metric('2026-10-15', { accountsTotal: 1100, auditTotal: 61, auditDenied: 5 }),
      metric('2026-10-29', { accountsTotal: 1250, auditTotal: 88, auditDenied: 9 }),
    ],
    ...overrides,
  }
}

describe('dashboard trends card', () => {
  beforeEach(() => {
    mocks.getDashboardSeries.mockReset()
    mocks.getDashboardSeries.mockResolvedValue(series())
  })

  it('renders the default 30 day series and switches metric and range', async () => {
    const user = userEvent.setup()
    render(<DashboardTrendsCard />)

    const chart = await screen.findByRole('img', { name: /账号总量趋势/ })
    expect(chart).toBeInTheDocument()
    expect(mocks.getDashboardSeries).toHaveBeenCalledWith(30)
    expect(screen.getByText('1,250')).toBeInTheDocument()
    expect(screen.getByText('+270')).toBeInTheDocument()
    expect(screen.getAllByText('10月29日').length).toBeGreaterThan(0)
    expect(screen.getByText(/数据截止：/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '后台操作' }))
    expect(await screen.findByRole('img', { name: /后台操作趋势/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '近 7 天' }))
    await waitFor(() => expect(mocks.getDashboardSeries).toHaveBeenLastCalledWith(7))
    expect(screen.getByRole('button', { name: '近 7 天' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('explains zero account metrics while directory sync is disabled', async () => {
    mocks.getDashboardSeries.mockResolvedValue(
      series({
        indexerEnabled: false,
        points: [
          metric('2026-10-28', { auditTotal: 12, auditDenied: 1 }),
          metric('2026-10-29', { auditTotal: 15, auditDenied: 2 }),
        ],
      }),
    )
    const user = userEvent.setup()
    render(<DashboardTrendsCard />)

    expect(
      await screen.findByText(/账号目录同步当前未启用，账号相关指标显示为 0/),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '后台操作' }))
    expect(await screen.findByRole('img', { name: /后台操作趋势/ })).toBeInTheDocument()
  })

  it('shows a formal empty state when no daily snapshots exist', async () => {
    mocks.getDashboardSeries.mockResolvedValue(series({ points: [] }))
    render(<DashboardTrendsCard />)

    expect(
      await screen.findByText(/暂无可用的每日指标。系统会在启动后补算最近 30 天的快照/),
    ).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('surfaces a load failure and retries on demand', async () => {
    mocks.getDashboardSeries.mockRejectedValueOnce(new AdminApiError('server', 500))
    mocks.getDashboardSeries.mockResolvedValueOnce(series())
    const user = userEvent.setup()
    render(<DashboardTrendsCard />)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重试' }))

    expect(await screen.findByRole('img', { name: /账号总量趋势/ })).toBeInTheDocument()
    expect(mocks.getDashboardSeries).toHaveBeenCalledTimes(2)
  })

  it('requests the selected 90 day range', async () => {
    const user = userEvent.setup()
    render(<DashboardTrendsCard />)

    await screen.findByRole('img', { name: /账号总量趋势/ })
    await user.click(screen.getByRole('button', { name: '近 90 天' }))

    await waitFor(() => expect(mocks.getDashboardSeries).toHaveBeenLastCalledWith(90))
  })
})