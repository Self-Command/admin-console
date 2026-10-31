import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: '通知中心',
}

export default function NotificationsLayout({ children }: { children: ReactNode }) {
  return children
}
