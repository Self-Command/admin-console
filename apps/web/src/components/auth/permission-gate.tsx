'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/components/auth/auth-provider'
import { ForbiddenView } from '@/components/forbidden-view'
import { hasPermission, permissionForPath } from '@/lib/access'

export function PermissionGate({ children }: { children: ReactNode }) {
  const { identity } = useAuth()
  const pathname = usePathname()
  const required = permissionForPath(pathname ?? '/')

  if (required && !hasPermission(identity, required)) {
    return <ForbiddenView />
  }

  return children
}
