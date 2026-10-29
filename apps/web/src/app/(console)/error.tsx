'use client'

import { AlertTriangleIcon, RotateCcwIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function ConsoleError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-24 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangleIcon className="size-5" />
      </span>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">页面加载失败</h1>
        <p className="text-sm text-muted-foreground">
          服务暂时不可用，请稍后重试。若问题持续，请把当前时间与页面地址提供给管理员。
        </p>
      </div>
      <Button variant="outline" onClick={reset}>
        <RotateCcwIcon />
        重试
      </Button>
    </div>
  )
}
