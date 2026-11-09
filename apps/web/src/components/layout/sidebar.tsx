'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BrandLogo, useBrand } from '@/components/brand/brand-provider'
import { useWorkspace } from '@/components/layout/workspace-provider'
import { findNavItem } from '@/lib/navigation'
import { adminApiConfig, appVersion } from '@/lib/config'
import { cn } from '@/lib/utils'

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()
  const { settings } = useBrand()
  const { groups, status } = useWorkspace()
  const activeItem = findNavItem(groups, pathname)

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
          <BrandLogo className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{settings.branding.shortName}</p>
          <p className="truncate text-xs text-muted-foreground">运营控制台</p>
        </div>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
        {groups.map((group) => (
          <div key={group.id}>
            <p className="px-3 pb-2 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
              {group.label}
            </p>
            <ul className="space-y-1">
              {group.items.map((item) => {
                const active = activeItem?.id === item.id
                const Icon = item.icon
                return (
                  <li key={item.id}>
                    {item.external ? (
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                      >
                        <Icon className="size-4" />
                        {item.title}
                      </a>
                    ) : (
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        className={cn(
                          'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                          active
                            ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-xs'
                            : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                        )}
                      >
                        <Icon className="size-4" />
                        {item.title}
                      </Link>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <div className="rounded-lg border bg-card p-3">
          <div className="flex items-center gap-2 text-xs font-medium">
            <span
              className={cn(
                'size-2 rounded-full',
                status === 'ready' ? 'bg-success' : 'bg-warning',
              )}
            />
            {status === 'ready' ? '后台服务已连接' : '正在加载工作区配置'}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            角色与审计由服务端校验。
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            v{appVersion} · {adminApiConfig.url.replace(/^https?:\/\//, '')}
          </p>
        </div>
      </div>
    </div>
  )
}
