'use client'

import { useMemo } from 'react'
import { useAuth } from '@/components/auth/auth-provider'
import { createAdminDataProvider } from '@/lib/data/admin-data-provider'
import type { DataProvider } from '@/lib/data/provider'

export function useDataProvider(): DataProvider {
  const { callAdmin } = useAuth()
  return useMemo(() => createAdminDataProvider(callAdmin), [callAdmin])
}
