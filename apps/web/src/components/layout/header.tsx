'use client'

import { usePathname } from 'next/navigation'
import { MenuIcon } from 'lucide-react'
import { brand } from '@/config/brand'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { UserMenu } from '@/components/layout/user-menu'

export function Header({ onOpenMobileNav }: { onOpenMobileNav: () => void }) {
  const pathname = usePathname()
  const current = brand.nav.find((item) =>
    item.href === '/' ? pathname === '/' : pathname.startsWith(item.href),
  )

  return (
    <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={onOpenMobileNav}
          aria-label="打开导航"
        >
          <MenuIcon />
        </Button>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{current?.title ?? '管理后台'}</p>
          <p className="hidden truncate text-xs text-muted-foreground sm:block">
            {brand.name}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Badge
            variant="warning"
            className="hidden h-7 gap-1.5 px-2.5 sm:inline-flex"
          >
            <span className="size-1.5 rounded-full bg-warning" />
            预览模式
          </Badge>
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  )
}
