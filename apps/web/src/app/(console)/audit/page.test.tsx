import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuditEvent } from '@/lib/data/types'
import { AdminApiError } from '@/lib/api/admin-client'
import AuditPage from '@/app/(console)/audit/page'

const mocks = vi.hoisted(() => ({
  listAudit: vi.fn(),
  exportAudit: vi.fn(),
  downloadTextFile: vi.fn(),
  toastError: vi.fn(),
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
    pageSize: 10,
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
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: mocks.toastError,
  },
}))

vi.mock('@/lib/data/use-data-provider', () => {
  const provider = {
    listAudit: mocks.listAudit,
    exportAudit: mocks.exportAudit,
  }
  return { useDataProvider: () => provider }
})

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub)

function event(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: 'evt_01',
    action: 'com.selfcommand.admin.role.create',
    actor: 'did:web:ops.selfcommand.example',
    result: 'denied',
    targetType: 'role',
    target: 'did:plc:alice',
    detail: '缺少 role.write 权限',
    requestId: 'req_123',
    actorIp: '203.0.113.10',
    userAgent: 'Mozilla/5.0',
    before: { role: null },
    after: { role: 'operator' },
    createdAt: '2026-10-29T06:47:09.000Z',
    ...overrides,
  }
}

describe('audit page', () => {
  beforeEach(() => {
    mocks.listAudit.mockReset()
    mocks.exportAudit.mockReset()
    mocks.downloadTextFile.mockReset()
    mocks.toastError.mockReset()
  })

  it('renders server-side filters, badges and sends them to the provider', async () => {
    const user = userEvent.setup()
    mocks.listAudit.mockResolvedValue({ events: [event()], total: 1 })

    render(<AuditPage />)

    const table = await screen.findByRole('table')
    expect(within(table).getByText('授予角色')).toBeInTheDocument()
    expect(within(table).getByText('拒绝')).toBeInTheDocument()
    expect(mocks.listAudit).toHaveBeenCalledWith({
      cursor: undefined,
      limit: 10,
      actor: undefined,
      target: undefined,
      action: undefined,
      result: undefined,
      since: undefined,
      sort: 'createdAt',
      order: 'desc',
    })

    await user.selectOptions(
      screen.getByLabelText('按动作过滤'),
      'com.selfcommand.admin.role.update',
    )
    await user.selectOptions(screen.getByLabelText('按结果过滤'), 'error')

    await waitFor(() =>
      expect(mocks.listAudit).toHaveBeenLastCalledWith(
        expect.objectContaining({
          action: 'com.selfcommand.admin.role.update',
          result: 'error',
          cursor: undefined,
        }),
      ),
    )
  })

  it('applies only a complete operator DID and rejects partial input', async () => {
    const user = userEvent.setup()
    mocks.listAudit.mockResolvedValue({ events: [], total: 0 })

    render(<AuditPage />)

    await waitFor(() => expect(mocks.listAudit).toHaveBeenCalledTimes(1))

    const input = screen.getByLabelText('按操作者账号标识过滤')
    await user.type(input, 'did:plc')
    await user.click(screen.getAllByRole('button', { name: '应用' })[0] as HTMLElement)

    expect(screen.getByText(/请输入完整的账号标识/)).toBeInTheDocument()
    expect(mocks.listAudit).toHaveBeenCalledTimes(1)
    expect(mocks.listAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ actor: 'did:plc' }),
    )

    await user.clear(input)
    await user.type(input, 'did:plc:alice')
    await user.click(screen.getAllByRole('button', { name: '应用' })[0] as HTMLElement)

    await waitFor(() =>
      expect(mocks.listAudit).toHaveBeenLastCalledWith(
        expect.objectContaining({ actor: 'did:plc:alice' }),
      ),
    )
  })

  it('filters by target and applies the selected sort order', async () => {
    const user = userEvent.setup()
    mocks.listAudit.mockResolvedValue({ events: [event()], total: 1 })

    render(<AuditPage />)
    await screen.findByRole('table')

    await user.type(screen.getByLabelText('按对象标识过滤'), 'did:plc:alice')
    await user.click(screen.getAllByRole('button', { name: '应用' })[1] as HTMLElement)
    await user.selectOptions(screen.getByLabelText('排序方式'), 'actor:asc')

    await waitFor(() =>
      expect(mocks.listAudit).toHaveBeenLastCalledWith(
        expect.objectContaining({ target: 'did:plc:alice', sort: 'actor', order: 'asc' }),
      ),
    )
  })

  it('shows request identifiers, client details and before/after values', async () => {
    const user = userEvent.setup()
    mocks.listAudit.mockResolvedValue({ events: [event()], total: 1 })

    render(<AuditPage />)
    await screen.findByRole('table')
    await user.click(screen.getByRole('button', { name: '详情' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('req_123')).toBeInTheDocument()
    expect(within(dialog).getByText('203.0.113.10')).toBeInTheDocument()
    expect(within(dialog).getByText('Mozilla/5.0')).toBeInTheDocument()
    expect(within(dialog).getByText(/"role": null/)).toBeInTheDocument()
    expect(within(dialog).getByText(/"role": "operator"/)).toBeInTheDocument()
  })

  it('exports the filtered records as a downloaded file', async () => {
    const user = userEvent.setup()
    mocks.listAudit.mockResolvedValue({ events: [event()], total: 1 })
    mocks.exportAudit.mockResolvedValue({
      filename: 'audit-2026-10-29.csv',
      contentType: 'text/csv; charset=utf-8',
      content: 'id,action',
      rows: 1,
    })

    render(<AuditPage />)
    await screen.findByRole('table')
    await user.click(screen.getByRole('button', { name: '导出' }))
    await user.click(await screen.findByRole('menuitem', { name: '导出 CSV（表格）' }))

    await waitFor(() =>
      expect(mocks.downloadTextFile).toHaveBeenCalledWith(
        'audit-2026-10-29.csv',
        'id,action',
        'text/csv; charset=utf-8',
      ),
    )
    expect(mocks.exportAudit).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'csv', actor: undefined, target: undefined }),
    )
  })

  it('reports the export limit in plain language', async () => {
    const user = userEvent.setup()
    mocks.listAudit.mockResolvedValue({ events: [event()], total: 1 })
    mocks.exportAudit.mockRejectedValue(new AdminApiError('validation', 413, 'ExportTooLarge'))

    render(<AuditPage />)
    await screen.findByRole('table')
    await user.click(screen.getByRole('button', { name: '导出' }))
    await user.click(await screen.findByRole('menuitem', { name: '导出 JSON（原始记录）' }))

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        '导出记录超过上限，请缩小时间范围或增加过滤条件后重试。',
      ),
    )
    expect(mocks.downloadTextFile).not.toHaveBeenCalled()
  })

  it('pages forward with the server cursor', async () => {
    const user = userEvent.setup()
    mocks.listAudit.mockResolvedValue({
      events: Array.from({ length: 10 }, (_, index) =>
        event({ id: `evt_${index}`, actor: `did:plc:actor${index}` }),
      ),
      total: 12,
      cursor: '10',
    })

    render(<AuditPage />)

    await screen.findByRole('table')
    await user.click(screen.getByRole('button', { name: '下一页' }))

    await waitFor(() =>
      expect(mocks.listAudit).toHaveBeenLastCalledWith(
        expect.objectContaining({ cursor: '10' }),
      ),
    )
  })
})
