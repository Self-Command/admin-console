import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduledActionView } from '@/lib/data/types'
import { AdminApiError } from '@/lib/api/admin-client'
import ScheduledActionsPage from '@/app/(console)/moderation/scheduled/page'

const mocks = vi.hoisted(() => ({
  permissions: ['moderation.read', 'moderation.write'] as string[],
  listScheduledActions: vi.fn(),
  cancelScheduledActions: vi.fn(),
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
    listScheduledActions: mocks.listScheduledActions,
    cancelScheduledActions: mocks.cancelScheduledActions,
  }
  return { useDataProvider: () => provider }
})

const pendingAction: ScheduledActionView = {
  id: 7001,
  action: 'takedown',
  subject: 'did:plc:alice7x4k2m6q3n5p4w',
  status: 'pending',
  executeAt: '2026-10-30T02:00:00.000Z',
  comment: '等待复核后执行',
  createdBy: 'did:web:moderation.selfcommand.example',
  createdAt: '2026-10-29T02:00:00.000Z',
}

const failedAction: ScheduledActionView = {
  id: 7002,
  action: 'mute',
  subject: 'at://did:plc:bob/app.bsky.feed.post/3kxyz',
  status: 'failed',
  executeAfter: '2026-10-29T05:00:00.000Z',
  lastFailureReason: '执行时对象已被删除',
  createdBy: 'did:web:moderation.selfcommand.example',
  createdAt: '2026-10-29T02:00:00.000Z',
}

describe('scheduled actions page', () => {
  beforeEach(() => {
    mocks.permissions = ['moderation.read', 'moderation.write']
    mocks.listScheduledActions.mockReset()
    mocks.cancelScheduledActions.mockReset()
    mocks.toastSuccess.mockReset()
    mocks.toastError.mockReset()
    mocks.listScheduledActions.mockResolvedValue({
      actions: [pendingAction, failedAction],
    })
    mocks.cancelScheduledActions.mockResolvedValue({})
  })

  it('renders pending and finished actions with the default status filter', async () => {
    render(<ScheduledActionsPage />)

    const pendingRow = (await screen.findByText('#7001')).closest('tr')
    if (!pendingRow) throw new Error('pending row not found')
    expect(within(pendingRow).getByText('下架处置')).toBeInTheDocument()
    expect(within(pendingRow).getByText('待执行')).toBeInTheDocument()
    expect(within(pendingRow).getByText('等待复核后执行')).toBeInTheDocument()
    expect(within(pendingRow).getByTitle(pendingAction.subject)).toHaveAttribute(
      'href',
      `/directory/${encodeURIComponent(pendingAction.subject)}`,
    )
    expect(within(pendingRow).getByRole('button', { name: '取消' })).toBeEnabled()

    const failedRow = screen.getByText('#7002').closest('tr')
    if (!failedRow) throw new Error('failed row not found')
    expect(within(failedRow).getByText('禁言')).toBeInTheDocument()
    expect(within(failedRow).getByText('执行失败')).toBeInTheDocument()
    expect(within(failedRow).getByText('执行时对象已被删除')).toBeInTheDocument()
    expect(within(failedRow).queryByRole('button', { name: '取消' })).not.toBeInTheDocument()

    expect(screen.getByRole('combobox', { name: '按状态过滤' })).toHaveValue('pending')
    expect(mocks.listScheduledActions).toHaveBeenCalledWith({
      cursor: undefined,
      limit: 10,
      statuses: ['pending'],
      subjects: undefined,
    })
  })

  it('disables cancellation without the moderation write permission', async () => {
    mocks.permissions = ['moderation.read']
    render(<ScheduledActionsPage />)

    await screen.findByText('#7001')
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled()
  })

  it('cancels a pending action with an optional explanation', async () => {
    const user = userEvent.setup()
    render(<ScheduledActionsPage />)

    await screen.findByText('#7001')
    await user.click(screen.getByRole('button', { name: '取消' }))

    const dialog = await screen.findByRole('dialog', { name: '取消定时处置' })
    expect(within(dialog).getByText(pendingAction.subject)).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('取消说明（可选）'), '计划已调整')
    await user.click(within(dialog).getByRole('button', { name: '确认取消' }))

    await waitFor(() =>
      expect(mocks.cancelScheduledActions).toHaveBeenCalledWith({
        subjects: [pendingAction.subject],
        comment: '计划已调整',
      }),
    )
    expect(mocks.toastSuccess).toHaveBeenCalledWith('已取消该对象的定时处置。')
    await waitFor(() => expect(mocks.listScheduledActions).toHaveBeenCalledTimes(2))
  })

  it('rejects an invalid subject filter before querying', async () => {
    const user = userEvent.setup()
    render(<ScheduledActionsPage />)

    await screen.findByText('#7001')

    const input = screen.getByLabelText('按处置对象过滤')
    const form = input.closest('form')
    if (!form) throw new Error('subject form not found')
    await user.type(input, 'not-a-subject')
    await user.click(within(form).getByRole('button', { name: '应用' }))

    expect(
      screen.getByText('请输入账号标识或内容地址，例如 did:plc:… 或 at://…'),
    ).toBeInTheDocument()
    expect(mocks.listScheduledActions).toHaveBeenCalledTimes(1)
  })

  it('filters by status and subject on the server', async () => {
    const user = userEvent.setup()
    render(<ScheduledActionsPage />)

    await screen.findByText('#7001')

    await user.selectOptions(screen.getByRole('combobox', { name: '按状态过滤' }), 'failed')
    await waitFor(() =>
      expect(mocks.listScheduledActions).toHaveBeenLastCalledWith(
        expect.objectContaining({ statuses: ['failed'] }),
      ),
    )

    const input = screen.getByLabelText('按处置对象过滤')
    const form = input.closest('form')
    if (!form) throw new Error('subject form not found')
    await user.type(input, pendingAction.subject)
    await user.click(within(form).getByRole('button', { name: '应用' }))

    await waitFor(() =>
      expect(mocks.listScheduledActions).toHaveBeenLastCalledWith(
        expect.objectContaining({
          statuses: ['failed'],
          subjects: [pendingAction.subject],
        }),
      ),
    )
  })

  it('shows the empty state and clears every filter', async () => {
    mocks.listScheduledActions.mockResolvedValue({ actions: [] })
    const user = userEvent.setup()
    render(<ScheduledActionsPage />)

    expect(await screen.findByText('没有匹配的定时处置')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '清空过滤条件' }),
    ).not.toBeInTheDocument()

    const input = screen.getByLabelText('按处置对象过滤')
    const form = input.closest('form')
    if (!form) throw new Error('subject form not found')
    await user.type(input, pendingAction.subject)
    await user.click(within(form).getByRole('button', { name: '应用' }))

    await user.click(await screen.findByRole('button', { name: '清空过滤条件' }))

    await waitFor(() =>
      expect(mocks.listScheduledActions).toHaveBeenLastCalledWith(
        expect.objectContaining({ statuses: ['pending'], subjects: undefined }),
      ),
    )
    expect(screen.getByLabelText('按处置对象过滤')).toHaveValue('')
  })

  it('reports failures and retries the request', async () => {
    mocks.listScheduledActions.mockRejectedValueOnce(new AdminApiError('network', null))
    const user = userEvent.setup()
    render(<ScheduledActionsPage />)

    expect(await screen.findByText('定时处置加载失败')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /重试/ }))

    expect(await screen.findByText('#7001')).toBeInTheDocument()
    expect(mocks.listScheduledActions).toHaveBeenCalledTimes(2)
  })

  it('loads the next page with the returned cursor', async () => {
    mocks.listScheduledActions
      .mockResolvedValueOnce({ actions: [pendingAction], cursor: 'cursor-2' })
      .mockResolvedValueOnce({ actions: [failedAction] })
    const user = userEvent.setup()
    render(<ScheduledActionsPage />)

    await screen.findByText('#7001')
    await user.click(screen.getByRole('button', { name: '下一页' }))

    expect(await screen.findByText('#7002')).toBeInTheDocument()
    expect(mocks.listScheduledActions).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'cursor-2' }),
    )
  })

  it('explains when the reader lacks moderation.read', async () => {
    mocks.permissions = []
    render(<ScheduledActionsPage />)

    expect(await screen.findByText('没有查看定时处置的权限')).toBeInTheDocument()
    expect(mocks.listScheduledActions).not.toHaveBeenCalled()
  })
})
