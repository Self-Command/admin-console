import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: '账号认证',
}

export default function VerificationLayout({ children }: { children: ReactNode }) {
  return children
}
