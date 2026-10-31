import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminApiError } from '@/lib/api/admin-client'
import type { VerificationView } from '@/lib/data/types'
import VerificationPage from '@/app/(console)/verification/page'

const SUBJECT = 'did:plc:subject123'
const ISSUER = 'did:web:verify.selfcommand.example'

const mocks = vi.hoisted(() => ({
  permissions: ['verification.read', 'verification.write'] as string[],
  listVerifications: vi.fn(),
  actOnVerifications: vi.fn(),
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

vi.mock('@/components/layout/workspace-provider', () => ({
  useWorkspace: () => ({ pageSize: 10, dateFormat: 'date-time' as const }),
}))

vi.mock('@/lib/data/use-data-provider', () => {
  const provider = {
    listVerifications: mocks.listVerifications,
    actOnVerifications: mocks.actOnVerifications,
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

const record: VerificationView = {
  uri: 'at://did:plc:issuer/app.bsky.graph.verification/3kabc',
  issuer: ISSUER,
  subject: SUBJECT,
  handle: 'alice.example.com',
  displayName: '官方账号',
  createdAt: '2026-10-20T02:00:00.000Z',
  isActive: true,
}

function approvalRequired(): AdminApiError {
  return new AdminApiError('conflict', 409, 'ApprovalRequired')
}

describe('verification page', () => {
  beforeEach(() => {
    mocks.permissions = ['verification.read', 'verification.write']
    mocks.listVerifications.mockReset()
    mocks.actOnVerifications.mockReset()
    mocks.createApproval.mockReset()

    mocks.listVerifications.mockResolvedValue({ verifications: [record] })
    mocks.actOnVerifications.mockResolvedValue({
      verified: [record],
      revoked: [],
      failed: [],
    })
    mocks.createApproval.mockResolvedValue({
      id: 'ap-1',
      action: 'verification.grant',
      status: 'pending',
      expiresAt: '2026-10-30T02:00:00.000Z',
    })
  })

  it('lists verification records with account, status and issuer', async () => {
    render(<VerificationPage />)

    expect(await screen.findByText('官方账号')).toBeInTheDocument()
    expect(screen.getByText('@alice.example.com')).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getByText('已生效')).toBeInTheDocument()
    expect(mocks.listVerifications).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10 }),
    )
  })

  it('disables verification writes for readers without verification.write', async () => {
    mocks.permissions = ['verification.read']
    render(<VerificationPage />)

    expect(await screen.findByText(/当前账号只有查看权限/)).toBeInTheDocument()
    const grantButton = screen.getByRole('button', { name: /授予认证/ })
    expect(grantButton).toBeDisabled()
    expect(grantButton).toHaveAttribute('title', '当前账号没有管理认证的权限')

    const revokeButton = await screen.findByRole('button', { name: '撤销认证' })
    expect(revokeButton).toBeDisabled()
  })

  it('grants verification directly when no approval is required', async () => {
    const user = userEvent.setup()
    render(<VerificationPage />)

    await user.click(await screen.findByRole('button', { name: /授予认证/ }))
    const dialog = await screen.findByRole('dialog', { name: '授予账号认证' })
    await user.type(within(dialog).getByLabelText('账号标识'), SUBJECT)
    await user.type(within(dialog).getByLabelText('账号名'), 'alice.example.com')
    await user.type(within(dialog).getByLabelText('认证展示名称'), '官方账号')
    await user.click(within(dialog).getByRole('button', { name: '授予认证' }))

    await waitFor(() =>
      expect(mocks.actOnVerifications).toHaveBeenCalledWith({
        action: 'grant',
        verifications: [
          { subject: SUBJECT, handle: 'alice.example.com', displayName: '官方账号' },
        ],
      }),
    )
    await waitFor(() => expect(mocks.listVerifications).toHaveBeenCalledTimes(2))
  })

  it('routes the grant through an approval request when the server requires it', async () => {
    mocks.actOnVerifications.mockRejectedValue(approvalRequired())
    const user = userEvent.setup()
    render(<VerificationPage />)

    await user.click(await screen.findByRole('button', { name: /授予认证/ }))
    const grantDialog = await screen.findByRole('dialog', { name: '授予账号认证' })
    await user.type(within(grantDialog).getByLabelText('账号标识'), SUBJECT)
    await user.type(within(grantDialog).getByLabelText('账号名'), 'alice.example.com')
    await user.type(within(grantDialog).getByLabelText('认证展示名称'), '官方账号')
    await user.click(within(grantDialog).getByRole('button', { name: '授予认证' }))

    const approvalDialog = await screen.findByRole('dialog', { name: '发起审批请求' })
    expect(within(approvalDialog).getByText('授予认证')).toBeInTheDocument()
    await user.click(
      within(approvalDialog).getByRole('button', { name: '发起审批请求' }),
    )

    await waitFor(() =>
      expect(mocks.createApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'verification.grant',
          targetType: 'verification',
          target: SUBJECT,
          payload: {
            verifications: [
              {
                subject: SUBJECT,
                handle: 'alice.example.com',
                displayName: '官方账号',
              },
            ],
          },
        }),
      ),
    )
  })
})
