import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoleBinding } from '@/lib/data/types'
import { AdminApiError } from '@/lib/api/admin-client'
import RolesPage from '@/app/(console)/roles/page'

const mocks = vi.hoisted(() => ({
  listRoles: vi.fn(),
  createRole: vi.fn(),
  updateRole: vi.fn(),
  revokeRole: vi.fn(),
  importRoles: vi.fn(),
  exportRoles: vi.fn(),
  createApproval: vi.fn(),
  downloadTextFile: vi.fn(),
}))

vi.mock('@/components/auth/auth-provider', () => ({
  useAuth: () => ({
    identity: {
      did: 'did:web:ops.selfcommand.example',
      role: 'admin',
      permissions: ['directory.read', 'role.read', 'role.write', 'audit.read'],
    },
  }),
}))

vi.mock('@/components/layout/workspace-provider', () => ({
  useWorkspace: () => ({
    features: {
      auditExport: true,
      roleBulk: true,
      indexerControls: true,
      systemStatus: true,
    },
  }),
}))

vi.mock('@/lib/download', () => ({
  downloadTextFile: mocks.downloadTextFile,
  exportTimestamp: () => '20261029-1200',
}))

vi.mock('@/lib/data/use-data-provider', () => {
  const provider = {
    listRoles: mocks.listRoles,
    createRole: mocks.createRole,
    updateRole: mocks.updateRole,
    revokeRole: mocks.revokeRole,
    importRoles: mocks.importRoles,
    exportRoles: mocks.exportRoles,
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

const bindings: RoleBinding[] = [
  {
    subject: 'did:web:ops.selfcommand.example',
    role: 'admin',
    grantedBy: 'did:plc:bootstrapadmin',
    note: '平台负责人',
    createdAt: '2026-10-20T02:00:00.000Z',
    updatedAt: '2026-10-20T02:00:00.000Z',
  },
  {
    subject: 'did:web:moderation.selfcommand.example',
    role: 'operator',
    grantedBy: 'did:web:ops.selfcommand.example',
    createdAt: '2026-10-21T02:00:00.000Z',
    updatedAt: '2026-10-21T02:00:00.000Z',
  },
]

describe('roles page', () => {
  beforeEach(() => {
    mocks.listRoles.mockReset()
    mocks.createRole.mockReset()
    mocks.updateRole.mockReset()
    mocks.revokeRole.mockReset()
    mocks.importRoles.mockReset()
    mocks.exportRoles.mockReset()
    mocks.createApproval.mockReset()
    mocks.downloadTextFile.mockReset()
    mocks.listRoles.mockResolvedValue({ roles: bindings, total: bindings.length })
  })

  it('surfaces the duplicate binding conflict without closing the dialog', async () => {
    mocks.createRole.mockRejectedValue(new AdminApiError('conflict', 409, 'RoleExists'))
    const user = userEvent.setup()
    render(<RolesPage />)

    await screen.findByText('平台负责人')
    await user.click(screen.getByRole('button', { name: '新增角色' }))

    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('成员账号标识'), {
      target: { value: 'did:web:moderation.selfcommand.example' },
    })
    await user.click(within(dialog).getByRole('button', { name: '授予角色' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '该 DID 已有角色，请改为修改角色。',
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('blocks revoking the last administrator with a protection error', async () => {
    mocks.revokeRole.mockRejectedValue(new AdminApiError('conflict', 409, 'LastAdmin'))
    const user = userEvent.setup()
    render(<RolesPage />)

    const subject = (
      await screen.findAllByTitle('did:web:ops.selfcommand.example')
    ).find((element) => element.tagName === 'P')
    const row = subject?.closest('tr')
    if (!row) throw new Error('role row not found')

    await user.click(within(row).getByRole('button', { name: '角色操作' }))
    await user.click(await screen.findByRole('menuitem', { name: '撤销角色' }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: '确认撤销' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '不能撤销或降级最后一名管理员。',
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('turns a revoke approval requirement into an approval request', async () => {
    mocks.revokeRole.mockRejectedValue(new AdminApiError('conflict', 409, 'ApprovalRequired'))
    mocks.createApproval.mockResolvedValue({
      id: 'ap-9',
      action: 'role.revoke',
      target: 'did:web:ops.selfcommand.example',
      summary: '撤销 did:web:ops.selfcommand.example 的管理员角色',
      status: 'pending',
      requestedBy: 'did:web:ops.selfcommand.example',
      requestedAt: '2026-10-29T04:00:00.000Z',
      expiresAt: '2026-10-30T04:00:00.000Z',
    })
    const user = userEvent.setup()
    render(<RolesPage />)

    const subject = (
      await screen.findAllByTitle('did:web:ops.selfcommand.example')
    ).find((element) => element.tagName === 'P')
    const row = subject?.closest('tr')
    if (!row) throw new Error('role row not found')

    await user.click(within(row).getByRole('button', { name: '角色操作' }))
    await user.click(await screen.findByRole('menuitem', { name: '撤销角色' }))
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '确认撤销' }),
    )

    const approvalDialog = await screen.findByRole('dialog', { name: /发起审批请求/ })
    await user.click(
      within(approvalDialog).getByRole('button', { name: '发起审批请求' }),
    )

    await waitFor(() =>
      expect(mocks.createApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'role.revoke',
          target: 'did:web:ops.selfcommand.example',
          payload: { subject: 'did:web:ops.selfcommand.example' },
        }),
      ),
    )
    expect(await within(approvalDialog).findByText('审批编号')).toBeInTheDocument()
  })

  it('renders the permission matrix with server-side role grants', async () => {
    const user = userEvent.setup()
    render(<RolesPage />)

    await screen.findByText('平台负责人')
    await user.click(screen.getByRole('button', { name: '权限矩阵' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('查看账号目录')).toBeInTheDocument()
    expect(within(dialog).getAllByLabelText('管理员拥有此权限').length).toBeGreaterThan(0)
    expect(within(dialog).getAllByLabelText('运营没有此权限').length).toBeGreaterThan(0)
  })

  it('marks duplicate rows during import and keeps the batch unwritten', async () => {
    const user = userEvent.setup()
    render(<RolesPage />)
    await screen.findByText('平台负责人')
    await user.click(screen.getByRole('button', { name: '批量导入' }))

    const dialog = await screen.findByRole('dialog')
    const file = new File(
      [
        'subject,role,note\n' +
          'did:plc:new1,operator,新成员\n' +
          'did:plc:new1,viewer,重复成员\n',
      ],
      'roles.csv',
      { type: 'text/csv' },
    )
    const input = dialog.querySelector('input[type="file"]')
    if (!input) throw new Error('file input not found')
    fireEvent.change(input, { target: { files: [file] } })

    expect(await within(dialog).findByText('与第 1 行账号标识重复')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /导入/ })).toBeDisabled()
    expect(mocks.importRoles).not.toHaveBeenCalled()
  })

  it('submits a valid import batch and reports the imported rows', async () => {
    mocks.importRoles.mockResolvedValue({ imported: 2, batchId: 'batch-1' })
    const user = userEvent.setup()
    render(<RolesPage />)
    await screen.findByText('平台负责人')
    await user.click(screen.getByRole('button', { name: '批量导入' }))

    const dialog = await screen.findByRole('dialog')
    const file = new File(
      [
        'subject,role,note\n' +
          'did:plc:new1,operator,新成员\n' +
          'did:plc:new2,viewer,\n',
      ],
      'roles.csv',
      { type: 'text/csv' },
    )
    const input = dialog.querySelector('input[type="file"]')
    if (!input) throw new Error('file input not found')
    fireEvent.change(input, { target: { files: [file] } })

    expect(await within(dialog).findAllByText('可导入')).toHaveLength(2)
    await user.click(within(dialog).getByRole('button', { name: /导入 2 条/ }))

    await waitFor(() =>
      expect(mocks.importRoles).toHaveBeenCalledWith([
        { subject: 'did:plc:new1', role: 'operator', note: '新成员' },
        { subject: 'did:plc:new2', role: 'viewer' },
      ]),
    )
  })

  it('exports the role bindings as a JSON download', async () => {
    mocks.exportRoles.mockResolvedValue({
      bindings,
      total: bindings.length,
      exportedAt: '2026-10-29T04:00:00.000Z',
    })
    const user = userEvent.setup()
    render(<RolesPage />)
    await screen.findByText('平台负责人')

    await user.click(screen.getByRole('button', { name: '导出' }))

    await waitFor(() => expect(mocks.downloadTextFile).toHaveBeenCalledTimes(1))
    const [filename, content, mime] = mocks.downloadTextFile.mock.calls[0] ?? []
    expect(filename).toBe('roles-20261029-1200.json')
    expect(mime).toBe('application/json')
    const parsed = JSON.parse(content as string) as {
      total: number
      bindings: RoleBinding[]
    }
    expect(parsed.total).toBe(bindings.length)
    expect(parsed.bindings).toHaveLength(bindings.length)
    expect(parsed.bindings[0]?.subject).toBe(bindings[0]?.subject)
  })
})
