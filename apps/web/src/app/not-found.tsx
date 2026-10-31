import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-sm font-medium text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">页面不存在</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        你访问的页面地址不存在或已经变更，请从左侧导航进入需要的功能，或返回总览重新选择。
      </p>
      <Button asChild variant="outline">
        <Link href="/">返回总览</Link>
      </Button>
    </div>
  )
}
