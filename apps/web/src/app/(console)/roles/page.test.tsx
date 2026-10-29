import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import RolesPage from '@/app/(console)/roles/page'

vi.mock('@/components/auth/auth-provider', () => ({
  useAuth: () => ({
    identity: {
      did: 'did:web:ops.selfcommand.example',
      role: 'admin',
      permissions: ['directory.read', 'role.read', 'role.write', 'audit.read'],
    },
    preview: true,
    callAdmin: vi.fn(),
  }),
}))

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub)

describe('roles page', () => {
  it('surfaces the duplicate binding conflict without closing the dialog', async () => {
    const user = userEvent.setup()
    render(<RolesPage />)

    await screen.findByText('平台负责人')
    await user.click(screen.getByRole('button', { name: '新增角色' }))

    const dialog = await screen.findByRole('dialog')
    await user.type(
      within(dialog).getByLabelText('成员 DID'),
      'did:web:moderation.selfcommand.example',
    )
    await user.click(within(dialog).getByRole('button', { name: '授予角色' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '该 DID 已有角色，请改为修改角色。',
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('blocks revoking the last administrator with a protection error', async () => {
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
})
