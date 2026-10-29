import { Suspense } from 'react'
import type { Metadata } from 'next'
import { ShieldCheckIcon } from 'lucide-react'
import { brand } from '@/config/brand'
import { Badge } from '@/components/ui/badge'
import { LoginForm } from '@/app/login/login-form'

export const metadata: Metadata = {
  title: '登录',
}

export default function LoginPage() {
  const Logo = brand.logo

  return (
    <div className="grid min-h-svh lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden overflow-hidden bg-primary p-10 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -top-24 -right-24 size-96 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 size-96 rounded-full bg-black/10 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-white/15">
            <Logo className="size-5" />
          </span>
          <div>
            <p className="text-sm font-semibold">{brand.shortName}</p>
            <p className="text-xs text-primary-foreground/70">运营控制台</p>
          </div>
        </div>
        <div className="relative max-w-md space-y-4">
          <Badge className="border-white/20 bg-white/10 text-primary-foreground">
            AT Protocol · 企业运营
          </Badge>
          <h1 className="text-3xl leading-tight font-semibold tracking-tight">
            把账号、角色与审计，收进一个控制台。
          </h1>
          <p className="text-sm leading-relaxed text-primary-foreground/75">
            账号目录只读索引、服务端角色校验、全量操作审计。界面与数据分离，官方服务零补丁。
          </p>
        </div>
        <div className="relative flex items-center gap-2 text-xs text-primary-foreground/60">
          <ShieldCheckIcon className="size-3.5" />
          私有部署 · 服务间 JWT 校验 · 最小权限
        </div>
      </div>

      <div className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm space-y-8">
          <div className="flex items-center gap-3 lg:hidden">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Logo className="size-5" />
            </span>
            <div>
              <p className="text-sm font-semibold">{brand.shortName}</p>
              <p className="text-xs text-muted-foreground">运营控制台</p>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
              管理后台
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">登录 {brand.shortName}</h1>
            <p className="text-sm text-muted-foreground">
              使用所在 PDS 的账号登录；后台角色由服务端按 DID 校验。
            </p>
          </div>

          <Suspense fallback={<div className="h-[336px]" />}>
            <LoginForm />
          </Suspense>

          <p className="text-center text-xs text-muted-foreground">
            {brand.name} · v0.1.0
          </p>
        </div>
      </div>
    </div>
  )
}
