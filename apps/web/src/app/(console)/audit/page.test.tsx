import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuditEvent } from '@/lib/data/types'
import AuditPage from '@/app/(console)/audit/page'

const mocks = vi.hoisted(() => ({ listAudit: vi.fn() }))

vi.mock('@/components/auth/auth-provider', () => ({
  useAuth: () => ({
    identity: {
      did: 'did:web:ops.selfcommand.example',
      role: 'admin',
      permissions: ['directory.read', 'role.read', 'role.write', 'audit.read'],
    },
    preview: true,
  }),
}))

vi.mock('@/lib/data/use-data-provider', () => {
  const provider = { listAudit: mocks.listAudit }
  return { useDataProvider: () => provider }
})

function event(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: 'evt_01',
    action: 'com.selfcommand.admin.role.create',
    actor: 'did:web:ops.selfcommand.example',
    result: 'denied',
    targetType: 'role',
    target: 'did:plc:alice',
    detail: '缺少 role.write 权限',
    createdAt: '2026-10-29T06:47:09.000Z',
    ...overrides,
  }
}

describe('audit page', () => {
  beforeEach(() => {
    mocks.listAudit.mockReset()
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
      action: undefined,
      result: undefined,
      since: undefined,
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

    const input = screen.getByLabelText('按操作者 DID 过滤')
    await user.type(input, 'did:plc')
    await user.click(screen.getByRole('button', { name: '应用' }))

    expect(screen.getByText(/请输入完整 DID/)).toBeInTheDocument()
    expect(mocks.listAudit).toHaveBeenCalledTimes(1)
    expect(mocks.listAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ actor: 'did:plc' }),
    )

    await user.clear(input)
    await user.type(input, 'did:plc:alice')
    await user.click(screen.getByRole('button', { name: '应用' }))

    await waitFor(() =>
      expect(mocks.listAudit).toHaveBeenLastCalledWith(
        expect.objectContaining({ actor: 'did:plc:alice' }),
      ),
    )
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
