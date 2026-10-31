import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: '内容检索',
}

export default function ContentLayout({ children }: { children: ReactNode }) {
  return children
}
