import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: '管理员与角色',
}

export default function RolesLayout({ children }: { children: ReactNode }) {
  return children
}
