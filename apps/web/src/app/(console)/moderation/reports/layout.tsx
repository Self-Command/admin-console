import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: '举报处理',
}

export default function ModerationReportsLayout({ children }: { children: ReactNode }) {
  return children
}
