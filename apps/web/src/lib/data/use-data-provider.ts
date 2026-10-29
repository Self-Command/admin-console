'use client'

import { useMemo } from 'react'
import { useAuth } from '@/components/auth/auth-provider'
import { createAdminDataProvider } from '@/lib/data/admin-data-provider'
import { previewDataProvider } from '@/lib/data/preview-data-provider'
import type { DataProvider } from '@/lib/data/provider'

export function useDataProvider(): DataProvider {
  const { preview, callAdmin } = useAuth()
  return useMemo(
    () => (preview ? previewDataProvider : createAdminDataProvider(callAdmin)),
    [preview, callAdmin],
  )
}
