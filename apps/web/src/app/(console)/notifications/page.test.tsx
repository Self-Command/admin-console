import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminApiError } from '@/lib/api/admin-client'
import type { NotificationTemplate } from '@/lib/data/types'
import NotificationsPage from '@/app/(console)/notifications/page'

const mocks = vi.hoisted(() => ({
  permissions: ['notification.read', 'notification.write'] as string[],
  listTemplates: vi.fn(),
  actOnTemplate: vi.fn(),
  sendNotification: vi.fn(),
  createApproval: vi.fn(),
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

vi.mock('@/lib/data/use-data-provider', () => {
  const provider = {
    listTemplates: mocks.listTemplates,
    actOnTemplate: mocks.actOnTemplate,
    sendNotification: mocks.sendNotification,
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

const template: NotificationTemplate = {
  id: 't-1',
  name: '违规提醒',
  subject: '您的内容已被处理',
  contentMarkdown: '您发布的内容因违反社区规范已被处理。',
  disabled: false,
}

const RECIPIENT = 'did:plc:alice'

describe('notifications page', () => {
  beforeEach(() => {
    mocks.permissions = ['notification.read', 'notification.write']
    mocks.listTemplates.mockReset()
    mocks.actOnTemplate.mockReset()
    mocks.sendNotification.mockReset()
    mocks.createApproval.mockReset()

    mocks.listTemplates.mockResolvedValue({ templates: [template], sendAvailable: true })
    mocks.sendNotification.mockResolvedValue({ sent: 1, failed: [] })
    mocks.actOnTemplate.mockResolvedValue({ template })
    mocks.createApproval.mockResolvedValue({
      id: 'ap-1',
      action: 'notifications.send',
      status: 'pending',
      expiresAt: '2026-10-30T02:00:00.000Z',
    })
  })

  it('sends a notification and shows the delivery result', async () => {
    const user = userEvent.setup()
    render(<NotificationsPage />)

    await user.type(await screen.findByLabelText('接收账号'), RECIPIENT)
    await user.type(screen.getByLabelText('通知主题'), '账号安全提醒')
    await user.type(screen.getByLabelText('通知正文'), '请及时修改登录密码。')
    await user.click(screen.getByRole('button', { name: '发送通知' }))

    await waitFor(() =>
      expect(mocks.sendNotification).toHaveBeenCalledWith({
        recipients: [RECIPIENT],
        subject: '账号安全提醒',
        contentMarkdown: '请及时修改登录密码。',
      }),
    )
    expect(await screen.findByText(/已发送 1 个账号/)).toBeInTheDocument()
  })

  it('disables sending when the mail service is unavailable', async () => {
    mocks.listTemplates.mockResolvedValue({
      templates: [],
      sendAvailable: false,
      sendUnavailableReason: '尚未配置邮件发送凭据，请联系部署管理员完成配置后重试。',
    })
    render(<NotificationsPage />)

    expect(await screen.findByText('邮件发送暂不可用')).toBeInTheDocument()
    expect(
      screen.getByText('尚未配置邮件发送凭据，请联系部署管理员完成配置后重试。'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发送通知' })).toBeDisabled()
  })

  it('routes the send through an approval request when the server requires it', async () => {
    mocks.sendNotification.mockRejectedValue(
      new AdminApiError('conflict', 409, 'ApprovalRequired'),
    )
    const user = userEvent.setup()
    render(<NotificationsPage />)

    await user.type(await screen.findByLabelText('接收账号'), RECIPIENT)
    await user.type(screen.getByLabelText('通知主题'), '账号安全提醒')
    await user.type(screen.getByLabelText('通知正文'), '请及时修改登录密码。')
    await user.click(screen.getByRole('button', { name: '发送通知' }))

    const approvalDialog = await screen.findByRole('dialog', { name: '发起审批请求' })
    expect(within(approvalDialog).getByText('发送系统通知')).toBeInTheDocument()
    await user.click(
      within(approvalDialog).getByRole('button', { name: '发起审批请求' }),
    )

    await waitFor(() =>
      expect(mocks.createApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'notifications.send',
          payload: {
            recipients: [RECIPIENT],
            subject: '账号安全提醒',
            contentMarkdown: '请及时修改登录密码。',
          },
        }),
      ),
    )
  })

  it('creates a template from the templates tab', async () => {
    const user = userEvent.setup()
    render(<NotificationsPage />)

    await user.click(await screen.findByRole('tab', { name: /通知模板/ }))
    expect(await screen.findByText('违规提醒')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /新建模板/ }))
    const dialog = await screen.findByRole('dialog', { name: '新建通知模板' })
    await user.type(within(dialog).getByLabelText('模板名称'), '账号解封通知')
    await user.type(within(dialog).getByLabelText('邮件主题'), '您的账号已恢复')
    await user.type(within(dialog).getByLabelText('模板内容'), '您的账号限制已解除。')
    await user.click(within(dialog).getByRole('button', { name: '创建模板' }))

    await waitFor(() =>
      expect(mocks.actOnTemplate).toHaveBeenCalledWith({
        action: 'create',
        name: '账号解封通知',
        subject: '您的账号已恢复',
        contentMarkdown: '您的账号限制已解除。',
      }),
    )
  })

  it('disables sending and template editing for readers without notification.write', async () => {
    mocks.permissions = ['notification.read']
    const user = userEvent.setup()
    render(<NotificationsPage />)

    expect(await screen.findByText(/当前账号只有查看权限/)).toBeInTheDocument()
    expect(screen.getByText('当前账号没有发送通知的权限。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发送通知' })).toBeDisabled()

    await user.click(screen.getByRole('tab', { name: /通知模板/ }))
    expect(await screen.findByText('违规提醒')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /新建模板/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /编辑/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /停用/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /删除/ })).toBeDisabled()
  })
})
