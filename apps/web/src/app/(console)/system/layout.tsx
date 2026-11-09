import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: '系统状态',
}

export default function SystemLayout({ children }: { children: ReactNode }) {
  return children
}
