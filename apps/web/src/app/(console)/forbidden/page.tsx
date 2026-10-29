import type { Metadata } from 'next'
import { ForbiddenView } from '@/components/forbidden-view'

export const metadata: Metadata = {
  title: '无权限',
}

export default function ForbiddenPage() {
  return <ForbiddenView />
}
