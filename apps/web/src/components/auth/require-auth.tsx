'use client'

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { LoaderCircleIcon } from 'lucide-react'
import { useAuth } from '@/components/auth/auth-provider'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (status !== 'anonymous') return
    const next = pathname && pathname !== '/' ? `?next=${encodeURIComponent(pathname)}` : ''
    router.replace(`/login${next}`)
  }, [status, router, pathname])

  if (status !== 'authenticated') {
    return (
      <div className="grid min-h-svh place-items-center">
        <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return children
}
