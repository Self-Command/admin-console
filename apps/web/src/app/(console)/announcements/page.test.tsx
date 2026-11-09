import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminApiError } from '@/lib/api/admin-client'
import type { AnnouncementView } from '@/lib/data/types'
import AnnouncementsPage from '@/app/(console)/announcements/page'

const mocks = vi.hoisted(() => ({
  permissions: [
    'announcement.read',
    'announcement.write',
    'announcement.publish',
  ] as string[],
  listAnnouncements: vi.fn(),
  createAnnouncement: vi.fn(),
  updateAnnouncement: vi.fn(),
  publishAnnouncement: vi.fn(),
  archiveAnnouncement: vi.fn(),
  createApproval: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
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
  useWorkspace: () => ({ pageSize: 10, dateFormat: 'date-time' as const }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
    warning: mocks.toastWarning,
  },
}))

vi.mock('@/lib/data/use-data-provider', () => {
  const provider = {
    listAnnouncements: mocks.listAnnouncements,
    createAnnouncement: mocks.createAnnouncement,
    updateAnnouncement: mocks.updateAnnouncement,
    publishAnnouncement: mocks.publishAnnouncement,
    archiveAnnouncement: mocks.archiveAnnouncement,
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

const draft: AnnouncementView = {
  id: 1,
  title: '客户端升级说明',
  body: '请在本周内完成客户端升级。',
  level: 'info',
  placement: 'app',
  status: 'draft',
  createdAt: '2026-10-28T01:00:00.000Z',
  updatedAt: '2026-10-28T01:00:00.000Z',
}

const published: AnnouncementView = {
  ...draft,
  id: 2,
  title: '系统维护通知',
  level: 'warning',
  placement: 'admin',
  status: 'published',
  startsAt: '2026-10-30T14:00:00.000Z',
  endsAt: '2026-10-30T16:00:00.000Z',
  publishedBy: 'did:web:ops.selfcommand.example',
}

describe('announcements page', () => {
  beforeEach(() => {
    mocks.permissions = [
      'announcement.read',
      'announcement.write',
      'announcement.publish',
    ]
    mocks.listAnnouncements.mockReset()
    mocks.createAnnouncement.mockReset()
    mocks.updateAnnouncement.mockReset()
    mocks.publishAnnouncement.mockReset()
    mocks.archiveAnnouncement.mockReset()
    mocks.createApproval.mockReset()
    mocks.toastSuccess.mockReset()
    mocks.toastError.mockReset()
    mocks.toastWarning.mockReset()

    mocks.listAnnouncements.mockResolvedValue({
      announcements: [draft, published],
      total: 2,
    })
  })

  it('lists announcements with level, placement and status', async () => {
    render(<AnnouncementsPage />)

    const draftRow = (await screen.findByText('客户端升级说明')).closest('tr')
    if (!draftRow) throw new Error('draft row not found')
    expect(within(draftRow).getByText('草稿')).toBeInTheDocument()
    expect(within(draftRow).getByText('通知')).toBeInTheDocument()

    const publishedRow = screen.getByText('系统维护通知').closest('tr')
    if (!publishedRow) throw new Error('published row not found')
    expect(within(publishedRow).getByText('已发布')).toBeInTheDocument()

    expect(mocks.listAnnouncements).toHaveBeenCalledWith({ limit: 10 })
  })

  it('applies status and keyword filters through the list query', async () => {
    const user = userEvent.setup()
    render(<AnnouncementsPage />)

    await screen.findByText('客户端升级说明')
    await user.selectOptions(screen.getByLabelText('公告状态'), 'draft')
    await user.type(screen.getByLabelText('公告关键词'), '升级')
    await user.click(screen.getByRole('button', { name: '查询' }))

    await waitFor(() =>
      expect(mocks.listAnnouncements).toHaveBeenLastCalledWith({
        limit: 10,
        status: 'draft',
        q: '升级',
      }),
    )
  })

  it('creates a draft announcement and reloads the list', async () => {
    mocks.createAnnouncement.mockResolvedValue({ announcement: draft })
    const user = userEvent.setup()
    render(<AnnouncementsPage />)

    await screen.findByText('客户端升级说明')
    await user.click(screen.getByRole('button', { name: '新建公告' }))

    const dialog = await screen.findByRole('dialog', { name: '新建公告草稿' })
    await user.type(within(dialog).getByLabelText('公告标题'), '春节服务安排')
    await user.type(
      within(dialog).getByLabelText('公告正文'),
      '春节期间审核服务保持正常运行。',
    )
    await user.selectOptions(within(dialog).getByLabelText('公告级别'), 'critical')
    await user.selectOptions(within(dialog).getByLabelText('展示位置'), 'admin')
    await user.click(within(dialog).getByRole('button', { name: '保存草稿' }))

    await waitFor(() =>
      expect(mocks.createAnnouncement).toHaveBeenCalledWith({
        title: '春节服务安排',
        body: '春节期间审核服务保持正常运行。',
        level: 'critical',
        placement: 'admin',
      }),
    )
    await waitFor(() => expect(mocks.listAnnouncements).toHaveBeenCalledTimes(2))
    expect(mocks.toastSuccess).toHaveBeenCalledWith('公告草稿已创建，可在列表中发布。')
  })

  it('edits an existing draft with its time window', async () => {
    mocks.updateAnnouncement.mockResolvedValue({ announcement: draft })
    const user = userEvent.setup()
    render(<AnnouncementsPage />)

    const row = (await screen.findByText('客户端升级说明')).closest('tr')
    if (!row) throw new Error('draft row not found')
    await user.click(within(row).getByRole('button', { name: '编辑' }))

    const dialog = await screen.findByRole('dialog', { name: '编辑公告草稿' })
    const title = within(dialog).getByLabelText('公告标题')
    await user.clear(title)
    await user.type(title, '客户端升级说明（修订）')
    await user.click(within(dialog).getByRole('button', { name: '保存草稿' }))

    await waitFor(() =>
      expect(mocks.updateAnnouncement).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          title: '客户端升级说明（修订）',
          body: '请在本周内完成客户端升级。',
          level: 'info',
          placement: 'app',
        }),
      ),
    )
  })

  it('converts a publish rejection into an approval request', async () => {
    mocks.publishAnnouncement.mockRejectedValue(
      new AdminApiError('conflict', 409, 'ApprovalRequired'),
    )
    mocks.createApproval.mockResolvedValue({
      id: 'ap-announce-1',
      action: 'announcement.publish',
      status: 'pending',
      requestedBy: 'did:web:ops.selfcommand.example',
      requestedAt: '2026-10-30T01:00:00.000Z',
      expiresAt: '2026-10-31T01:00:00.000Z',
    })
    const user = userEvent.setup()
    render(<AnnouncementsPage />)

    const row = (await screen.findByText('客户端升级说明')).closest('tr')
    if (!row) throw new Error('draft row not found')
    await user.click(within(row).getByRole('button', { name: '发布' }))

    const confirm = await screen.findByRole('alertdialog')
    await user.click(within(confirm).getByRole('button', { name: '确认发布' }))

    await waitFor(() =>
      expect(mocks.publishAnnouncement).toHaveBeenCalledWith({ id: 1 }),
    )

    const approvalDialog = await screen.findByRole('dialog', {
      name: '发起审批请求',
    })
    expect(
      within(approvalDialog).getByText('发布公告「客户端升级说明」'),
    ).toBeInTheDocument()
    await user.click(
      within(approvalDialog).getByRole('button', { name: '发起审批请求' }),
    )

    await waitFor(() =>
      expect(mocks.createApproval).toHaveBeenCalledWith({
        action: 'announcement.publish',
        targetType: 'announcement',
        target: '1',
        summary: '发布公告「客户端升级说明」',
        payload: { announcementId: 1 },
      }),
    )
    expect(
      await within(approvalDialog).findByText(/审批请求已创建/),
    ).toBeInTheDocument()
  })

  it('archives a published announcement after confirmation', async () => {
    mocks.archiveAnnouncement.mockResolvedValue({
      announcement: { ...published, status: 'archived' },
    })
    const user = userEvent.setup()
    render(<AnnouncementsPage />)

    const row = (await screen.findByText('系统维护通知')).closest('tr')
    if (!row) throw new Error('published row not found')
    await user.click(within(row).getByRole('button', { name: '下线' }))

    const confirm = await screen.findByRole('alertdialog')
    await user.click(within(confirm).getByRole('button', { name: '确认下线' }))

    await waitFor(() =>
      expect(mocks.archiveAnnouncement).toHaveBeenCalledWith({ id: 2 }),
    )
    await waitFor(() => expect(mocks.listAnnouncements).toHaveBeenCalledTimes(2))
    expect(mocks.toastSuccess).toHaveBeenCalledWith('公告已下线。')
  })

  it('validates the draft form before submitting', async () => {
    const user = userEvent.setup()
    render(<AnnouncementsPage />)

    await screen.findByText('客户端升级说明')
    await user.click(screen.getByRole('button', { name: '新建公告' }))
    const dialog = await screen.findByRole('dialog', { name: '新建公告草稿' })
    await user.click(within(dialog).getByRole('button', { name: '保存草稿' }))

    expect(within(dialog).getByRole('alert')).toHaveTextContent('请填写公告标题。')
    expect(mocks.createAnnouncement).not.toHaveBeenCalled()
  })

  it('explains that readers can only browse announcements', async () => {
    mocks.permissions = ['announcement.read']
    render(<AnnouncementsPage />)

    expect(await screen.findByText('客户端升级说明')).toBeInTheDocument()
    expect(
      screen.getByText(/当前账号只有查看权限/),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '新建公告' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '发布' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '下线' })).not.toBeInTheDocument()
  })

  it('explains when the reader lacks announcement.read', async () => {
    mocks.permissions = []
    render(<AnnouncementsPage />)

    expect(await screen.findByText('没有查看站内公告的权限')).toBeInTheDocument()
    expect(mocks.listAnnouncements).not.toHaveBeenCalled()
  })
})
