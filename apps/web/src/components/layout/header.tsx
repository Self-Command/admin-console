'use client'

import { usePathname } from 'next/navigation'
import { MenuIcon, SearchIcon } from 'lucide-react'
import { useBrand } from '@/components/brand/brand-provider'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { UserMenu } from '@/components/layout/user-menu'
import { useWorkspace } from '@/components/layout/workspace-provider'
import { pageTitleForPath } from '@/lib/navigation'

export function Header({
  onOpenMobileNav,
  onOpenPalette,
}: {
  onOpenMobileNav: () => void
  onOpenPalette: () => void
}) {
  const pathname = usePathname()
  const { settings } = useBrand()
  const { groups } = useWorkspace()
  const title = pageTitleForPath(groups, pathname)

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
          <p className="truncate text-sm font-semibold">{title}</p>
          <p className="hidden truncate text-xs text-muted-foreground sm:block">
            {settings.branding.name}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="gap-2 text-muted-foreground"
            onClick={onOpenPalette}
            aria-label="搜索页面"
          >
            <SearchIcon className="size-3.5" />
            <span className="hidden sm:inline">搜索页面</span>
            <kbd className="hidden rounded border bg-muted px-1.5 font-mono text-[10px] sm:inline">
              Ctrl K
            </kbd>
          </Button>
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  )
}
