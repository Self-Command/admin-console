import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StatusView } from '@/lib/data/types'
import { AdminApiError } from '@/lib/api/admin-client'
import { AccountStatusPanel } from '@/components/directory/account-moderation'

const mocks = vi.hoisted(() => ({
  did: 'did:plc:alice7x4k2m6q3n5p4w',
  queryStatuses: vi.fn(),
}))

vi.mock('@/components/auth/auth-provider', () => ({
  useAuth: () => ({
    identity: {
      did: 'did:web:ops.selfcommand.example',
      role: 'admin',
      permissions: [],
    },
    callAdmin: vi.fn(),
  }),
}))

vi.mock('@/lib/data/use-data-provider', () => {
  const provider = {
    queryStatuses: mocks.queryStatuses,
  }
  return { useDataProvider: () => provider }
})

vi.mock('@/components/layout/workspace-provider', () => ({
  useWorkspace: () => ({
    pageSize: 10,
    dateFormat: 'date-time' as const,
  }),
}))

const status: StatusView = {
  id: 41,
  subject: mocks.did,
  subjectType: 'account',
  subjectHandle: 'alice.example.com',
  reviewState: 'escalated',
  takendown: true,
  muted: true,
  priorityScore: 80,
  lastReportedAt: '2026-10-20T03:00:00.000Z',
  lastReviewedAt: '2026-10-21T04:00:00.000Z',
  lastReviewedBy: 'did:plc:moderator7x4k2m6q3n5p4w',
  tags: ['spam', 'repeat'],
  createdAt: '2026-10-19T01:00:00.000Z',
  updatedAt: '2026-10-21T04:00:00.000Z',
}

const secondStatus: StatusView = {
  id: 42,
  subject: 'at://did:plc:alice7x4k2m6q3n5p4w/app.bsky.feed.post/3kabc',
  subjectType: 'record',
  reviewState: 'open',
  muted: true,
  createdAt: '2026-10-22T01:00:00.000Z',
  updatedAt: '2026-10-22T02:00:00.000Z',
}

function renderPanel() {
  return render(<AccountStatusPanel did={mocks.did} />)
}

describe('account status panel', () => {
  beforeEach(() => {
    mocks.queryStatuses.mockReset()
  })

  it('renders the status snapshot and paginates with the returned cursor', async () => {
    const user = userEvent.setup()
    mocks.queryStatuses
      .mockResolvedValueOnce({ statuses: [status], cursor: 'cursor-1' })
      .mockResolvedValueOnce({ statuses: [secondStatus] })
      .mockResolvedValue({ statuses: [status], cursor: 'cursor-1' })
    renderPanel()

    expect(await screen.findByText('已升级')).toBeInTheDocument()
    expect(screen.getByText('alice.example.com')).toBeInTheDocument()
    expect(screen.getByText('已下架')).toBeInTheDocument()
    expect(screen.getAllByText('禁言中')).toHaveLength(1)
    expect(screen.getByText('spam')).toBeInTheDocument()
    expect(screen.getByText('当前第 1 页，本页 1 条')).toBeInTheDocument()
    expect(mocks.queryStatuses).toHaveBeenCalledWith({
      subject: mocks.did,
      limit: 10,
      cursor: undefined,
    })

    await user.click(screen.getByRole('button', { name: '下一页' }))

    expect(await screen.findByText('待处理')).toBeInTheDocument()
    expect(screen.getByText('当前第 2 页，本页 1 条')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()
    expect(mocks.queryStatuses).toHaveBeenLastCalledWith({
      subject: mocks.did,
      limit: 10,
      cursor: 'cursor-1',
    })

    await user.click(screen.getByRole('button', { name: '上一页' }))

    await waitFor(() => expect(screen.getByText('已升级')).toBeInTheDocument())
    expect(mocks.queryStatuses).toHaveBeenLastCalledWith({
      subject: mocks.did,
      limit: 10,
      cursor: undefined,
    })
  })

  it('shows an empty state when the account has no status records', async () => {
    mocks.queryStatuses.mockResolvedValue({ statuses: [] })
    renderPanel()

    expect(await screen.findByText('暂无处置状态')).toBeInTheDocument()
    expect(
      screen.getByText('该账号在审核服务中还没有处置状态记录。产生举报或处置后会显示在这里。'),
    ).toBeInTheDocument()
  })

  it('shows a failure state and retries the query', async () => {
    const user = userEvent.setup()
    mocks.queryStatuses
      .mockRejectedValueOnce(new Error('upstream down'))
      .mockResolvedValueOnce({ statuses: [status] })
    renderPanel()

    expect(await screen.findByText('处置状态加载失败')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重试' }))

    expect(await screen.findByText('已升级')).toBeInTheDocument()
    expect(mocks.queryStatuses).toHaveBeenCalledTimes(2)
  })

  it('shows a permission notice when the API rejects the query with 403', async () => {
    mocks.queryStatuses.mockRejectedValue(new AdminApiError('forbidden', 403))
    renderPanel()

    expect(await screen.findByText('没有查看处置状态的权限')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument()
  })
})
