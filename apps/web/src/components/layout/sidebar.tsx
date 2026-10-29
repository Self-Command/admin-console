'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { brand } from '@/config/brand'
import { useAuth } from '@/components/auth/auth-provider'
import { Badge } from '@/components/ui/badge'
import { allowedNavItems } from '@/lib/access'
import { adminApiConfig } from '@/lib/config'
import { cn } from '@/lib/utils'

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()
  const { identity, preview } = useAuth()
  const Logo = brand.logo
  const navItems = allowedNavItems(brand.nav, identity)

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
          <Logo className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{brand.shortName}</p>
          <p className="truncate text-xs text-muted-foreground">运营控制台</p>
        </div>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
        <div>
          <p className="px-3 pb-2 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
            运营
          </p>
          <ul className="space-y-1">
            {navItems.map((item) => {
              const active =
                item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
              const Icon = item.icon

              if (item.soon) {
                return (
                  <li key={item.href}>
                    <span
                      aria-disabled="true"
                      className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground/70"
                    >
                      <Icon className="size-4" />
                      {item.title}
                      <Badge variant="outline" className="ml-auto px-1.5 text-[10px]">
                        下一批
                      </Badge>
                    </span>
                  </li>
                )
              }

              return (
                <li key={item.href}>
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
                </li>
              )
            })}
          </ul>
        </div>
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <div className="rounded-lg border bg-card p-3">
          {preview ? (
            <>
              <div className="flex items-center gap-2 text-xs font-medium">
                <span className="size-2 rounded-full bg-warning" />
                界面预览
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                本页修改只保存在浏览器内，不写入数据库。
              </p>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 text-xs font-medium">
                <span className="size-2 rounded-full bg-success" />
                admin-api 已连接
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                角色与审计由服务端校验。
              </p>
            </>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">
            v0.1.0 · {adminApiConfig.url.replace(/^https?:\/\//, '')}
          </p>
        </div>
      </div>
    </div>
  )
}
