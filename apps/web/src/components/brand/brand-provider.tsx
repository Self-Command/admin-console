'use client'

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { ShieldCheckIcon } from 'lucide-react'
import { resolveLogoUrl } from '@/lib/runtime/public-settings'
import type { PublicSettings } from '@/lib/runtime/types'
import { cn } from '@/lib/utils'

type BrandContextValue = {
  settings: PublicSettings
  logoUrl?: string
}

const BrandContext = createContext<BrandContextValue | null>(null)

export function BrandProvider({
  settings,
  children,
}: {
  settings: PublicSettings
  children: ReactNode
}) {
  const value = useMemo<BrandContextValue>(
    () => ({ settings, logoUrl: resolveLogoUrl(settings.branding) }),
    [settings],
  )
  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>
}

export function useBrand(): BrandContextValue {
  const context = useContext(BrandContext)
  if (!context) throw new Error('useBrand must be used inside BrandProvider')
  return context
}

export function BrandLogo({
  className,
  alt,
}: {
  className?: string
  alt?: string
}) {
  const { settings, logoUrl } = useBrand()
  const [failed, setFailed] = useState(false)
  const label = alt ?? `${settings.branding.shortName}标志`

  if (logoUrl && !failed) {
    return (
      // Uploaded or configured logos come from runtime settings, not the asset pipeline.
      <img
        src={logoUrl}
        alt={label}
        className={cn('size-5 object-contain', className)}
        onError={() => setFailed(true)}
      />
    )
  }

  return <ShieldCheckIcon className={cn('size-5', className)} aria-label={label} />
}
