import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueueView } from '@/lib/data/types'
import { AdminApiError } from '@/lib/api/admin-client'
import QueuesPage from '@/app/(console)/moderation/queues/page'

const mocks = vi.hoisted(() => ({
  permissions: ['moderation.read', 'moderation.queue.manage'] as string[],
  listQueues: vi.fn(),
  actOnQueue: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
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
  useWorkspace: () => ({ pageSize: 10 }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

vi.mock('@/lib/data/use-data-provider', () => {
  const provider = {
    listQueues: mocks.listQueues,
    actOnQueue: mocks.actOnQueue,
  }
  return { useDataProvider: () => provider }
})

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub)

const queue: QueueView = {
  id: 1,
  name: '账号举报',
  description: '处理账号层面的举报',
  enabled: true,
  subjectTypes: ['account', 'record'],
  collection: 'app.bsky.feed.post',
  reportTypes: ['tools.ozone.report.defs#reasonSpam'],
  createdAt: '2026-10-20T02:00:00.000Z',
  updatedAt: '2026-10-28T03:00:00.000Z',
  stats: { pendingCount: 4, closedCount: 12 },
}

const disabledQueue: QueueView = {
  id: 2,
  name: '历史归档',
  enabled: false,
  createdAt: '2026-10-01T02:00:00.000Z',
  updatedAt: '2026-10-10T03:00:00.000Z',
}

describe('moderation queues page', () => {
  beforeEach(() => {
    mocks.permissions = ['moderation.read', 'moderation.queue.manage']
    mocks.listQueues.mockReset()
    mocks.actOnQueue.mockReset()
    mocks.toastSuccess.mockReset()
    mocks.toastError.mockReset()
    mocks.listQueues.mockResolvedValue({ queues: [queue, disabledQueue] })
    mocks.actOnQueue.mockResolvedValue({})
  })

  it('renders queue rows with rules, stats and asks for the first page', async () => {
    render(<QueuesPage />)

    const row = (await screen.findByText('账号举报')).closest('tr')
    if (!row) throw new Error('queue row not found')
    expect(within(row).getByText('已启用')).toBeInTheDocument()
    expect(within(row).getByText('账号')).toBeInTheDocument()
    expect(within(row).getByText('内容')).toBeInTheDocument()
    expect(within(row).getByText('集合 app.bsky.feed.post')).toBeInTheDocument()
    expect(within(row).getByText('垃圾信息')).toBeInTheDocument()
    expect(within(row).getByText('4')).toBeInTheDocument()
    expect(within(row).getByText('12')).toBeInTheDocument()

    const disabledRow = screen.getByText('历史归档').closest('tr')
    if (!disabledRow) throw new Error('disabled queue row not found')
    expect(within(disabledRow).getByText('已停用')).toBeInTheDocument()

    expect(mocks.listQueues).toHaveBeenCalledWith({
      cursor: undefined,
      limit: 10,
      enabled: undefined,
    })
  })

  it('disables queue management without the queue manage permission', async () => {
    mocks.permissions = ['moderation.read']
    render(<QueuesPage />)

    await screen.findByText('账号举报')

    expect(
      screen.getByText(
        '当前账号可以查看举报队列，但没有管理权限。如需新建、修改或删除队列，请联系管理员开通队列管理权限。',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新建队列' })).toBeDisabled()
    for (const button of screen.getAllByRole('button', { name: '管理' })) {
      expect(button).toBeDisabled()
    }
    expect(mocks.actOnQueue).not.toHaveBeenCalled()
  })

  it('requires a queue name before creating a queue', async () => {
    const user = userEvent.setup()
    render(<QueuesPage />)

    await screen.findByText('账号举报')
    await user.click(screen.getByRole('button', { name: '新建队列' }))

    const dialog = await screen.findByRole('dialog', { name: '新建举报队列' })
    await user.click(within(dialog).getByRole('button', { name: '创建队列' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('请填写队列名称。')
    expect(mocks.actOnQueue).not.toHaveBeenCalled()

    await user.type(within(dialog).getByLabelText('队列名称'), '诈骗举报')
    await user.click(within(dialog).getByRole('button', { name: '创建队列' }))

    await waitFor(() =>
      expect(mocks.actOnQueue).toHaveBeenCalledWith({
        action: 'create',
        name: '诈骗举报',
        enabled: true,
      }),
    )
    expect(mocks.toastSuccess).toHaveBeenCalledWith('举报队列已创建。')
    await waitFor(() => expect(mocks.listQueues).toHaveBeenCalledTimes(2))
  })

  it('asks for a migration target when deleting a non-empty queue', async () => {
    mocks.actOnQueue.mockRejectedValueOnce(new AdminApiError('conflict', 409, 'QueueNotEmpty'))
    const user = userEvent.setup()
    render(<QueuesPage />)

    const row = (await screen.findByText('账号举报')).closest('tr')
    if (!row) throw new Error('queue row not found')
    await user.click(within(row).getByRole('button', { name: '管理' }))
    await user.click(await screen.findByRole('menuitem', { name: '删除队列' }))

    const dialog = await screen.findByRole('dialog', { name: '删除举报队列' })
    expect(within(dialog).queryByRole('option', { name: '账号举报' })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '确认删除' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '该队列仍有待处理举报，请选择迁移目标队列后再删除。',
    )
    expect(mocks.actOnQueue).toHaveBeenCalledWith({ action: 'delete', queueId: 1 })
  })

  it('rejects an incomplete assignee account identifier', async () => {
    const user = userEvent.setup()
    render(<QueuesPage />)

    const row = (await screen.findByText('账号举报')).closest('tr')
    if (!row) throw new Error('queue row not found')
    await user.click(within(row).getByRole('button', { name: '管理' }))
    await user.click(await screen.findByRole('menuitem', { name: '指派审核员' }))

    const dialog = await screen.findByRole('dialog', { name: '指派审核员' })
    await user.type(within(dialog).getByLabelText('审核员账号标识'), 'moderator.example.com')
    await user.click(within(dialog).getByRole('button', { name: '确认指派' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '请填写完整的审核员账号标识，例如 did:plc:…',
    )
    expect(mocks.actOnQueue).not.toHaveBeenCalled()
  })

  it('filters queues by enabled state', async () => {
    mocks.listQueues
      .mockResolvedValueOnce({ queues: [queue, disabledQueue] })
      .mockResolvedValue({ queues: [disabledQueue] })
    const user = userEvent.setup()
    render(<QueuesPage />)

    await screen.findByText('账号举报')
    await user.selectOptions(
      screen.getByRole('combobox', { name: '按启用状态过滤' }),
      'enabled',
    )

    await waitFor(() =>
      expect(mocks.listQueues).toHaveBeenLastCalledWith(
        expect.objectContaining({ enabled: true, cursor: undefined }),
      ),
    )
    expect(await screen.findByText('历史归档')).toBeInTheDocument()
    expect(screen.queryByText('账号举报')).not.toBeInTheDocument()
  })

  it('loads the next page with the returned cursor', async () => {
    mocks.listQueues
      .mockResolvedValueOnce({ queues: [queue], cursor: 'cursor-2' })
      .mockResolvedValueOnce({ queues: [disabledQueue] })
    const user = userEvent.setup()
    render(<QueuesPage />)

    await screen.findByText('账号举报')
    await user.click(screen.getByRole('button', { name: '下一页' }))

    expect(await screen.findByText('历史归档')).toBeInTheDocument()
    expect(mocks.listQueues).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'cursor-2' }),
    )
  })

  it('reports failures and retries the request', async () => {
    mocks.listQueues.mockRejectedValueOnce(new AdminApiError('network', null))
    const user = userEvent.setup()
    render(<QueuesPage />)

    expect(await screen.findByText('举报队列加载失败')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /重试/ }))

    expect(await screen.findByText('账号举报')).toBeInTheDocument()
    expect(mocks.listQueues).toHaveBeenCalledTimes(2)
  })

  it('shows an actionable empty state when no queue exists', async () => {
    mocks.listQueues.mockResolvedValue({ queues: [] })
    render(<QueuesPage />)

    expect(await screen.findByText('暂无举报队列')).toBeInTheDocument()
    expect(
      screen.getByText('尚未创建举报队列。创建队列后，举报会按对象类型与举报类型自动分流。'),
    ).toBeInTheDocument()
  })

  it('explains when the reader lacks moderation.read', async () => {
    mocks.permissions = []
    render(<QueuesPage />)

    expect(await screen.findByText('没有查看举报队列的权限')).toBeInTheDocument()
    expect(mocks.listQueues).not.toHaveBeenCalled()
  })
})
