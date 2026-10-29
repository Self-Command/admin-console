import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PermissionGate } from '@/components/auth/permission-gate'
import type { Permission } from '@/lib/roles'

const state = vi.hoisted(() => ({
  pathname: '/roles',
  permissions: [] as Permission[],
}))

vi.mock('next/navigation', () => ({
  usePathname: () => state.pathname,
}))

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

vi.mock('@/components/auth/auth-provider', () => ({
  useAuth: () => ({
    identity: { did: 'did:plc:alice', permissions: state.permissions },
  }),
}))

describe('permission gate', () => {
  it('renders the forbidden view and does not mount protected children', () => {
    state.pathname = '/roles'
    state.permissions = ['directory.read']

    render(
      <PermissionGate>
        <div>角色数据</div>
      </PermissionGate>,
    )

    expect(screen.queryByText('角色数据')).toBeNull()
    expect(screen.getByText('无权访问此页面')).toBeInTheDocument()
  })

  it('renders children when the permission matches', () => {
    state.pathname = '/roles'
    state.permissions = ['directory.read', 'role.read']

    render(
      <PermissionGate>
        <div>角色数据</div>
      </PermissionGate>,
    )

    expect(screen.getByText('角色数据')).toBeInTheDocument()
  })

  it('leaves unprotected routes alone', () => {
    state.pathname = '/'
    state.permissions = []

    render(
      <PermissionGate>
        <div>总览</div>
      </PermissionGate>,
    )

    expect(screen.getByText('总览')).toBeInTheDocument()
  })

  it('keeps operators out of the audit route without mounting it', () => {
    state.pathname = '/audit'
    state.permissions = ['directory.read']
    const load = vi.fn()

    function AuditData() {
      load()
      return <div>审计数据</div>
    }

    render(
      <PermissionGate>
        <AuditData />
      </PermissionGate>,
    )

    expect(load).not.toHaveBeenCalled()
    expect(screen.queryByText('审计数据')).toBeNull()
    expect(screen.getByText('无权访问此页面')).toBeInTheDocument()
  })
})
