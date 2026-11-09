import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: '审核策略',
}

export default function PolicyLayout({ children }: { children: ReactNode }) {
  return children
}
