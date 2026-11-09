import { Suspense } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { ShieldCheckIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { BrandLogo } from '@/components/brand/brand-provider'
import { LoginForm } from '@/app/login/login-form'
import { getPublicSettings } from '@/lib/runtime/public-settings'
import { cn } from '@/lib/utils'

export const metadata: Metadata = {
  title: '登录',
}

export default async function LoginPage() {
  const { branding, login } = await getPublicSettings()
  const neutral = login.background === 'none'

  return (
    <div className="grid min-h-svh lg:grid-cols-[1.05fr_1fr]">
      <div
        className={cn(
          'relative hidden overflow-hidden p-10 lg:flex lg:flex-col lg:justify-between',
          neutral
            ? 'border-r bg-muted/40 text-foreground'
            : 'bg-primary text-primary-foreground',
        )}
        style={
          login.background === 'gradient'
            ? {
                backgroundImage:
                  'linear-gradient(135deg, var(--primary) 0%, color-mix(in oklab, var(--primary) 52%, var(--accent)) 100%)',
              }
            : undefined
        }
      >
        {login.background === 'gradient' ? (
          <>
            <div className="pointer-events-none absolute -top-24 -right-24 size-96 rounded-full bg-white/10 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-32 -left-16 size-96 rounded-full bg-black/10 blur-3xl" />
          </>
        ) : null}
        <div className="relative flex items-center gap-3">
          <span
            className={cn(
              'flex size-10 items-center justify-center rounded-xl',
              neutral ? 'bg-primary text-primary-foreground' : 'bg-white/15',
            )}
          >
            <BrandLogo className="size-5" />
          </span>
          <div>
            <p className="text-sm font-semibold">{branding.name}</p>
            <p className={cn('text-xs', neutral ? 'text-muted-foreground' : 'text-primary-foreground/70')}>
              运营控制台
            </p>
          </div>
        </div>
        <div className="relative max-w-md space-y-4">
          <Badge
            className={cn(
              neutral
                ? ''
                : 'border-white/20 bg-white/10 text-primary-foreground',
            )}
          >
            统一管理账号、角色与审计
          </Badge>
          <h1 className="text-3xl leading-tight font-semibold tracking-tight">
            {branding.description}
          </h1>
          <ul
            className={cn(
              'space-y-2 text-sm leading-relaxed',
              neutral ? 'text-muted-foreground' : 'text-primary-foreground/75',
            )}
          >
            <li>账号目录由服务端统一索引，权限按角色校验。</li>
            <li>角色变更与审计记录同库保存，操作可追溯。</li>
            <li>品牌、外观与导航由系统设置统一维护。</li>
          </ul>
        </div>
        <div
          className={cn(
            'relative flex items-center gap-2 text-xs',
            neutral ? 'text-muted-foreground' : 'text-primary-foreground/60',
          )}
        >
          <ShieldCheckIcon className="size-3.5" />
          平台统一维护 · 最小权限 · 全程审计
        </div>
      </div>

      <div className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm space-y-8">
          <div className="flex items-center gap-3 lg:hidden">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <BrandLogo className="size-5" />
            </span>
            <div>
              <p className="text-sm font-semibold">{branding.shortName}</p>
              <p className="text-xs text-muted-foreground">运营控制台</p>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
              管理后台
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">{login.headline}</h1>
            <p className="text-sm text-muted-foreground">{login.subheadline}</p>
          </div>

          <Suspense fallback={<div className="h-[336px]" />}>
            <LoginForm />
          </Suspense>

          <div className="space-y-2 text-center text-xs text-muted-foreground">
            <p>{login.footer}</p>
            {login.legalLinks.length > 0 || branding.supportUrl || branding.docsUrl ? (
              <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
                {login.legalLinks.map((link) =>
                  link.url.startsWith('/') ? (
                    <Link key={`${link.label}-${link.url}`} href={link.url} className="hover:text-foreground">
                      {link.label}
                    </Link>
                  ) : (
                    <a
                      key={`${link.label}-${link.url}`}
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-foreground"
                    >
                      {link.label}
                    </a>
                  ),
                )}
                {branding.docsUrl ? (
                  <a href={branding.docsUrl} target="_blank" rel="noreferrer" className="hover:text-foreground">
                    帮助文档
                  </a>
                ) : null}
                {branding.supportUrl ? (
                  <a href={branding.supportUrl} target="_blank" rel="noreferrer" className="hover:text-foreground">
                    联系支持
                  </a>
                ) : null}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
