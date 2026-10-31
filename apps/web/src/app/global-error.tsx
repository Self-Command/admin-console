'use client'

import { AlertTriangleIcon, RotateCcwIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangleIcon className="size-5" />
          </span>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">管理后台暂时不可用</h1>
            <p className="text-sm text-muted-foreground">
              页面加载过程中出现异常，请稍后重试。若问题持续，请把当前时间与页面地址提供给管理员。
            </p>
          </div>
          <Button onClick={reset}>
            <RotateCcwIcon />
            重新加载
          </Button>
        </div>
      </body>
    </html>
  )
}
