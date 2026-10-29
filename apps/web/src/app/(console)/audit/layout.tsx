import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: '审计日志',
}

export default function AuditLayout({ children }: { children: ReactNode }) {
  return children
}
