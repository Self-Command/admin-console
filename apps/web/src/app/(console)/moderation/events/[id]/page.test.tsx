import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminApiError } from '@/lib/api/admin-client'
import ModerationEventDetailPage from '@/app/(console)/moderation/events/[id]/page'

const mocks = vi.hoisted(() => ({
  permissions: ['moderation.read'] as string[],
  params: { id: '9001' } as { id: string },
  getEvent: vi.fn(),
  getEventBatch: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useParams: () => mocks.params,
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
  const provider = {
    getEvent: mocks.getEvent,
    getEventBatch: mocks.getEventBatch,
  }
  return { useDataProvider: () => provider }
})

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub)

const RAW_EVENT = {
  id: 9001,
  event: {
    $type: 'tools.ozone.moderation.defs#modEventTakedown',
    comment: '多次发布违规内容',
    durationInHours: 72,
    batchId: 'batch-2026-10-30',
    approvalId: 'ap-9001',
  },
  subject: { did: 'did:plc:target' },
  createdBy: 'did:plc:moderator',
  creatorHandle: 'moderator.example.com',
  createdAt: '2026-10-30T02:00:00.000Z',
}

describe('moderation event detail page', () => {
  beforeEach(() => {
    mocks.permissions = ['moderation.read']
    mocks.params = { id: '9001' }
    mocks.getEvent.mockReset()
    mocks.getEventBatch.mockReset()
    mocks.getEvent.mockResolvedValue({ event: RAW_EVENT })
    mocks.getEventBatch.mockResolvedValue({
      batchId: 'batch-2026-10-30',
      totalEvents: 3,
      scannedEvents: 3,
      truncated: false,
      createdAfter: '2026-10-30T02:00:00.000Z',
      createdBefore: '2026-10-30T03:00:00.000Z',
      typeCounts: [
        { eventType: 'modEventTakedown', count: 1 },
        { eventType: 'modEventComment', count: 2 },
      ],
      createdBy: ['did:plc:moderator'],
    })
  })

  it('renders the event, approval, reversibility and batch summary', async () => {
    render(<ModerationEventDetailPage />)

    expect(await screen.findByText('处置记录 #9001')).toBeInTheDocument()
    expect(screen.getAllByText('下架处置').length).toBeGreaterThan(0)
    expect(screen.getByText('多次发布违规内容')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /did:plc:target/ }),
    ).toHaveAttribute('href', `/directory/${encodeURIComponent('did:plc:target')}`)
    expect(screen.getByText('ap-9001')).toBeInTheDocument()
    expect(screen.getByText(/该处置可逆/)).toBeInTheDocument()

    await waitFor(() =>
      expect(mocks.getEventBatch).toHaveBeenCalledWith('batch-2026-10-30'),
    )
    expect(await screen.findByText('事件数量：3 条')).toBeInTheDocument()
    expect(screen.getByText('下架处置 × 1')).toBeInTheDocument()
    expect(screen.getByText('添加备注 × 2')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: '查看批次内全部记录' }),
    ).toHaveAttribute(
      'href',
      `/moderation/events?batchId=${encodeURIComponent('batch-2026-10-30')}`,
    )
  })

  it('shows a not-found state for missing records', async () => {
    mocks.getEvent.mockRejectedValue(new AdminApiError('not_found', 404))
    render(<ModerationEventDetailPage />)

    expect(await screen.findByText('处置记录不存在')).toBeInTheDocument()
    expect(mocks.getEventBatch).not.toHaveBeenCalled()
  })

  it('shows a forbidden state without moderation access', async () => {
    mocks.permissions = []
    render(<ModerationEventDetailPage />)

    expect(await screen.findByText('没有查看处置记录的权限')).toBeInTheDocument()
    expect(mocks.getEvent).not.toHaveBeenCalled()
  })

  it('shows a forbidden state when the API rejects the request', async () => {
    mocks.getEvent.mockRejectedValue(new AdminApiError('forbidden', 403))
    render(<ModerationEventDetailPage />)

    expect(await screen.findByText('没有查看该记录的权限')).toBeInTheDocument()
  })

  it('rejects malformed identifiers without calling the API', async () => {
    mocks.params = { id: 'abc' }
    render(<ModerationEventDetailPage />)

    expect(await screen.findByText('处置记录编号无效')).toBeInTheDocument()
    expect(mocks.getEvent).not.toHaveBeenCalled()
  })
})
