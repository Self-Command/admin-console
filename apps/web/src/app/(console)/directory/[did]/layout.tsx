import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: '账号详情',
}

export default function AccountDetailLayout({ children }: { children: ReactNode }) {
  return children
}