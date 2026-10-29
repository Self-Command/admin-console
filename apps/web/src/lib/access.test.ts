import { describe, expect, it } from 'vitest'
import { brand } from '@/config/brand'
import {
  allowedNavItems,
  hasPermission,
  permissionForPath,
} from '@/lib/access'
import type { Permission } from '@/lib/roles'

const admin: { permissions: Permission[] } = {
  permissions: ['directory.read', 'role.read', 'role.write', 'audit.read'],
}
const operator: { permissions: Permission[] } = { permissions: ['directory.read'] }
const viewer: { permissions: Permission[] } = { permissions: ['directory.read'] }
const unbound = { permissions: [] as Permission[] }

function titles(identity: { permissions: Permission[] }) {
  return allowedNavItems(brand.nav, identity).map((item) => item.title)
}

describe('route permissions', () => {
  it('maps console routes to their required permission', () => {
    expect(permissionForPath('/directory')).toBe('directory.read')
    expect(permissionForPath('/directory/alice')).toBe('directory.read')
    expect(permissionForPath('/roles')).toBe('role.read')
    expect(permissionForPath('/audit')).toBe('audit.read')
    expect(permissionForPath('/')).toBeNull()
    expect(permissionForPath('/forbidden')).toBeNull()
    expect(permissionForPath('/rolesomething')).toBeNull()
  })

  it('checks permissions against the server-issued permission list', () => {
    expect(hasPermission(admin, 'role.write')).toBe(true)
    expect(hasPermission(operator, 'role.write')).toBe(false)
    expect(hasPermission(viewer, 'audit.read')).toBe(false)
    expect(hasPermission(null, 'directory.read')).toBe(false)
  })
})

describe('role navigation visibility', () => {
  it('shows every module to admins', () => {
    expect(titles(admin)).toEqual(['总览', '账号目录', '管理员与角色', '审计日志'])
  })

  it('limits operators and viewers to read-only modules', () => {
    expect(titles(operator)).toEqual(['总览', '账号目录'])
    expect(titles(viewer)).toEqual(['总览', '账号目录'])
  })

  it('shows only the dashboard to accounts without a role', () => {
    expect(titles(unbound)).toEqual(['总览'])
  })
})
