'use client'

import type { ReactNode } from 'react'
import {
  HistoryIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
  SaveIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import type { SettingMeta } from '@/lib/runtime/types'

type SectionFrameProps = {
  title: string
  description: string
  meta?: SettingMeta
  updatedLabel: string
  dirty: boolean
  readOnly: boolean
  saving: boolean
  errors: string[]
  conflict: boolean
  children: ReactNode
  onSave: () => void
  onDiscard: () => void
  onReset: () => void
  onHistory: () => void
  onReload: () => void
}

export function SectionFrame({
  title,
  description,
  meta,
  updatedLabel,
  dirty,
  readOnly,
  saving,
  errors,
  conflict,
  children,
  onSave,
  onDiscard,
  onReset,
  onHistory,
  onReload,
}: SectionFrameProps) {
  const blocked = errors.length > 0

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="flex-row items-start justify-between gap-4 border-b py-5">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="shrink-0 space-y-1.5 text-right">
          <Badge variant="outline">版本 {meta?.version ?? 0}</Badge>
          <p className="text-[11px] whitespace-nowrap text-muted-foreground">
            {meta ? `${updatedLabel}更新` : '尚未保存过'}
          </p>
        </div>
      </CardHeader>

      <CardContent className="py-5">
        {conflict ? (
          <div
            role="alert"
            className="mb-5 flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex items-start gap-2">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
              <p>
                此分区已被其他管理员修改，当前草稿基于旧版本。请重新加载最新设置后再保存。
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={onReload}>
              重新加载设置
            </Button>
          </div>
        ) : null}

        <fieldset disabled={readOnly || saving} className="min-w-0 space-y-6">
          {children}
        </fieldset>

        {errors.length > 0 ? (
          <div
            role="alert"
            className="mt-5 rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3"
          >
            <p className="text-sm font-medium text-destructive">请先修正以下问题</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs text-destructive">
              {errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>

      <CardFooter className="flex-wrap justify-between gap-3 border-t py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onReset}
            disabled={readOnly || saving}
          >
            <RotateCcwIcon />
            恢复默认
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onHistory}>
            <HistoryIcon />
            版本历史
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {dirty ? '有未保存的更改' : '所有更改已保存'}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onDiscard}
            disabled={!dirty || saving}
          >
            放弃更改
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onSave}
            disabled={readOnly || !dirty || blocked || saving}
          >
            {saving ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              <SaveIcon />
            )}
            保存更改
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}
