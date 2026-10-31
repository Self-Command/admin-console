'use client'

import { useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { ImageIcon, LoaderCircleIcon, UploadIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { LogoSource, RuntimeBranding } from '@/lib/runtime/types'
import { cn } from '@/lib/utils'

const LOGO_MIME = ['image/png', 'image/jpeg', 'image/webp']
const LOGO_MAX_BYTES = 128 * 1024

export const LOGO_FORMAT_HINT = '支持 PNG、JPEG、WebP，文件不超过 128 KB，不支持 SVG。'

export function validateLogoFile(file: File): string | null {
  if (!LOGO_MIME.includes(file.type)) return '请选择 PNG、JPEG 或 WebP 图片。'
  if (file.size > LOGO_MAX_BYTES) return '图片不能超过 128 KB，请压缩后再上传。'
  if (file.size === 0) return '图片内容为空，请重新选择。'
  return null
}

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('read failed'))
        return
      }
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

type BrandingSectionProps = {
  value: RuntimeBranding
  onChange: (next: RuntimeBranding) => void
  readOnly: boolean
  uploading: boolean
  uploadedLogoUrl?: string
  currentLogoUrl?: string
  onUploadLogo: (file: File) => Promise<void>
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function BrandingSection({
  value,
  onChange,
  readOnly,
  uploading,
  uploadedLogoUrl,
  currentLogoUrl,
  onUploadLogo,
}: BrandingSectionProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileError, setFileError] = useState<string | null>(null)

  const logoSrc =
    value.logoSource === 'url'
      ? value.logoUrl
      : value.logoSource === 'upload'
        ? uploadedLogoUrl ?? currentLogoUrl
        : undefined

  function update<K extends keyof RuntimeBranding>(key: K, next: RuntimeBranding[K]) {
    onChange({ ...value, [key]: next })
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const problem = validateLogoFile(file)
    if (problem) {
      setFileError(problem)
      return
    }
    setFileError(null)
    await onUploadLogo(file)
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="系统名称" hint="显示在登录页、侧边栏和浏览器标题，最多 60 个字符。">
          <Input
            value={value.name}
            maxLength={60}
            onChange={(event) => update('name', event.target.value)}
            placeholder="例如：星海社区管理后台"
          />
        </Field>
        <Field label="系统简称" hint="空间较小时使用，最多 24 个字符。">
          <Input
            value={value.shortName}
            maxLength={24}
            onChange={(event) => update('shortName', event.target.value)}
            placeholder="例如：星海后台"
          />
        </Field>
      </div>

      <Field label="系统描述" hint="用于登录页说明和搜索引擎摘要，最多 200 个字符。">
        <Textarea
          value={value.description}
          maxLength={200}
          rows={2}
          onChange={(event) => update('description', event.target.value)}
          placeholder="用一句话说明这个后台的用途"
        />
      </Field>

      <div className="space-y-3">
        <div className="grid gap-5 md:grid-cols-2">
          <Field
            label="Logo 来源"
            hint="内置图标无需上传；外部图片必须是 https 地址；上传后保存在后台服务中。"
          >
            <Select
              value={value.logoSource}
              onChange={(event) => update('logoSource', event.target.value as LogoSource)}
            >
              <option value="icon">内置盾牌图标</option>
              <option value="url">外部图片地址</option>
              <option value="upload">上传图片</option>
            </Select>
          </Field>
          <div className="space-y-1.5">
            <Label>当前效果</Label>
            <div className="flex h-9 items-center gap-2 rounded-md border border-dashed px-3">
              {logoSrc ? (
                // Runtime logos are user-configured images, not build assets.
                <img
                  src={logoSrc}
                  alt=""
                  className="size-5 object-contain"
                  onError={(event) => {
                    event.currentTarget.style.display = 'none'
                  }}
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex size-5 items-center justify-center rounded bg-primary text-[10px] font-semibold text-primary-foreground"
                >
                  {value.shortName.trim().slice(0, 1) || '后'}
                </span>
              )}
              <span className="truncate text-sm">{value.name.trim() || '系统名称'}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {value.shortName.trim() || '简称'}
              </span>
            </div>
          </div>
        </div>

        {value.logoSource === 'url' ? (
          <Field
            label="Logo 图片地址"
            hint="必须是以 https 开头的外部地址，或以 / 开头的站内路径。"
          >
            <Input
              value={value.logoUrl ?? ''}
              maxLength={512}
              onChange={(event) => update('logoUrl', event.target.value || undefined)}
              placeholder="https://static.example.com/logo.png"
            />
          </Field>
        ) : null}

        {value.logoSource === 'upload' ? (
          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-background">
                  <ImageIcon className="size-4 text-muted-foreground" />
                </span>
                <div className="space-y-1">
                  <p className="text-sm font-medium">上传 Logo 图片</p>
                  <p className="text-xs text-muted-foreground">{LOGO_FORMAT_HINT}</p>
                </div>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={handleFile}
                tabIndex={-1}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={readOnly || uploading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? (
                  <LoaderCircleIcon className="animate-spin" />
                ) : (
                  <UploadIcon />
                )}
                {uploading ? '正在上传' : '选择图片'}
              </Button>
            </div>
            {fileError ? (
              <p role="alert" className="mt-2 text-xs text-destructive">
                {fileError}
              </p>
            ) : null}
            {uploadedLogoUrl ? (
              <p className="mt-2 text-xs text-muted-foreground">
                图片已上传并设为当前 Logo，刷新页面后全站生效。
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Field
          label="站点图标地址"
          hint="浏览器标签页图标，留空时使用内置图标或已上传的 Logo。"
        >
          <Input
            value={value.faviconUrl ?? ''}
            maxLength={512}
            onChange={(event) => update('faviconUrl', event.target.value || undefined)}
            placeholder="https://static.example.com/favicon.png"
          />
        </Field>
        <Field label="支持链接" hint="显示在登录页与个人资料，便于联系平台管理员。">
          <Input
            value={value.supportUrl ?? ''}
            maxLength={512}
            onChange={(event) => update('supportUrl', event.target.value || undefined)}
            placeholder="https://support.example.com"
          />
        </Field>
      </div>

      <Field label="使用文档地址" hint="显示在登录页帮助入口。">
        <Input
          value={value.docsUrl ?? ''}
          maxLength={512}
          onChange={(event) => update('docsUrl', event.target.value || undefined)}
          placeholder="https://docs.example.com/admin"
        />
      </Field>

      <p className={cn('text-xs text-muted-foreground', readOnly && 'hidden')}>
        修改系统名称、简称或 Logo 后，保存并刷新页面即可在侧边栏、登录页和浏览器标题中看到效果。
      </p>
    </div>
  )
}
