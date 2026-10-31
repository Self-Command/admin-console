import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccessBlock, AccessRecord, Approval } from '@/lib/data/types'
import SecurityPage from '@/app/(console)/security/page'

const SELF_DID = 'did:web:ops.selfcommand.example'
const OTHER_DID = 'did:web:security.selfcommand.example'

const mocks = vi.hoisted(() => ({
  permissions: [
    'security.read',
    'security.write',
    'settings.read',
    'settings.write',
  ] as string[],
  listAccess: vi.fn(),
  listBlocked: vi.fn(),
  blockAccess: vi.fn(),
  unblockAccess: vi.fn(),
  listApprovals: vi.fn(),
  createApproval: vi.fn(),
  approveApproval: vi.fn(),
  rejectApproval: vi.fn(),
  cancelApproval: vi.fn(),
  getApprovalScope: vi.fn(),
  updateApprovalScope: vi.fn(),
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
  }),
}))

vi.mock('@/components/layout/workspace-provider', () => ({
  useWorkspace: () => ({
    pageSize: 10,
    dateFormat: 'date-time' as const,
    features: {
      auditExport: true,
      roleBulk: true,
      indexerControls: true,
      systemStatus: true,
      accountOperations: true,
      approvals: true,
      securityCenter: true,
      dashboardTrends: true,
    },
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
    warning: vi.fn(),
  },
}))

vi.mock('@/lib/data/use-data-provider', () => {
  const provider = {
    listAccess: mocks.listAccess,
    listBlocked: mocks.listBlocked,
    blockAccess: mocks.blockAccess,
    unblockAccess: mocks.unblockAccess,
    listApprovals: mocks.listApprovals,
    createApproval: mocks.createApproval,
    approveApproval: mocks.approveApproval,
    rejectApproval: mocks.rejectApproval,
    cancelApproval: mocks.cancelApproval,
    getApprovalScope: mocks.getApprovalScope,
    updateApprovalScope: mocks.updateApprovalScope,
  }
  return { useDataProvider: () => provider }
})

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub)

const accessRecord: AccessRecord = {
  did: SELF_DID,
  ip: '203.0.113.10',
  userAgent: 'Mozilla/5.0 (Macintosh)',
  firstSeenAt: '2026-10-20T02:00:00.000Z',
  lastSeenAt: '2026-10-29T02:00:00.000Z',
  requestCount: 128,
}

const approval = (overrides: Partial<Approval> = {}): Approval => ({
  id: 'ap-1',
  action: 'role.revoke',
  targetType: 'role',
  target: 'did:plc:targetadmin',
  summary: '撤销 did:plc:targetadmin 的管理员角色',
  status: 'pending',
  requestedBy: OTHER_DID,
  requestedAt: '2026-10-29T01:00:00.000Z',
  expiresAt: '2026-10-30T01:00:00.000Z',
  ...overrides,
})

const block: AccessBlock = {
  did: 'did:plc:blockedadmin',
  blockedBy: SELF_DID,
  reason: '账号疑似泄露',
  blockedAt: '2026-10-29T03:00:00.000Z',
}

describe('security page', () => {
  beforeEach(() => {
    mocks.permissions = [
      'security.read',
      'security.write',
      'settings.read',
      'settings.write',
    ]
    mocks.listAccess.mockReset()
    mocks.listBlocked.mockReset()
    mocks.blockAccess.mockReset()
    mocks.unblockAccess.mockReset()
    mocks.listApprovals.mockReset()
    mocks.createApproval.mockReset()
    mocks.approveApproval.mockReset()
    mocks.rejectApproval.mockReset()
    mocks.cancelApproval.mockReset()
    mocks.getApprovalScope.mockReset()
    mocks.updateApprovalScope.mockReset()
    mocks.toastSuccess.mockReset()
    mocks.toastError.mockReset()

    mocks.listAccess.mockResolvedValue({ records: [accessRecord], total: 1 })
    mocks.listBlocked.mockResolvedValue({ blocks: [block], total: 1 })
    mocks.listApprovals.mockResolvedValue({ approvals: [approval()], total: 1 })
    mocks.approveApproval.mockResolvedValue(approval({ status: 'executed' }))
    mocks.unblockAccess.mockResolvedValue(undefined)
    mocks.getApprovalScope.mockResolvedValue({
      builtInActions: ['role.revoke', 'role.demote'],
      additionalActions: [],
      availableActions: [
        'role.revoke',
        'role.demote',
        'moderation.takedown',
        'role.import',
      ],
      version: 3,
      updatedAt: '2026-10-28T02:00:00.000Z',
    })
    mocks.updateApprovalScope.mockResolvedValue({
      builtInActions: ['role.revoke', 'role.demote'],
      additionalActions: ['moderation.takedown'],
      availableActions: [
        'role.revoke',
        'role.demote',
        'moderation.takedown',
        'role.import',
      ],
      version: 4,
      updatedAt: '2026-10-30T02:00:00.000Z',
    })
  })

  it('lists access records and switches between the three tabs', async () => {
    const user = userEvent.setup()
    render(<SecurityPage />)

    expect(await screen.findByText('203.0.113.10')).toBeInTheDocument()
    expect(screen.getByText('128')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /待审批/ }))
    expect(await screen.findByText('撤销管理员角色')).toBeInTheDocument()
    expect(screen.getAllByText('待审批').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('tab', { name: /访问封锁/ }))
    expect(await screen.findByText('账号疑似泄露')).toBeInTheDocument()
  })

  it('disables write actions with a reason for readers without security.write', async () => {
    mocks.permissions = ['security.read']
    const user = userEvent.setup()
    render(<SecurityPage />)

    expect(
      await screen.findByText(/当前账号只有查看权限/),
    ).toBeInTheDocument()
    const blockButton = await screen.findByRole('button', { name: /封锁访问/ })
    expect(blockButton).toBeDisabled()
    expect(blockButton).toHaveAttribute('title', '当前账号没有管理后台安全的权限')

    await user.click(screen.getByRole('tab', { name: /待审批/ }))
    expect(await screen.findByRole('button', { name: /发起审批/ })).toBeDisabled()
  })

  it('offers withdrawal instead of approval for requests created by the current user', async () => {
    mocks.listApprovals.mockResolvedValue({
      approvals: [approval({ requestedBy: SELF_DID })],
      total: 1,
    })
    const user = userEvent.setup()
    render(<SecurityPage />)

    await user.click(screen.getByRole('tab', { name: /待审批/ }))
    expect(await screen.findByRole('button', { name: /撤回/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /批准/ })).not.toBeInTheDocument()
  })

  it('approves a pending request after confirmation and refreshes the list', async () => {
    const user = userEvent.setup()
    render(<SecurityPage />)

    await user.click(screen.getByRole('tab', { name: /待审批/ }))
    await user.click(await screen.findByRole('button', { name: /批准/ }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/批准后系统会立即执行该动作/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '确认批准并执行' }))

    await waitFor(() => expect(mocks.approveApproval).toHaveBeenCalledWith('ap-1'))
    await waitFor(() => expect(mocks.listApprovals).toHaveBeenCalledTimes(2))
  })

  it('lifts a block after confirmation', async () => {
    const user = userEvent.setup()
    render(<SecurityPage />)

    await user.click(await screen.findByRole('tab', { name: /访问封锁/ }))
    await user.click(await screen.findByRole('button', { name: /解除封锁/ }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: '确认解除' }))

    await waitFor(() => expect(mocks.unblockAccess).toHaveBeenCalledWith(block.did))
    await waitFor(() => expect(mocks.listBlocked).toHaveBeenCalledTimes(2))
  })

  it('blocks access from the activity tab with the entered reason', async () => {
    mocks.blockAccess.mockResolvedValue(accessRecord)
    const user = userEvent.setup()
    render(<SecurityPage />)

    await user.click(await screen.findByRole('button', { name: /封锁访问/ }))
    const dialog = await screen.findByRole('dialog')
    await user.type(
      within(dialog).getByLabelText('封锁原因（可选）'),
      '账号疑似泄露',
    )
    await user.click(within(dialog).getByRole('button', { name: '确认封锁' }))

    await waitFor(() =>
      expect(mocks.blockAccess).toHaveBeenCalledWith(SELF_DID, '账号疑似泄露'),
    )
  })

  it('shows built-in approval actions as immutable and appends a new one', async () => {
    const user = userEvent.setup()
    render(<SecurityPage />)

    await user.click(screen.getByRole('tab', { name: /审批范围/ }))

    expect(await screen.findByText('内置必审动作')).toBeInTheDocument()
    expect(screen.getAllByText('始终审批')).toHaveLength(2)
    expect(
      screen.getByText('当前没有追加动作，只有内置动作需要审批。'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: '追加审批：内容处置' }))
    expect(screen.getByText('已选择 1 个动作。')).toBeInTheDocument()
    await user.type(screen.getByLabelText('追加原因（可选）'), '合规复核需要')
    await user.click(screen.getByRole('button', { name: '保存审批范围' }))

    await waitFor(() =>
      expect(mocks.updateApprovalScope).toHaveBeenCalledWith({
        additionalActions: ['moderation.takedown'],
        reason: '合规复核需要',
      }),
    )
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      '审批范围已更新，新的要求已立即生效。',
    )
    expect(await screen.findByText('已追加')).toBeInTheDocument()
  })

  it('explains the read-only approval scope without settings.write', async () => {
    mocks.permissions = ['security.read', 'settings.read']
    const user = userEvent.setup()
    render(<SecurityPage />)

    await user.click(screen.getByRole('tab', { name: /审批范围/ }))

    expect(
      await screen.findByText(
        '当前账号只有查看权限：调整审批范围需要“修改系统设置”权限。',
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '保存审批范围' }),
    ).not.toBeInTheDocument()
  })

  it('hides the approval scope tab without settings.read', () => {
    mocks.permissions = ['security.read', 'security.write']
    render(<SecurityPage />)

    expect(
      screen.queryByRole('tab', { name: /审批范围/ }),
    ).not.toBeInTheDocument()
    expect(mocks.getApprovalScope).not.toHaveBeenCalled()
  })
})