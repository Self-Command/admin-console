import type { ReactNode } from 'react'
import { AppShell } from '@/components/layout/app-shell'
import { PermissionGate } from '@/components/auth/permission-gate'
import { RequireAuth } from '@/components/auth/require-auth'

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <AppShell>
        <PermissionGate>{children}</PermissionGate>
      </AppShell>
    </RequireAuth>
  )
}
