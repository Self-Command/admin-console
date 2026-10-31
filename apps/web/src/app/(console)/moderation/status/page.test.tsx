import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminApiError } from '@/lib/api/admin-client'
import type { StatusView } from '@/lib/data/types'
import ModerationStatusPage from '@/app/(console)/moderation/status/page'

const mocks = vi.hoisted(() => ({
  permissions: ['moderation.read'] as string[],
  queryStatuses: vi.fn(),
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
    features: {},
  }),
}))

vi.mock('@/lib/data/use-data-provider', () => {
  const provider = { queryStatuses: mocks.queryStatuses }
  return { useDataProvider: () => provider }
})

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub)

const STATUS: StatusView = {
  id: 31,
  subject: 'did:plc:target',
  subjectType: 'account',
  subjectHandle: 'target.example.com',
  reviewState: 'escalated',
  takendown: true,
  muted: true,
  priorityScore: 80,
  lastReportedAt: '2026-10-29T02:00:00.000Z',
  lastReviewedAt: '2026-10-29T03:00:00.000Z',
  lastReviewedBy: 'did:plc:moderator',
  tags: ['spam'],
  createdAt: '2026-10-28T01:00:00.000Z',
  updatedAt: '2026-10-29T03:00:00.000Z',
}

describe('moderation status page', () => {
  beforeEach(() => {
    mocks.permissions = ['moderation.read']
    mocks.queryStatuses.mockReset()
    mocks.queryStatuses.mockResolvedValue({ statuses: [STATUS] })
  })

  it('queries statuses with the selected filters and renders results', async () => {
    const user = userEvent.setup()
    render(<ModerationStatusPage />)

    expect(screen.getByText('设置条件后查询处置状态')).toBeInTheDocument()

    await user.type(screen.getByLabelText('处置对象'), 'did:plc:target')
    await user.selectOptions(screen.getByLabelText('审核状态'), 'open')
    await user.selectOptions(screen.getByLabelText('下架状态'), 'true')
    await user.click(screen.getByRole('button', { name: /查询/ }))

    await waitFor(() =>
      expect(mocks.queryStatuses).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'did:plc:target',
          reviewState: 'open',
          takendown: true,
          limit: 10,
        }),
      ),
    )

    expect(await screen.findByText('#31')).toBeInTheDocument()
    expect(screen.getAllByText('已升级').length).toBeGreaterThan(0)
    expect(screen.getAllByText('已下架').length).toBeGreaterThan(1)
    expect(screen.getAllByText('禁言中').length).toBeGreaterThan(0)
    expect(screen.getByText('80')).toBeInTheDocument()
    expect(screen.getByText('spam')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /did:plc:target/i })).toHaveAttribute(
      'href',
      `/directory/${encodeURIComponent('did:plc:target')}`,
    )
  })

  it('validates subjects and reviewers before querying', async () => {
    const user = userEvent.setup()
    render(<ModerationStatusPage />)

    await user.type(screen.getByLabelText('处置对象'), 'not-a-did')
    await user.type(screen.getByLabelText('最近审核人'), 'moderator.example.com')
    await user.click(screen.getByRole('button', { name: /查询/ }))

    expect(
      screen.getByText('请输入账号标识或内容地址，例如 did:plc:… 或 at://…'),
    ).toBeInTheDocument()
    expect(screen.getByText('请输入完整的账号标识，例如 did:plc:…')).toBeInTheDocument()
    expect(mocks.queryStatuses).not.toHaveBeenCalled()
  })

  it('shows an empty state when nothing matches', async () => {
    mocks.queryStatuses.mockResolvedValue({ statuses: [] })
    const user = userEvent.setup()
    render(<ModerationStatusPage />)

    await user.click(screen.getByRole('button', { name: /查询/ }))
    expect(await screen.findByText('没有匹配的处置状态')).toBeInTheDocument()
  })

  it('shows a failure state and retries the query', async () => {
    mocks.queryStatuses.mockRejectedValueOnce(new AdminApiError('network', null))
    const user = userEvent.setup()
    render(<ModerationStatusPage />)

    await user.click(screen.getByRole('button', { name: /查询/ }))
    expect(await screen.findByText('处置状态查询失败')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(mocks.queryStatuses).toHaveBeenCalledTimes(2))
  })

  it('blocks readers without moderation access', async () => {
    mocks.permissions = []
    render(<ModerationStatusPage />)

    expect(await screen.findByText('没有查看处置状态的权限')).toBeInTheDocument()
    expect(mocks.queryStatuses).not.toHaveBeenCalled()
  })
})
