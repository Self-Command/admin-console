'use client'

import { PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { LoginBackground, RuntimeLogin } from '@/lib/runtime/types'

const BACKGROUND_LABELS: Record<LoginBackground, string> = {
  gradient: '渐变背景',
  solid: '纯色背景',
  none: '无背景装饰',
}

export function LoginSection({
  value,
  onChange,
}: {
  value: RuntimeLogin
  onChange: (next: RuntimeLogin) => void
}) {
  function update<K extends keyof RuntimeLogin>(key: K, next: RuntimeLogin[K]) {
    onChange({ ...value, [key]: next })
  }

  function updateLink(index: number, patch: Partial<RuntimeLogin['legalLinks'][number]>) {
    const legalLinks = value.legalLinks.map((link, current) =>
      current === index ? { ...link, ...patch } : link,
    )
    onChange({ ...value, legalLinks })
  }

  function removeLink(index: number) {
    onChange({ ...value, legalLinks: value.legalLinks.filter((_, current) => current !== index) })
  }

  function addLink() {
    if (value.legalLinks.length >= 5) return
    onChange({ ...value, legalLinks: [...value.legalLinks, { label: '', url: '' }] })
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <Label htmlFor="login-headline">登录标题</Label>
        <Input
          id="login-headline"
          value={value.headline}
          maxLength={80}
          onChange={(event) => update('headline', event.target.value)}
          placeholder="例如：登录管理后台"
        />
        <p className="text-xs text-muted-foreground">显示在登录卡片顶部，最多 80 个字符。</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="login-subheadline">登录说明</Label>
        <Textarea
          id="login-subheadline"
          value={value.subheadline}
          maxLength={160}
          rows={2}
          onChange={(event) => update('subheadline', event.target.value)}
          placeholder="说明登录方式与可执行的操作"
        />
        <p className="text-xs text-muted-foreground">显示在标题下方，最多 160 个字符。</p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="login-background">背景样式</Label>
          <Select
            id="login-background"
            value={value.background}
            onChange={(event) =>
              update('background', event.target.value as LoginBackground)
            }
          >
            {(Object.keys(BACKGROUND_LABELS) as LoginBackground[]).map((background) => (
              <option key={background} value={background}>
                {BACKGROUND_LABELS[background]}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">
            渐变背景使用主色与强调色生成，纯色背景使用浅色卡片底色。
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="login-footer">页脚说明</Label>
          <Input
            id="login-footer"
            value={value.footer}
            maxLength={200}
            onChange={(event) => update('footer', event.target.value)}
            placeholder="例如：需要权限请联系平台管理员。"
          />
          <p className="text-xs text-muted-foreground">显示在登录卡片底部，最多 200 个字符。</p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="space-y-1">
            <Label>条款与政策链接</Label>
            <p className="text-xs text-muted-foreground">
              显示在登录页底部，最多 5 条；必须使用 https 地址或站内路径。
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addLink}
            disabled={value.legalLinks.length >= 5}
          >
            <PlusIcon />
            添加链接
          </Button>
        </div>

        {value.legalLinks.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
            尚未添加条款链接。用户可以在此找到服务条款与隐私政策。
          </p>
        ) : (
          <div className="space-y-2">
            {value.legalLinks.map((link, index) => (
              <div key={index} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row">
                <Input
                  value={link.label}
                  maxLength={40}
                  aria-label={`第 ${index + 1} 条链接名称`}
                  placeholder="名称，例如：服务条款"
                  className="sm:w-48"
                  onChange={(event) => updateLink(index, { label: event.target.value })}
                />
                <Input
                  value={link.url}
                  maxLength={512}
                  aria-label={`第 ${index + 1} 条链接地址`}
                  placeholder="https://example.com/terms"
                  className="font-mono text-xs"
                  onChange={(event) => updateLink(index, { url: event.target.value })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`删除第 ${index + 1} 条链接`}
                  className="shrink-0 self-end text-muted-foreground hover:text-destructive sm:self-auto"
                  onClick={() => removeLink(index)}
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg bg-muted/40 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        支持链接与使用文档地址在“品牌标识”中维护，会与登录页页脚一起展示。
      </div>
    </div>
  )
}
