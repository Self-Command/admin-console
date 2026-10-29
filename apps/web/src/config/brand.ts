import {
  BookUser,
  LayoutDashboard,
  ScrollText,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { Permission } from '@/lib/roles'

export type NavItem = {
  title: string
  href: string
  icon: LucideIcon
  permission?: Permission
  soon?: boolean
}

export type BrandConfig = {
  name: string
  shortName: string
  description: string
  logo: LucideIcon
  theme: {
    primary: string
    primaryForeground: string
    ring: string
  }
  nav: NavItem[]
}

export const brand: BrandConfig = {
  name: 'SelfCommand 管理后台',
  shortName: 'SelfCommand',
  description: '账号、角色与审计的统一运营控制台',
  logo: ShieldCheck,
  theme: {
    primary: 'oklch(0.57 0.2 261)',
    primaryForeground: 'oklch(0.985 0.002 247)',
    ring: 'oklch(0.57 0.2 261)',
  },
  nav: [
    { title: '总览', href: '/', icon: LayoutDashboard },
    { title: '账号目录', href: '/directory', icon: BookUser, permission: 'directory.read' },
    { title: '管理员与角色', href: '/roles', icon: Users, permission: 'role.read' },
    { title: '审计日志', href: '/audit', icon: ScrollText, permission: 'audit.read' },
  ],
}
