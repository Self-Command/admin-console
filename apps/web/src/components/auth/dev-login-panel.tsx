'use client'

import { FlaskConicalIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { devLoginConfig } from '@/lib/config'

export function DevLoginPanel({
  onFill,
}: {
  onFill: (values: { service: string; identifier: string; password: string }) => void
}) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-dashed px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
      <FlaskConicalIcon className="mt-0.5 size-3.5 shrink-0" />
      <div className="space-y-2">
        <p>开发调试：仅本地开发环境可用，账号与密码来自环境变量。</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 w-full text-xs"
          onClick={() =>
            onFill({
              service: devLoginConfig.service,
              identifier: devLoginConfig.identifier,
              password: devLoginConfig.password,
            })
          }
        >
          填充调试账号
        </Button>
      </div>
    </div>
  )
}
