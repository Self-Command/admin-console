import type { Permission } from '@/lib/roles'

export const routePermissions: Readonly<Record<string, Permission>> = {
  '/directory': 'directory.read',
  '/roles': 'role.read',
  '/audit': 'audit.read',
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

export function allowedNavItems<T extends { href: string; permission?: Permission }>(
  items: readonly T[],
  identity: { permissions: readonly string[] } | null | undefined,
): T[] {
  return items.filter((item) => !item.permission || hasPermission(identity, item.permission))
}
