export type RoleName = 'admin' | 'operator' | 'viewer'

export type Permission = 'directory.read' | 'role.read' | 'role.write' | 'audit.read'

export const roleLabels: Record<RoleName, string> = {
  admin: '管理员',
  operator: '运营',
  viewer: '只读',
}

export const roleDescriptions: Record<RoleName, string> = {
  admin: '全部权限，含角色与审计管理',
  operator: '只读账号目录，可执行日常运营',
  viewer: '仅可查看账号目录',
}

export function isRoleName(value: unknown): value is RoleName {
  return value === 'admin' || value === 'operator' || value === 'viewer'
}
