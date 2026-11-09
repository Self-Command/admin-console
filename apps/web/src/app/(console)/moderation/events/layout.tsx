import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: '处置记录',
}

export default function ModerationEventsLayout({ children }: { children: ReactNode }) {
  return children
}
