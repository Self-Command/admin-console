import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExternalServiceStatus, SystemStatus } from '@/lib/data/types'
import { formatDateTime } from '@/lib/format'
import SystemPage from '@/app/(console)/system/page'

const mocks = vi.hoisted(() => ({
  permissions: ['settings.read', 'settings.write'] as string[],
  getSystemStatus: vi.fn(),
  pauseIndexer: vi.fn(),
  resumeIndexer: vi.fn(),
}))

vi.mock('@/components/auth/auth-provider', () => ({
  useAuth: () => ({
    identity: {
      did: 'did:web:ops.selfcommand.example',
      role: 'admin',
      permissions: mocks.permissions,
    },
  }),
}))

vi.mock('@/components/layout/workspace-provider', () => ({
  useWorkspace: () => ({
    pageSize: 10,
    dateFormat: 'date-time' as const,
    features: {
      auditExport: true,
      roleBulk: true,
      indexerControls: true,
      systemStatus: true,
      accountOperations: true,
      approvals: true,
      securityCenter: true,
      dashboardTrends: true,
    },
  }),
}))

vi.mock('@/lib/data/use-data-provider', () => {
  const provider = {
    getSystemStatus: mocks.getSystemStatus,
    pauseIndexer: mocks.pauseIndexer,
    resumeIndexer: mocks.resumeIndexer,
  }
  return { useDataProvider: () => provider }
})

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub)

const CHECKED_AT = '2026-10-30T08:00:00.000Z'

const systemStatus: SystemStatus = {
  version: '1.4.0',
  startedAt: '2026-10-30T06:00:00.000Z',
  uptimeSeconds: 7200,
  database: { name: '业务数据库', status: 'ok', latencyMs: 3, checkedAt: CHECKED_AT },
  migrations: { executed: ['0010_admin_foundation'], pending: [] },
  indexer: {
    connected: true,
    backfillComplete: true,
    paused: false,
    lastEventAt: CHECKED_AT,
    lastIndexedAt: CHECKED_AT,
  },
  pds: { name: '账号服务', status: 'ok', latencyMs: 12, checkedAt: CHECKED_AT },
  ozone: { name: '审核服务', status: 'ok', latencyMs: 20, checkedAt: CHECKED_AT },
  appview: { name: '内容服务', status: 'ok', latencyMs: 9, checkedAt: CHECKED_AT },
  ozoneDaemon: {
    name: '举报路由',
    status: 'degraded',
    checkedAt: CHECKED_AT,
    detail: '举报路由已滞后 10 分钟',
  },
  externalServices: [
    {
      key: 'image-search',
      name: '图片检索',
      status: 'disabled',
      detail: '未配置图片检索服务地址',
    },
    {
      key: 'chat',
      name: '聊天审核',
      status: 'disabled',
      detail: '未部署聊天服务',
    },
    {
      key: 'email',
      name: '邮件通知',
      status: 'unknown',
      detail: '发送能力取决于账号服务的邮件配置',
    },
  ],
}

function statusWithLabeler(labeler: ExternalServiceStatus): SystemStatus {
  return {
    ...systemStatus,
    externalServices: [...(systemStatus.externalServices ?? []), labeler],
  }
}

describe('system page', () => {
  beforeEach(() => {
    mocks.permissions = ['settings.read', 'settings.write']
    mocks.getSystemStatus.mockReset()
    mocks.pauseIndexer.mockReset()
    mocks.resumeIndexer.mockReset()
    mocks.getSystemStatus.mockResolvedValue(systemStatus)
    mocks.pauseIndexer.mockResolvedValue({
      ...systemStatus.indexer,
      paused: true,
      pausedAt: CHECKED_AT,
    })
    mocks.resumeIndexer.mockResolvedValue({ ...systemStatus.indexer, paused: false })
  })

  it('renders every upstream service and the report routing state', async () => {
    render(<SystemPage />)

    expect(await screen.findByText('账号服务')).toBeInTheDocument()
    expect(screen.getByText('审核服务')).toBeInTheDocument()
    expect(screen.getByText('内容服务')).toBeInTheDocument()
    expect(screen.getByText('举报路由')).toBeInTheDocument()
    expect(screen.getByText('举报路由已滞后 10 分钟')).toBeInTheDocument()
    expect(screen.getAllByText('受限').length).toBeGreaterThan(0)
  })

  it('lists external capabilities with their configuration state', async () => {
    render(<SystemPage />)

    expect(await screen.findByText('图片检索')).toBeInTheDocument()
    expect(screen.getByText('未配置图片检索服务地址')).toBeInTheDocument()
    expect(screen.getByText('聊天审核')).toBeInTheDocument()
    expect(screen.getByText('邮件通知')).toBeInTheDocument()
    expect(screen.getByText('待检查')).toBeInTheDocument()
    expect(screen.getAllByText('未启用').length).toBeGreaterThanOrEqual(2)
  })

  it('renders the labeler as available with its detail and check time', async () => {
    mocks.getSystemStatus.mockResolvedValue(
      statusWithLabeler({
        key: 'labeler',
        name: '标签服务',
        status: 'ok',
        detail: '标签服务已连接，共订阅 6 个标签。',
        checkedAt: CHECKED_AT,
      }),
    )
    render(<SystemPage />)

    const row = await screen.findByTestId('labeler-service-row')
    expect(within(row).getByText('标签服务')).toBeInTheDocument()
    expect(within(row).getByText('可用')).toBeInTheDocument()
    expect(within(row).getByText('标签服务已连接，共订阅 6 个标签。')).toBeInTheDocument()
    expect(within(row).getByText(`最近检查：${formatDateTime(CHECKED_AT)}`)).toBeInTheDocument()
  })

  it('explains why the labeler is unavailable and offers next steps', async () => {
    mocks.getSystemStatus.mockResolvedValue(
      statusWithLabeler({
        key: 'labeler',
        name: '标签服务',
        status: 'unavailable',
        detail: '查询标签服务返回 502。',
        checkedAt: CHECKED_AT,
      }),
    )
    render(<SystemPage />)

    const row = await screen.findByTestId('labeler-service-row')
    expect(within(row).getByText('标签服务')).toBeInTheDocument()
    expect(within(row).getByText('不可用')).toBeInTheDocument()
    expect(within(row).getByText('查询标签服务返回 502。')).toBeInTheDocument()
    expect(
      within(row).getByText('标签服务暂时无法连接，请检查审核服务配置与网络后重试。'),
    ).toBeInTheDocument()
  })

  it('marks the labeler as disabled when credentials are not configured', async () => {
    mocks.getSystemStatus.mockResolvedValue(
      statusWithLabeler({
        key: 'labeler',
        name: '标签服务',
        status: 'disabled',
      }),
    )
    render(<SystemPage />)

    const row = await screen.findByTestId('labeler-service-row')
    expect(within(row).getByText('标签服务')).toBeInTheDocument()
    expect(within(row).getByText('未启用')).toBeInTheDocument()
    expect(
      within(row).getByText(
        '尚未配置审核服务凭据，无法探测标签服务。请在系统设置中完成审核服务配置。',
      ),
    ).toBeInTheDocument()
    expect(within(row).getByText('最近检查：—')).toBeInTheDocument()
  })

  it('pauses the indexer after confirmation and refreshes the status', async () => {
    const user = userEvent.setup()
    render(<SystemPage />)

    await user.click(await screen.findByRole('button', { name: /暂停同步/ }))
    const dialog = await screen.findByRole('alertdialog')
    await user.type(within(dialog).getByLabelText('暂停原因（可选）'), '账号服务升级维护')
    await user.click(within(dialog).getByRole('button', { name: '确认暂停' }))

    await waitFor(() =>
      expect(mocks.pauseIndexer).toHaveBeenCalledWith('账号服务升级维护'),
    )
    await waitFor(() => expect(mocks.getSystemStatus).toHaveBeenCalledTimes(2))
  })

  it('hides indexer controls for readers without settings.write', async () => {
    mocks.permissions = ['settings.read']
    render(<SystemPage />)

    expect(await screen.findByText('账号服务')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /暂停同步/ })).not.toBeInTheDocument()
  })
})
