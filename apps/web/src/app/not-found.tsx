import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-sm font-medium text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">页面不存在</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        你访问的路径可能已被移动，或尚未在当前批次交付。
      </p>
      <Button asChild variant="outline">
        <Link href="/">返回总览</Link>
      </Button>
    </div>
  )
}
