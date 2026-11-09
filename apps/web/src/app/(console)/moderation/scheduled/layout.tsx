import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: '定时处置',
}

export default function ModerationScheduledLayout({ children }: { children: ReactNode }) {
  return children
}
