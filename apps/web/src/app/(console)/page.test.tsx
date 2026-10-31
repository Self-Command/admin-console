import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DashboardPage from '@/app/(console)/page'

const mocks = vi.hoisted(() => {
  type TestIdentity = {
    did: string
    role: 'admin' | 'operator' | 'viewer'
    permissions: string[]
  }
  const listAccounts = vi.fn()
  const listRoles = vi.fn()
  const listAudit = vi.fn()
  const auth: { identity: TestIdentity; preview: boolean } = {
    identity: {
      did: 'did:web:ops.selfcommand.example',
      role: 'admin',
      permissions: ['directory.read', 'role.read', 'role.write', 'audit.read'],
    },
    preview: false,
  }
  return {
    listAccounts,
    listRoles,
    listAudit,
    auth,
    provider: { listAccounts, listRoles, listAudit },
  }
})

vi.mock('@/components/auth/auth-provider', () => ({
  useAuth: () => mocks.auth,
}))

vi.mock('@/lib/data/use-data-provider', () => ({
  useDataProvider: () => mocks.provider,
}))

vi.mock('@/components/layout/workspace-provider', () => ({
  useWorkspace: () => ({
    groups: [],
    dateFormat: 'date-time' as const,
    features: { dashboardTrends: false },
  }),
}))

const now = new Date().toISOString()

const indexer = {
  backfillComplete: true,
  lastIndexedAt: now,
  lastEventAt: now,
  cursor: '48213917',
}

const accounts = { accounts: [], total: 120, indexer }
const activeAccounts = { accounts: [], total: 100, indexer }

const auditEvent = {
  id: 1,
  action: 'com.selfcommand.admin.role.create',
  actor: 'did:web:ops.selfcommand.example',
  result: 'success' as const,
  target: 'did:plc:newmember7x4k2m6q3n5p4w',
  createdAt: now,
}

function wireHappyPath() {
  mocks.listAccounts.mockImplementation(({ status }: { status?: string }) =>
    Promise.resolve(status === 'active' ? activeAccounts : accounts),
  )
  mocks.listRoles.mockImplementation(({ role }: { role: string }) =>
    Promise.resolve({
      roles: [],
      total: role === 'admin' ? 2 : role === 'operator' ? 3 : 1,
    }),
  )
  mocks.listAudit.mockImplementation((params: { limit?: number; result?: string }) => {
    if (params.limit === 5) {
      return Promise.resolve({ events: [auditEvent], total: 6 })
    }
    if (params.result === 'denied') {
      return Promise.resolve({ events: [], total: 2 })
    }
    return Promise.resolve({ events: [], total: 7 })
  })
}

describe('dashboard page', () => {
  beforeEach(() => {
    mocks.listAccounts.mockReset()
    mocks.listRoles.mockReset()
    mocks.listAudit.mockReset()
    mocks.auth.preview = false
    mocks.auth.identity = {
      did: 'did:web:ops.selfcommand.example',
      role: 'admin',
      permissions: ['directory.read', 'role.read', 'role.write', 'audit.read'],
    }
    wireHappyPath()
  })

  it('renders real directory, role and audit statistics for an admin', async () => {
    render(<DashboardPage />)

    expect(await screen.findByText('活跃 100 · 只读索引')).toBeInTheDocument()
    expect(screen.getByText('120')).toBeInTheDocument()
    expect(screen.getByText('管理员 2 · 审核员 1 · 运营 3 · 只读 1')).toBeInTheDocument()
    expect(screen.getByText('拒绝 2 · 自 00:00 起')).toBeInTheDocument()
    expect(screen.getByText('授予角色')).toBeInTheDocument()
    expect(screen.getByText('48213917')).toBeInTheDocument()
    expect(mocks.listRoles).toHaveBeenCalledTimes(4)
    expect(mocks.listAudit).toHaveBeenCalledTimes(3)
  })

  it('does not request or render role and audit data for an operator', async () => {
    mocks.auth.identity = {
      did: 'did:web:moderation.selfcommand.example',
      role: 'operator',
      permissions: ['directory.read'],
    }

    render(<DashboardPage />)

    expect(await screen.findByText('活跃 100 · 只读索引')).toBeInTheDocument()
    expect(screen.getByText('我的角色')).toBeInTheDocument()
    expect(screen.getByText('运营')).toBeInTheDocument()
    expect(screen.getByText('访问范围')).toBeInTheDocument()
    expect(screen.queryByText('角色分布')).not.toBeInTheDocument()
    expect(screen.queryByText('最近审计事件')).not.toBeInTheDocument()
    expect(mocks.listRoles).not.toHaveBeenCalled()
    expect(mocks.listAudit).not.toHaveBeenCalled()
  })

  it('offers a retry after a failed load', async () => {
    const user = userEvent.setup()
    mocks.listAccounts.mockRejectedValueOnce(new Error('network down'))

    render(<DashboardPage />)

    expect(await screen.findByText('总览加载失败')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重试' }))

    expect(await screen.findByText('活跃 100 · 只读索引')).toBeInTheDocument()
  })
})
