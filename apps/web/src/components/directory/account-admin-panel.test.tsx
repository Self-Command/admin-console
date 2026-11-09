import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminApiError } from '@/lib/api/admin-client'
import type { AccountAdminInfo } from '@/lib/data/types'
import { AccountAdminPanel } from '@/components/directory/account-admin-panel'

const mocks = vi.hoisted(() => ({
  did: 'did:plc:alice7x4k2m6q3n5p4w',
  push: vi.fn(),
  getAccountAdminInfo: vi.fn(),
  updateAccountAdmin: vi.fn(),
  deleteAccountAdmin: vi.fn(),
  disableAccountInvites: vi.fn(),
  createApproval: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

vi.mock('@/lib/data/use-data-provider', () => {
  const provider = {
    getAccountAdminInfo: mocks.getAccountAdminInfo,
    updateAccountAdmin: mocks.updateAccountAdmin,
    deleteAccountAdmin: mocks.deleteAccountAdmin,
    disableAccountInvites: mocks.disableAccountInvites,
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

const info: AccountAdminInfo = {
  did: mocks.did,
  handle: 'alice.example.com',
  email: 'alice@example.com',
  emailConfirmed: true,
  invitesDisabled: false,
  indexedAt: '2026-10-29T07:41:14.000Z',
  invitedBy: {
    code: 'invite-parent',
    available: 1,
    disabled: false,
    createdBy: 'did:plc:inviter7x4k2',
    createdAt: '2026-10-01T02:00:00.000Z',
    usesCount: 0,
  },
  invites: [
    {
      code: 'invite-one',
      available: 2,
      disabled: false,
      createdBy: mocks.did,
      createdAt: '2026-10-20T02:00:00.000Z',
      usesCount: 1,
    },
  ],
}

function approvalRequired(): AdminApiError {
  return new AdminApiError('conflict', 409, 'ApprovalRequired')
}

function renderPanel(canManage = true) {
  return render(
    <AccountAdminPanel did={mocks.did} handle="alice.example.com" canManage={canManage} />,
  )
}

describe('account admin panel', () => {
  beforeEach(() => {
    mocks.push.mockReset()
    mocks.getAccountAdminInfo.mockReset()
    mocks.updateAccountAdmin.mockReset()
    mocks.deleteAccountAdmin.mockReset()
    mocks.disableAccountInvites.mockReset()
    mocks.createApproval.mockReset()
    mocks.toastSuccess.mockReset()
    mocks.toastError.mockReset()
    mocks.getAccountAdminInfo.mockResolvedValue(info)
    mocks.updateAccountAdmin.mockResolvedValue(undefined)
    mocks.deleteAccountAdmin.mockResolvedValue(undefined)
    mocks.disableAccountInvites.mockResolvedValue(undefined)
    mocks.createApproval.mockResolvedValue({
      id: 'approval-1',
      action: 'account.admin.update',
      status: 'pending',
      requestedBy: 'did:web:ops.selfcommand.example',
      createdAt: '2026-10-29T08:00:00.000Z',
      expiresAt: '2026-10-30T08:00:00.000Z',
    })
  })

  it('renders account info and invites, then saves changed profile fields', async () => {
    const user = userEvent.setup()
    renderPanel()

    const email = await screen.findByLabelText('邮箱')
    expect(email).toHaveValue('alice@example.com')
    expect(screen.getByLabelText('账号名')).toHaveValue('alice.example.com')
    expect(screen.getByText('已验证')).toBeInTheDocument()
    expect(screen.getByText('invite-one')).toBeInTheDocument()
    expect(screen.getByText('邀请码可用')).toBeInTheDocument()
    expect(screen.getByText(/invite-parent/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '保存账号资料' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      '邮箱与账号名均未变更，请修改后再保存。',
    )
    expect(mocks.updateAccountAdmin).not.toHaveBeenCalled()

    await user.clear(email)
    await user.type(email, 'alice2@example.com')
    await user.click(screen.getByRole('button', { name: '保存账号资料' }))

    await waitFor(() =>
      expect(mocks.updateAccountAdmin).toHaveBeenCalledWith({
        did: mocks.did,
        email: 'alice2@example.com',
      }),
    )
    expect(mocks.toastSuccess).toHaveBeenCalledWith('账号资料已更新。')
    await waitFor(() => expect(mocks.getAccountAdminInfo).toHaveBeenCalledTimes(2))
  })

  it('rejects an invalid email or handle before calling the provider', async () => {
    const user = userEvent.setup()
    renderPanel()

    const email = await screen.findByLabelText('邮箱')
    fireEvent.change(email, { target: { value: 'not-an-email' } })
    await user.click(screen.getByRole('button', { name: '保存账号资料' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      '邮箱格式不正确，请填写完整的邮箱地址。',
    )

    fireEvent.change(email, { target: { value: '' } })
    const handle = screen.getByLabelText('账号名')
    fireEvent.change(handle, { target: { value: 'Invalid_Handle' } })
    await user.click(screen.getByRole('button', { name: '保存账号资料' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      '账号名应为域名格式，例如 alice.example.com。',
    )
    expect(mocks.updateAccountAdmin).not.toHaveBeenCalled()
  })

  it('routes profile changes through an approval request when required', async () => {
    mocks.updateAccountAdmin.mockRejectedValue(approvalRequired())
    const user = userEvent.setup()
    renderPanel()

    const handle = await screen.findByLabelText('账号名')
    await user.clear(handle)
    await user.type(handle, 'alice2.example.com')
    await user.click(screen.getByRole('button', { name: '保存账号资料' }))

    const dialog = await screen.findByRole('dialog', { name: '发起审批请求' })
    expect(within(dialog).getByText('调整账号资料')).toBeInTheDocument()
    expect(
      within(dialog).getByText(`修改账号 ${mocks.did} 的账号名`),
    ).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: '发起审批请求' }))

    await waitFor(() =>
      expect(mocks.createApproval).toHaveBeenCalledWith({
        action: 'account.admin.update',
        targetType: 'account',
        target: mocks.did,
        summary: `修改账号 ${mocks.did} 的账号名`,
        payload: { did: mocks.did, handle: 'alice2.example.com' },
      }),
    )
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      '审批请求已创建，等待另一位管理员批准。',
    )
  })

  it('validates the new password and resets it after confirmation matches', async () => {
    const user = userEvent.setup()
    renderPanel()

    await screen.findByLabelText('新密码')

    await user.click(screen.getByRole('button', { name: '重置密码' }))
    expect(screen.getByRole('alert')).toHaveTextContent('请输入新密码。')

    await user.type(screen.getByLabelText('新密码'), 'short')
    await user.type(screen.getByLabelText('确认新密码'), 'short')
    await user.click(screen.getByRole('button', { name: '重置密码' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      '密码长度需在 8 到 256 个字符之间。',
    )

    await user.clear(screen.getByLabelText('新密码'))
    await user.type(screen.getByLabelText('新密码'), 'correct horse battery')
    await user.type(screen.getByLabelText('确认新密码'), 'correct horse batteru')
    await user.click(screen.getByRole('button', { name: '重置密码' }))
    expect(screen.getByRole('alert')).toHaveTextContent('两次输入的密码不一致。')
    expect(mocks.updateAccountAdmin).not.toHaveBeenCalled()

    await user.clear(screen.getByLabelText('确认新密码'))
    await user.type(screen.getByLabelText('确认新密码'), 'correct horse battery')
    await user.click(screen.getByRole('button', { name: '重置密码' }))

    await waitFor(() =>
      expect(mocks.updateAccountAdmin).toHaveBeenCalledWith({
        did: mocks.did,
        password: 'correct horse battery',
      }),
    )
    expect(mocks.toastSuccess).toHaveBeenCalledWith('账号密码已重置。')
    expect(screen.getByLabelText('新密码')).toHaveValue('')
    expect(screen.getByLabelText('确认新密码')).toHaveValue('')
  })

  it('puts the sealed password into an approval draft when required', async () => {
    mocks.updateAccountAdmin.mockRejectedValue(approvalRequired())
    const user = userEvent.setup()
    renderPanel()

    await screen.findByLabelText('新密码')
    await user.type(screen.getByLabelText('新密码'), 'correct horse battery')
    await user.type(screen.getByLabelText('确认新密码'), 'correct horse battery')
    await user.click(screen.getByRole('button', { name: '重置密码' }))

    const dialog = await screen.findByRole('dialog', { name: '发起审批请求' })
    expect(
      within(dialog).getByText(`修改账号 ${mocks.did} 的密码`),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('新密码')).toHaveValue('')
    expect(screen.getByLabelText('确认新密码')).toHaveValue('')

    await user.click(within(dialog).getByRole('button', { name: '发起审批请求' }))

    await waitFor(() =>
      expect(mocks.createApproval).toHaveBeenCalledWith({
        action: 'account.admin.update',
        targetType: 'account',
        target: mocks.did,
        summary: `修改账号 ${mocks.did} 的密码`,
        payload: { did: mocks.did, password: 'correct horse battery' },
      }),
    )
  })

  it('disables the account invites only after confirmation', async () => {
    const user = userEvent.setup()
    renderPanel()

    await screen.findByLabelText('邮箱')
    await user.click(
      screen.getByRole('button', { name: '停用该账号创建的全部邀请码' }),
    )

    const dialog = await screen.findByRole('alertdialog', {
      name: '停用该账号创建的邀请码',
    })
    expect(within(dialog).getByText(/已注册账号不受影响/)).toBeInTheDocument()
    expect(mocks.disableAccountInvites).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: '确认停用' }))

    await waitFor(() =>
      expect(mocks.disableAccountInvites).toHaveBeenCalledWith({ did: mocks.did }),
    )
    expect(mocks.toastSuccess).toHaveBeenCalledWith('已停用该账号创建的邀请码。')
    await waitFor(() => expect(mocks.getAccountAdminInfo).toHaveBeenCalledTimes(2))
  })

  it('deletes the account after the typed handle matches, then leaves the page', async () => {
    const user = userEvent.setup()
    renderPanel()

    await screen.findByLabelText('邮箱')
    await user.click(screen.getByRole('button', { name: '删除账号' }))

    const dialog = await screen.findByRole('alertdialog', { name: '删除账号' })
    const confirm = within(dialog).getByRole('button', { name: '确认删除' })
    expect(confirm).toBeDisabled()

    const confirmation = within(dialog).getByLabelText('确认删除的账号名')
    await user.type(confirmation, 'alice')
    expect(confirm).toBeDisabled()

    await user.clear(confirmation)
    await user.type(confirmation, 'alice.example.com')
    expect(confirm).toBeEnabled()
    await user.click(confirm)

    await waitFor(() => expect(mocks.deleteAccountAdmin).toHaveBeenCalledWith(mocks.did))
    expect(mocks.toastSuccess).toHaveBeenCalledWith('账号已删除。')
    expect(mocks.push).toHaveBeenCalledWith('/directory')
  })

  it('opens a delete approval request when another admin is required', async () => {
    mocks.deleteAccountAdmin.mockRejectedValue(approvalRequired())
    const user = userEvent.setup()
    renderPanel()

    await screen.findByLabelText('邮箱')
    await user.click(screen.getByRole('button', { name: '删除账号' }))

    const confirmDialog = await screen.findByRole('alertdialog', { name: '删除账号' })
    await user.type(
      within(confirmDialog).getByLabelText('确认删除的账号名'),
      'alice.example.com',
    )
    await user.click(within(confirmDialog).getByRole('button', { name: '确认删除' }))

    const dialog = await screen.findByRole('dialog', { name: '发起审批请求' })
    expect(
      within(dialog).getByText('删除账号 @alice.example.com'),
    ).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: '发起审批请求' }))

    await waitFor(() =>
      expect(mocks.createApproval).toHaveBeenCalledWith({
        action: 'account.admin.delete',
        targetType: 'account',
        target: mocks.did,
        summary: '删除账号 @alice.example.com',
        payload: { did: mocks.did },
      }),
    )
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('explains when the account service credentials are not configured', async () => {
    mocks.getAccountAdminInfo
      .mockRejectedValueOnce(new AdminApiError('server', 503, 'NotConfigured'))
      .mockResolvedValueOnce(info)
    const user = userEvent.setup()
    renderPanel()

    expect(await screen.findByText('账号资料管理暂不可用')).toBeInTheDocument()
    expect(
      screen.getByText(/尚未配置账号服务的管理员凭据/),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '重新检查' }))
    expect(await screen.findByLabelText('邮箱')).toHaveValue('alice@example.com')
    expect(mocks.getAccountAdminInfo).toHaveBeenCalledTimes(2)
  })

  it('reports load failures and retries the request', async () => {
    mocks.getAccountAdminInfo
      .mockRejectedValueOnce(new AdminApiError('network', null))
      .mockResolvedValueOnce(info)
    const user = userEvent.setup()
    renderPanel()

    expect(await screen.findByText('账号资料加载失败')).toBeInTheDocument()
    expect(
      screen.getByText('无法连接后台服务，请检查网络后重试。'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /重试/ }))
    expect(await screen.findByLabelText('邮箱')).toHaveValue('alice@example.com')
  })

  it('keeps the panel read-only without the account administration permission', () => {
    renderPanel(false)

    expect(screen.getByText('没有账号资料管理权限')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '保存账号资料' }),
    ).not.toBeInTheDocument()
    expect(mocks.getAccountAdminInfo).not.toHaveBeenCalled()
  })
})
