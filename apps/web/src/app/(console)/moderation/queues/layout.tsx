import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: '举报队列',
}

export default function ModerationQueuesLayout({ children }: { children: ReactNode }) {
  return children
}
