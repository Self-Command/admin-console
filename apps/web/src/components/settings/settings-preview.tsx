'use client'

import { useState, type CSSProperties } from 'react'
import { ShieldCheckIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { BUILTIN_NAV } from '@/lib/navigation'
import { buildThemeVariables, mixHex } from '@/lib/runtime/theme'
import type {
  NavigationSettings,
  RuntimeBranding,
  RuntimeLogin,
  RuntimeTheme,
} from '@/lib/runtime/types'
import { cn } from '@/lib/utils'

type PreviewMode = 'light' | 'dark'

const MODE_LABELS: Record<PreviewMode, string> = {
  light: '浅色',
  dark: '深色',
}

function BrandMark({
  logoUrl,
  compact = false,
}: {
  logoUrl?: string
  compact?: boolean
}) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt=""
        className={cn('object-contain', compact ? 'size-4' : 'size-6')}
        onError={(event) => {
          event.currentTarget.style.display = 'none'
        }}
      />
    )
  }
  return (
    <ShieldCheckIcon
      className={cn(compact ? 'size-4' : 'size-6')}
      style={{ color: 'var(--primary)' }}
    />
  )
}

export function SettingsPreview({
  branding,
  theme,
  login,
  navigation,
  currentLogoUrl,
  uploadedLogoUrl,
}: {
  branding: RuntimeBranding
  theme: RuntimeTheme
  login: RuntimeLogin
  navigation: NavigationSettings
  currentLogoUrl?: string
  uploadedLogoUrl?: string
}) {
  const [mode, setMode] = useState<PreviewMode>(
    theme.defaultMode === 'dark' ? 'dark' : 'light',
  )

  const variables = buildThemeVariables(theme)
  const active = variables[mode]
  const dark = mode === 'dark'
  const canvas = dark ? '#0b1020' : '#eef2f7'
  const card = dark ? '#151b33' : '#ffffff'
  const text = dark ? '#f8fafc' : '#0f172a'
  const muted = dark ? '#a3adc2' : '#64748b'
  const border = dark ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.12)'

  const logoUrl =
    branding.logoSource === 'upload'
      ? uploadedLogoUrl ?? currentLogoUrl
      : branding.logoSource === 'url'
        ? branding.logoUrl
        : undefined

  const primary = active['--primary'] ?? theme.primaryLight
  const accent = active['--accent'] ?? theme.accentLight
  const background =
    login.background === 'gradient'
      ? `linear-gradient(135deg, ${mixHex(canvas, primary, dark ? 0.24 : 0.14)}, ${mixHex(canvas, dark ? theme.accentDark : theme.accentLight, dark ? 0.18 : 0.22)})`
      : login.background === 'solid'
        ? mixHex(canvas, accent, 0.35)
        : canvas

  const navItems = navigation.groups
    .flatMap((group) => group.items)
    .filter((item) => !item.hidden)
    .slice(0, 4)
    .map((item) => item.label?.trim() || BUILTIN_NAV[item.id]?.title || item.id)

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="flex-row items-center justify-between gap-2 border-b py-3">
        <div>
          <p className="text-sm font-medium">设置效果</p>
          <p className="text-[11px] text-muted-foreground">保存后全站生效</p>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5">
          {(Object.keys(MODE_LABELS) as PreviewMode[]).map((value) => (
            <Button
              key={value}
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                'h-6 rounded-md px-2 text-[11px]',
                mode === value && 'bg-background text-foreground shadow-xs',
              )}
              onClick={() => setMode(value)}
            >
              {MODE_LABELS[value]}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="p-3">
        <div
          className="overflow-hidden rounded-lg border p-3"
          style={
            {
              ...active,
              background,
              color: text,
              borderColor: border,
            } as unknown as CSSProperties
          }
        >
          <div className="flex items-center gap-2">
            <span
              className="flex size-8 items-center justify-center rounded-md"
              style={{ backgroundColor: card, border: `1px solid ${border}` }}
            >
              <BrandMark logoUrl={logoUrl} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{branding.name || '系统名称'}</p>
              <p className="truncate text-[11px]" style={{ color: muted }}>
                {branding.shortName || '简称'}
              </p>
            </div>
            <Badge
              variant="outline"
              className="ml-auto shrink-0 border-current/20 text-[10px]"
              style={{ color: muted }}
            >
              {theme.defaultMode === 'system' ? '跟随系统' : theme.defaultMode === 'dark' ? '深色' : '浅色'}
            </Badge>
          </div>

          <div
            className="mt-3 rounded-lg border p-3"
            style={{ backgroundColor: card, borderColor: border }}
          >
            <p className="text-sm font-semibold">{login.headline || '登录标题'}</p>
            <p className="mt-1 text-[11px] leading-relaxed" style={{ color: muted }}>
              {login.subheadline || '登录说明会显示在这里。'}
            </p>
            <div
              className="mt-3 flex h-8 items-center rounded-md border px-2 text-[11px]"
              style={{ borderColor: border, color: muted }}
            >
              平台账号
            </div>
            <div
              className="mt-2 flex h-8 items-center justify-center rounded-md text-[11px] font-medium"
              style={{
                backgroundColor: active['--primary'],
                color: active['--primary-foreground'],
              }}
            >
              登录
            </div>
            <p className="mt-3 text-[10px] leading-relaxed" style={{ color: muted }}>
              {login.footer || '页脚说明'}
            </p>
            {login.legalLinks.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                {login.legalLinks.map((link, index) => (
                  <span
                    key={`${link.label}-${index}`}
                    className="text-[10px] underline-offset-2"
                    style={{ color: active['--primary'], textDecoration: 'underline' }}
                  >
                    {link.label || '链接'}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          {navItems.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {navItems.map((item, index) => (
                <span
                  key={`${item}-${index}`}
                  className="rounded px-2 py-1 text-[10px]"
                  style={{
                    backgroundColor: index === 0 ? active['--accent'] : 'transparent',
                    color: index === 0 ? active['--accent-foreground'] : muted,
                    border: `1px solid ${index === 0 ? 'transparent' : border}`,
                  }}
                >
                  {item}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
          <div className="flex justify-between gap-2">
            <dt>圆角</dt>
            <dd className="font-mono">{theme.radius}px</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>密度</dt>
            <dd>{theme.density === 'compact' ? '紧凑' : '舒适'}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>字体</dt>
            <dd>{theme.fontFamily === 'serif' ? '衬线' : '无衬线'}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>背景</dt>
            <dd>
              {login.background === 'gradient'
                ? '渐变'
                : login.background === 'solid'
                  ? '纯色'
                  : '无'}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  )
}
