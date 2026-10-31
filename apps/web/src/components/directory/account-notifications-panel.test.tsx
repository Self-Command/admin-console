import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountNotificationsPanel } from '@/components/directory/account-notifications-panel'
import type {
  InboxNotification,
  InboxNotificationPreferences,
  InboxUnreadCounts,
} from '@/lib/data/types'
import { truncateDid } from '@/lib/format'

const mocks = vi.hoisted(() => ({
  did: 'did:plc:alice7x4k2m6q3n5p4w',
  getInboxUnreadCounts: vi.fn(),
  getInboxNotificationPreferences: vi.fn(),
  listInboxNotifications: vi.fn(),
}))

vi.mock('@/lib/data/use-data-provider', () => {
  const provider = {
    getInboxUnreadCounts: mocks.getInboxUnreadCounts,
    getInboxNotificationPreferences: mocks.getInboxNotificationPreferences,
    listInboxNotifications: mocks.listInboxNotifications,
  }
  return { useDataProvider: () => provider }
})

const counts: InboxUnreadCounts = {
  total: 6,
  reports: 3,
  subjects: 2,
}

const preferences: InboxNotificationPreferences = {
  reports: true,
  account: false,
  labels: true,
}

const reportNotification: InboxNotification = {
  id: 101,
  reason: 'reportResolved',
  section: 'reports',
  target: { type: 'report', reportId: 42 },
  isRead: false,
  createdAt: '2026-10-28T02:00:00.000Z',
}

const subjectNotification: InboxNotification = {
  id: 102,
  reason: 'actionTaken',
  section: 'subjects',
  target: { type: 'subject', subject: 'did:plc:abcdefghijklmnopqrstuvwxyz234567' },
  isRead: true,
  createdAt: '2026-10-27T08:30:00.000Z',
}

const standingNotification: InboxNotification = {
  id: 103,
  reason: 'standingChanged',
  section: 'accountStatus',
  target: { type: 'standing', standing: '受限', previousStanding: '正常' },
  isRead: false,
  createdAt: '2026-10-26T10:00:00.000Z',
}

const unknownNotification: InboxNotification = {
  id: 104,
  reason: 'unexpectedReason',
  target: { type: 'unknown' },
  isRead: true,
  createdAt: '2026-10-25T09:15:00.000Z',
}

function renderPanel() {
  return render(<AccountNotificationsPanel did={mocks.did} />)
}

describe('account notifications panel', () => {
  beforeEach(() => {
    mocks.getInboxUnreadCounts.mockReset()
    mocks.getInboxNotificationPreferences.mockReset()
    mocks.listInboxNotifications.mockReset()
    mocks.getInboxUnreadCounts.mockResolvedValue(counts)
    mocks.getInboxNotificationPreferences.mockResolvedValue(preferences)
    mocks.listInboxNotifications.mockResolvedValue({
      notifications: [reportNotification],
    })
  })

  it('renders unread counts and read-only notification preferences', async () => {
    renderPanel()

    expect(await screen.findByText('未读数量')).toBeInTheDocument()
    expect(screen.getByText('6')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('未读数量由审核服务统计。')).toBeInTheDocument()

    expect(screen.getByText('举报通知')).toBeInTheDocument()
    expect(screen.getByText('账号通知')).toBeInTheDocument()
    expect(screen.getByText('标签通知')).toBeInTheDocument()
    expect(screen.getAllByText('已开启')).toHaveLength(2)
    expect(screen.getByText('已关闭')).toBeInTheDocument()
    expect(
      screen.getByText('通知偏好由审核服务维护，后台仅展示，不提供修改。'),
    ).toBeInTheDocument()

    expect(await screen.findByText('举报已处理')).toBeInTheDocument()
    expect(screen.getByText('举报 #42')).toBeInTheDocument()
    expect(screen.getByText('未读')).toBeInTheDocument()

    expect(mocks.listInboxNotifications).toHaveBeenCalledWith({
      did: mocks.did,
      limit: 50,
    })
    expect(screen.queryByRole('button', { name: /标记已读/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /修改偏好/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /提交申诉/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/标记已读|修改偏好|提交申诉/)).not.toBeInTheDocument()
  })

  it('renders localized reasons and target summaries', async () => {
    mocks.listInboxNotifications.mockResolvedValue({
      notifications: [
        reportNotification,
        subjectNotification,
        standingNotification,
        unknownNotification,
      ],
    })

    renderPanel()

    expect(await screen.findByText('举报已处理')).toBeInTheDocument()
    expect(screen.getByText('已执行处置')).toBeInTheDocument()
    expect(screen.getByText('账号状态变更')).toBeInTheDocument()
    expect(screen.getByText('其他通知')).toBeInTheDocument()

    expect(screen.getByText('举报 #42')).toBeInTheDocument()
    expect(
      screen.getByText(`对象 ${truncateDid(subjectNotification.target.subject ?? '')}`),
    ).toBeInTheDocument()
    expect(screen.getByText('账号状态由 正常 变为 受限')).toBeInTheDocument()
    expect(screen.getByText('未知对象')).toBeInTheDocument()
    expect(screen.getByText('未标注')).toBeInTheDocument()
    expect(screen.getAllByText('已读')).toHaveLength(2)
  })

  it('reloads the first page with the selected section and keeps unread counts', async () => {
    const user = userEvent.setup()
    renderPanel()

    await screen.findByText('举报已处理')
    await user.selectOptions(
      screen.getByRole('combobox', { name: '通知分区' }),
      'reports',
    )

    await waitFor(() =>
      expect(mocks.listInboxNotifications).toHaveBeenLastCalledWith({
        did: mocks.did,
        limit: 50,
        section: 'reports',
      }),
    )
    expect(mocks.getInboxUnreadCounts).toHaveBeenCalledTimes(1)
    expect(mocks.getInboxUnreadCounts).toHaveBeenCalledWith(mocks.did)
    expect(screen.getByText('6')).toBeInTheDocument()
    expect(screen.getByText('未读数量由审核服务统计。')).toBeInTheDocument()
  })

  it('requests only unread notifications when the unread filter is enabled', async () => {
    const user = userEvent.setup()
    renderPanel()

    await screen.findByText('举报已处理')
    await user.click(screen.getByRole('switch', { name: '仅看未读' }))

    await waitFor(() =>
      expect(mocks.listInboxNotifications).toHaveBeenLastCalledWith({
        did: mocks.did,
        limit: 50,
        unreadOnly: true,
      }),
    )
  })

  it('appends the next page when loading more', async () => {
    mocks.listInboxNotifications
      .mockResolvedValueOnce({ notifications: [reportNotification], cursor: 'cursor-2' })
      .mockResolvedValueOnce({ notifications: [subjectNotification] })

    const user = userEvent.setup()
    renderPanel()

    await screen.findByText('举报已处理')
    await user.click(screen.getByRole('button', { name: '加载更多' }))

    await waitFor(() => expect(mocks.listInboxNotifications).toHaveBeenCalledTimes(2))
    expect(mocks.listInboxNotifications).toHaveBeenLastCalledWith({
      did: mocks.did,
      limit: 50,
      cursor: 'cursor-2',
    })
    expect(await screen.findByText('已执行处置')).toBeInTheDocument()
    expect(screen.getByText('举报 #42')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '已加载全部' })).toBeDisabled()
  })

  it('shows an empty state without pagination when there are no notifications', async () => {
    mocks.getInboxUnreadCounts.mockResolvedValue({ total: 0 })
    mocks.listInboxNotifications.mockResolvedValue({ notifications: [] })

    renderPanel()

    expect(await screen.findByText('暂无通知')).toBeInTheDocument()
    expect(
      screen.getByText('该账号当前没有符合条件的通知。可以调整筛选后重试。'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '加载更多' })).not.toBeInTheDocument()
  })

  it('shows a list error state and retries the request', async () => {
    mocks.listInboxNotifications
      .mockRejectedValueOnce(new Error('list failed'))
      .mockResolvedValue({ notifications: [reportNotification] })

    const user = userEvent.setup()
    renderPanel()

    expect(await screen.findByText('通知列表加载失败')).toBeInTheDocument()
    expect(screen.getByText('操作失败，请稍后重试。')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '重试' }))

    await waitFor(() => expect(mocks.listInboxNotifications).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('举报已处理')).toBeInTheDocument()
  })

  it('retries loading unread counts when the summary request fails', async () => {
    mocks.getInboxUnreadCounts
      .mockRejectedValueOnce(new Error('counts failed'))
      .mockResolvedValue(counts)

    const user = userEvent.setup()
    renderPanel()

    expect(
      await screen.findByText('未读数量与通知偏好加载失败'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重试' }))

    await waitFor(() => expect(mocks.getInboxUnreadCounts).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('未读数量')).toBeInTheDocument()
    expect(screen.getByText('6')).toBeInTheDocument()
  })
})
