import Link from 'next/link'
import { ShieldOffIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function ForbiddenView() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-24 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-warning/15 text-warning">
        <ShieldOffIcon className="size-5" />
      </span>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">无权访问此页面</h1>
        <p className="text-sm text-muted-foreground">
          当前账号的角色没有该页面的访问权限。如需开通，请联系管理员调整角色。
        </p>
      </div>
      <Button asChild variant="outline">
        <Link href="/">返回总览</Link>
      </Button>
    </div>
  )
}
