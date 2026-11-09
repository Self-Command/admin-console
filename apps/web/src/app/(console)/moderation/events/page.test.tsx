import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventView } from '@/lib/data/types'
import { AdminApiError } from '@/lib/api/admin-client'
import ModerationEventsPage from '@/app/(console)/moderation/events/page'

const mocks = vi.hoisted(() => ({
  permissions: ['moderation.read'] as string[],
  listEvents: vi.fn(),
  getEvent: vi.fn(),
  getEventBatch: vi.fn(),
  actOnSubjects: vi.fn(),
  createApproval: vi.fn(),
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
    listEvents: mocks.listEvents,
    getEvent: mocks.getEvent,
    getEventBatch: mocks.getEventBatch,
    actOnSubjects: mocks.actOnSubjects,
    createApproval: mocks.createApproval,
  }
  return { useDataProvider: () => provider }
})

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub)

const event: EventView = {
  id: 9001,
  eventType: 'modEventTakedown',
  subject: 'did:plc:alice7x4k2m6q3n5p4w',
  subjectType: 'account',
  subjectHandle: 'alice.example.com',
  createdBy: 'did:web:moderation.selfcommand.example',
  creatorHandle: 'moderator.example.com',
  createdAt: '2026-10-28T02:00:00.000Z',
  comment: '屡次发布违规内容',
  reportId: 4321,
  durationInHours: 24,
  labels: ['spam'],
}

const secondEvent: EventView = {
  ...event,
  id: 9002,
  eventType: 'modEventLabel',
  subject: 'at://did:plc:bob/app.bsky.feed.post/3kxyz',
  subjectType: 'record',
  subjectHandle: undefined,
  comment: undefined,
  reportId: undefined,
  durationInHours: undefined,
  labels: undefined,
}

describe('moderation events page', () => {
  beforeEach(() => {
    mocks.permissions = ['moderation.read']
    mocks.listEvents.mockReset()
    mocks.getEvent.mockReset()
    mocks.getEventBatch.mockReset()
    mocks.actOnSubjects.mockReset()
    mocks.createApproval.mockReset()
    mocks.listEvents.mockResolvedValue({ events: [event] })
    mocks.getEvent.mockResolvedValue({
      event: { id: 9001, eventType: 'modEventTakedown', subject: event.subject },
    })
  })

  afterEach(() => {
    window.history.replaceState({}, '', '/moderation/events')
  })

  it('renders the event timeline and requests the newest page', async () => {
    render(<ModerationEventsPage />)

    const row = (await screen.findByText('#9001')).closest('tr')
    if (!row) throw new Error('event row not found')
    expect(within(row).getByText('下架处置')).toBeInTheDocument()
    expect(within(row).getByText('modEventTakedown')).toBeInTheDocument()
    expect(within(row).getByText('alice.example.com')).toBeInTheDocument()
    expect(within(row).getByText('账号')).toBeInTheDocument()
    expect(within(row).getByText('屡次发布违规内容')).toBeInTheDocument()
    expect(within(row).getByTitle(event.subject)).toHaveAttribute(
      'href',
      `/directory/${encodeURIComponent(event.subject)}`,
    )

    expect(mocks.listEvents).toHaveBeenCalledWith({
      cursor: undefined,
      limit: 10,
      subject: undefined,
      createdBy: undefined,
      comment: undefined,
      types: undefined,
      hasComment: undefined,
      direction: 'desc',
      batchId: undefined,
    })
  })

  it('filters by the batch in the URL and renders its summary', async () => {
    window.history.replaceState({}, '', '/moderation/events?batchId=batch-2026-10-30')
    mocks.getEventBatch.mockResolvedValue({
      batchId: 'batch-2026-10-30',
      totalEvents: 2,
      scannedEvents: 2,
      truncated: false,
      typeCounts: [{ eventType: 'modEventTakedown', count: 2 }],
    })
    render(<ModerationEventsPage />)

    expect(await screen.findByText('批次 batch-2026-10-30')).toBeInTheDocument()
    expect(await screen.findByText(/共 2 条事件/)).toBeInTheDocument()
    expect(mocks.getEventBatch).toHaveBeenCalledWith('batch-2026-10-30')
    expect(mocks.listEvents).toHaveBeenCalledWith(
      expect.objectContaining({ batchId: 'batch-2026-10-30' }),
    )
  })

  it('rejects an invalid subject or actor filter before querying', async () => {
    const user = userEvent.setup()
    render(<ModerationEventsPage />)

    await screen.findByText('#9001')

    const subjectInput = screen.getByLabelText('按处置对象过滤')
    const subjectForm = subjectInput.closest('form')
    if (!subjectForm) throw new Error('subject form not found')
    await user.type(subjectInput, 'not-a-subject')
    await user.click(within(subjectForm).getByRole('button', { name: '应用' }))

    expect(
      screen.getByText('请输入账号标识或内容地址，例如 did:plc:… 或 at://…'),
    ).toBeInTheDocument()

    const actorInput = screen.getByLabelText('按操作人过滤')
    const actorForm = actorInput.closest('form')
    if (!actorForm) throw new Error('actor form not found')
    await user.type(actorInput, 'moderator.example.com')
    await user.click(within(actorForm).getByRole('button', { name: '应用' }))

    expect(screen.getByText('请输入完整的账号标识，例如 did:plc:…')).toBeInTheDocument()
    expect(mocks.listEvents).toHaveBeenCalledTimes(1)
  })

  it('applies subject, keyword, type, comment and order filters on the server', async () => {
    const user = userEvent.setup()
    render(<ModerationEventsPage />)

    await screen.findByText('#9001')

    const subjectInput = screen.getByLabelText('按处置对象过滤')
    const subjectForm = subjectInput.closest('form')
    if (!subjectForm) throw new Error('subject form not found')
    await user.type(subjectInput, event.subject)
    await user.click(within(subjectForm).getByRole('button', { name: '应用' }))
    await waitFor(() =>
      expect(mocks.listEvents).toHaveBeenLastCalledWith(
        expect.objectContaining({ subject: event.subject }),
      ),
    )

    await user.type(screen.getByLabelText('按处置说明过滤'), '违规')
    const commentForm = screen.getByLabelText('按处置说明过滤').closest('form')
    if (!commentForm) throw new Error('comment form not found')
    await user.click(within(commentForm).getByRole('button', { name: '应用' }))
    await waitFor(() =>
      expect(mocks.listEvents).toHaveBeenLastCalledWith(
        expect.objectContaining({ comment: '违规' }),
      ),
    )

    await user.selectOptions(
      screen.getByRole('combobox', { name: '按事件类型过滤' }),
      'modEventTakedown',
    )
    await waitFor(() =>
      expect(mocks.listEvents).toHaveBeenLastCalledWith(
        expect.objectContaining({ types: ['modEventTakedown'] }),
      ),
    )

    await user.selectOptions(
      screen.getByRole('combobox', { name: '按是否有说明过滤' }),
      'with',
    )
    await waitFor(() =>
      expect(mocks.listEvents).toHaveBeenLastCalledWith(
        expect.objectContaining({ hasComment: true }),
      ),
    )

    await user.selectOptions(screen.getByRole('combobox', { name: '排序方式' }), 'asc')
    await waitFor(() =>
      expect(mocks.listEvents).toHaveBeenLastCalledWith(
        expect.objectContaining({ direction: 'asc' }),
      ),
    )
  })

  it('shows the empty state and clears every filter', async () => {
    mocks.listEvents.mockResolvedValue({ events: [] })
    const user = userEvent.setup()
    render(<ModerationEventsPage />)

    expect(await screen.findByText('没有匹配的处置记录')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '清空过滤条件' }),
    ).not.toBeInTheDocument()

    const subjectInput = screen.getByLabelText('按处置对象过滤')
    const subjectForm = subjectInput.closest('form')
    if (!subjectForm) throw new Error('subject form not found')
    await user.type(subjectInput, event.subject)
    await user.click(within(subjectForm).getByRole('button', { name: '应用' }))

    await user.click(await screen.findByRole('button', { name: '清空过滤条件' }))

    await waitFor(() =>
      expect(mocks.listEvents).toHaveBeenLastCalledWith(
        expect.objectContaining({ subject: undefined, types: undefined }),
      ),
    )
    expect(screen.getByLabelText('按处置对象过滤')).toHaveValue('')
    expect(screen.queryByRole('button', { name: '清空过滤条件' })).not.toBeInTheDocument()
  })

  it('reports failures and retries the request', async () => {
    mocks.listEvents.mockRejectedValueOnce(new AdminApiError('network', null))
    const user = userEvent.setup()
    render(<ModerationEventsPage />)

    expect(await screen.findByText('处置记录加载失败')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /重试/ }))

    expect(await screen.findByText('#9001')).toBeInTheDocument()
    expect(mocks.listEvents).toHaveBeenCalledTimes(2)
  })

  it('loads the next page with the returned cursor', async () => {
    mocks.listEvents
      .mockResolvedValueOnce({ events: [event], cursor: 'cursor-2' })
      .mockResolvedValueOnce({ events: [secondEvent] })
    const user = userEvent.setup()
    render(<ModerationEventsPage />)

    await screen.findByText('#9001')
    await user.click(screen.getByRole('button', { name: '下一页' }))

    expect(await screen.findByText('#9002')).toBeInTheDocument()
    expect(mocks.listEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'cursor-2' }),
    )
  })

  it('opens the read-only detail dialog with the raw record', async () => {
    const user = userEvent.setup()
    render(<ModerationEventsPage />)

    await screen.findByText('#9001')
    await user.click(screen.getByRole('button', { name: '详情' }))

    const dialog = await screen.findByRole('dialog', { name: '处置记录详情' })
    expect(mocks.getEvent).toHaveBeenCalledWith(9001)
    expect(await within(dialog).findByText(/"eventType": "modEventTakedown"/)).toBeInTheDocument()
    expect(within(dialog).getByText('24 小时')).toBeInTheDocument()
    expect(within(dialog).getByText('#4321')).toBeInTheDocument()
    expect(within(dialog).queryByText('对对象执行处置')).not.toBeInTheDocument()
  })

  it('offers a moderation action from the detail dialog for writers', async () => {
    mocks.permissions = ['moderation.read', 'moderation.write']
    const user = userEvent.setup()
    render(<ModerationEventsPage />)

    await screen.findByText('#9001')
    await user.click(screen.getByRole('button', { name: '详情' }))

    const detail = await screen.findByRole('dialog', { name: '处置记录详情' })
    expect(within(detail).getByText('对对象执行处置')).toBeInTheDocument()
    await user.click(within(detail).getByRole('button', { name: '执行下架处置' }))

    const actionDialog = await screen.findByRole('dialog', { name: '下架处置' })
    expect(within(actionDialog).getByLabelText('处置说明')).toBeInTheDocument()
    expect(
      within(actionDialog).getByText('对象将从客户端移除，需要他人审批后执行。'),
    ).toBeInTheDocument()
  })

  it('explains when the reader lacks moderation.read', async () => {
    mocks.permissions = []
    render(<ModerationEventsPage />)

    expect(await screen.findByText('没有查看处置记录的权限')).toBeInTheDocument()
    expect(mocks.listEvents).not.toHaveBeenCalled()
  })
})
