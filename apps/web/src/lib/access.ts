import type { Permission } from '@/lib/roles'

export const routePermissions: Readonly<Record<string, Permission>> = {
  '/content': 'content.read',
  '/moderation': 'moderation.read',
  '/directory': 'directory.read',
  '/roles': 'role.read',
  '/audit': 'audit.read',
  '/security': 'security.read',
  '/verification': 'verification.read',
  '/notifications': 'notification.read',
  '/announcements': 'announcement.read',
  '/policy': 'policy.read',
  '/settings': 'settings.read',
  '/system': 'settings.read',
}

export function permissionForPath(pathname: string): Permission | null {
  const route = Object.keys(routePermissions).find(
    (item) => pathname === item || pathname.startsWith(`${item}/`),
  )
  return route ? (routePermissions[route] ?? null) : null
}

export function hasPermission(
  identity: { permissions: readonly string[] } | null | undefined,
  permission: Permission,
): boolean {
  return identity?.permissions.includes(permission) ?? false
}

export function hasAnyPermission(
  identity: { permissions: readonly string[] } | null | undefined,
  permissions: readonly Permission[],
): boolean {
  return permissions.some((permission) => hasPermission(identity, permission))
}
