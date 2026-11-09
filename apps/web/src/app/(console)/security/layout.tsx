import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: '安全与审批',
}

export default function SecurityLayout({ children }: { children: ReactNode }) {
  return children
}