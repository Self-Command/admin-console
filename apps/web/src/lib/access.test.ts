import { describe, expect, it } from 'vitest'
import { hasPermission, permissionForPath } from '@/lib/access'
import { resolveNavigation } from '@/lib/navigation'
import { DEFAULT_FEATURES, DEFAULT_NAVIGATION } from '@/lib/runtime/defaults'
import { allPermissions, rolePermissions, type Permission } from '@/lib/roles'

const admin: { permissions: Permission[] } = { permissions: [...allPermissions] }
const operator: { permissions: Permission[] } = {
  permissions: [...rolePermissions.operator],
}
const viewer: { permissions: Permission[] } = { permissions: [...rolePermissions.viewer] }
const unbound = { permissions: [] as Permission[] }

function titles(identity: { permissions: Permission[] }) {
  return resolveNavigation(DEFAULT_NAVIGATION, DEFAULT_FEATURES, identity)
    .flatMap((group) => group.items)
    .map((item) => item.title)
}

describe('route permissions', () => {
  it('maps console routes to their required permission', () => {
    expect(permissionForPath('/content')).toBe('content.read')
    expect(permissionForPath('/moderation/reports')).toBe('moderation.read')
    expect(permissionForPath('/moderation/reports/12')).toBe('moderation.read')
    expect(permissionForPath('/moderation/queues')).toBe('moderation.read')
    expect(permissionForPath('/directory')).toBe('directory.read')
    expect(permissionForPath('/directory/alice')).toBe('directory.read')
    expect(permissionForPath('/roles')).toBe('role.read')
    expect(permissionForPath('/audit')).toBe('audit.read')
    expect(permissionForPath('/verification')).toBe('verification.read')
    expect(permissionForPath('/notifications')).toBe('notification.read')
    expect(permissionForPath('/announcements')).toBe('announcement.read')
    expect(permissionForPath('/policy')).toBe('policy.read')
    expect(permissionForPath('/settings')).toBe('settings.read')
    expect(permissionForPath('/system')).toBe('settings.read')
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
    expect(titles(admin)).toEqual([
      '总览',
      '内容检索',
      '举报处理',
      '举报队列',
      '处置记录',
      '处置状态',
      '定时处置',
      '审核分析',
      '账号目录',
      '管理员与角色',
      '审计日志',
      '安全与审批',
      '账号认证',
      '通知中心',
      '站内公告',
      '审核策略',
      '系统状态',
      '系统设置',
      '个人资料',
    ])
  })

  it('limits operators and viewers to read-only modules', () => {
    const readOnly = [
      '总览',
      '内容检索',
      '举报处理',
      '举报队列',
      '处置记录',
      '处置状态',
      '定时处置',
      '审核分析',
      '账号目录',
    ]
    expect(titles(operator)).toEqual([...readOnly, '通知中心', '站内公告', '个人资料'])
    expect(titles(viewer)).toEqual([...readOnly, '账号认证', '个人资料'])
  })

  it('shows only the dashboard and profile to accounts without a role', () => {
    expect(titles(unbound)).toEqual(['总览', '个人资料'])
  })
})
