import {
  ActivityIcon,
  BadgeCheckIcon,
  BellIcon,
  BookUserIcon,
  CalendarClockIcon,
  ChartColumnIcon,
  CircleUserRoundIcon,
  DatabaseIcon,
  FileTextIcon,
  FlagIcon,
  GlobeIcon,
  HistoryIcon,
  HouseIcon,
  InboxIcon,
  LayoutDashboardIcon,
  LinkIcon,
  ListIcon,
  MailIcon,
  MegaphoneIcon,
  ScrollTextIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  SlidersHorizontalIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react'
import type { Permission } from '@/lib/roles'
import { DEFAULT_NAVIGATION } from '@/lib/runtime/defaults'
import type {
  FeatureSettings,
  NavGroupConfig,
  NavigationSettings,
} from '@/lib/runtime/types'

export type ResolvedNavItem = {
  id: string
  title: string
  href: string
  icon: LucideIcon
  external: boolean
  builtin: boolean
  permission?: Permission
  feature?: keyof FeatureSettings
}

export type ResolvedNavGroup = {
  id: string
  label: string
  items: ResolvedNavItem[]
}

type BuiltinNav = {
  title: string
  href: string
  icon: LucideIcon
  permission?: Permission
  feature?: keyof FeatureSettings
}

export const BUILTIN_NAV: Record<string, BuiltinNav> = {
  dashboard: { title: '总览', href: '/', icon: LayoutDashboardIcon },
  content: {
    title: '内容检索',
    href: '/content',
    icon: SearchIcon,
    permission: 'content.read',
  },
  'moderation-reports': {
    title: '举报处理',
    href: '/moderation/reports',
    icon: FlagIcon,
    permission: 'moderation.read',
  },
  'moderation-queues': {
    title: '举报队列',
    href: '/moderation/queues',
    icon: InboxIcon,
    permission: 'moderation.read',
  },
  'moderation-events': {
    title: '处置记录',
    href: '/moderation/events',
    icon: HistoryIcon,
    permission: 'moderation.read',
  },
  'moderation-status': {
    title: '处置状态',
    href: '/moderation/status',
    icon: SlidersHorizontalIcon,
    permission: 'moderation.read',
  },
  'moderation-scheduled': {
    title: '定时处置',
    href: '/moderation/scheduled',
    icon: CalendarClockIcon,
    permission: 'moderation.read',
  },
  'moderation-analytics': {
    title: '审核分析',
    href: '/moderation/analytics',
    icon: ChartColumnIcon,
    permission: 'analytics.read',
  },
  directory: {
    title: '账号目录',
    href: '/directory',
    icon: BookUserIcon,
    permission: 'directory.read',
  },
  roles: { title: '管理员与角色', href: '/roles', icon: UsersIcon, permission: 'role.read' },
  audit: { title: '审计日志', href: '/audit', icon: ScrollTextIcon, permission: 'audit.read' },
  security: {
    title: '安全与审批',
    href: '/security',
    icon: ShieldIcon,
    permission: 'security.read',
    feature: 'securityCenter',
  },
  'system-status': {
    title: '系统状态',
    href: '/system',
    icon: ActivityIcon,
    permission: 'settings.read',
    feature: 'systemStatus',
  },
  verification: {
    title: '账号认证',
    href: '/verification',
    icon: BadgeCheckIcon,
    permission: 'verification.read',
  },
  notifications: {
    title: '通知中心',
    href: '/notifications',
    icon: MailIcon,
    permission: 'notification.read',
  },
  announcements: {
    title: '站内公告',
    href: '/announcements',
    icon: MegaphoneIcon,
    permission: 'announcement.read',
  },
  policy: {
    title: '审核策略',
    href: '/policy',
    icon: SlidersHorizontalIcon,
    permission: 'policy.read',
  },
  settings: {
    title: '系统设置',
    href: '/settings',
    icon: SettingsIcon,
    permission: 'settings.read',
  },
  profile: { title: '个人资料', href: '/profile', icon: CircleUserRoundIcon },
}

const ICONS: Record<string, LucideIcon> = {
  activity: ActivityIcon,
  'badge-check': BadgeCheckIcon,
  bell: BellIcon,
  'book-user': BookUserIcon,
  'calendar-clock': CalendarClockIcon,
  chart: ChartColumnIcon,
  'chart-column': ChartColumnIcon,
  'circle-user': CircleUserRoundIcon,
  database: DatabaseIcon,
  'file-text': FileTextIcon,
  flag: FlagIcon,
  globe: GlobeIcon,
  history: HistoryIcon,
  house: HouseIcon,
  inbox: InboxIcon,
  'layout-dashboard': LayoutDashboardIcon,
  link: LinkIcon,
  list: ListIcon,
  mail: MailIcon,
  megaphone: MegaphoneIcon,
  'scroll-text': ScrollTextIcon,
  search: SearchIcon,
  settings: SettingsIcon,
  shield: ShieldIcon,
  sliders: SlidersHorizontalIcon,
  'sliders-horizontal': SlidersHorizontalIcon,
  user: CircleUserRoundIcon,
  users: UsersIcon,
}

export function iconForName(name: string | undefined): LucideIcon | null {
  if (!name) return null
  return ICONS[name] ?? null
}

export function isSafeNavHref(href: string): boolean {
  const value = href.trim()
  if (!value || value.length > 512) return false
  if (value.startsWith('/') && !value.startsWith('//')) return true
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

export function mergeNavigationWithDefaults(
  navigation: NavigationSettings,
): NavigationSettings {
  const groups = navigation.groups.map((group) => ({
    ...group,
    items: group.items.map((item) => ({ ...item })),
  }))
  const present = new Set(groups.flatMap((group) => group.items.map((item) => item.id)))

  for (const fallback of DEFAULT_NAVIGATION.groups) {
    const missing = fallback.items.filter((item) => !present.has(item.id))
    if (missing.length === 0) continue
    const target = groups.find((group) => group.id === fallback.id)
    if (target) {
      target.items.push(...missing.map((item) => ({ ...item })))
    } else if (groups.length < 8) {
      groups.push({
        id: fallback.id,
        label: fallback.label,
        items: missing.map((item) => ({ ...item })),
      })
    } else {
      for (const item of missing) {
        const room = groups.find((group) => group.items.length < 20)
        if (!room) break
        room.items.push({ ...item })
      }
    }
    for (const item of missing) present.add(item.id)
  }
  return { groups }
}

function hasPermission(
  identity: { permissions: readonly string[] } | null | undefined,
  permission: Permission | undefined,
): boolean {
  return !permission || (identity?.permissions.includes(permission) ?? false)
}

function resolveItem(
  item: NavGroupConfig['items'][number],
  identity: { permissions: readonly string[] } | null | undefined,
  features: FeatureSettings,
): ResolvedNavItem | null {
  const builtin = BUILTIN_NAV[item.id]
  if (builtin) {
    if (!hasPermission(identity, builtin.permission)) return null
    if (builtin.feature && !features[builtin.feature]) return null
    return {
      id: item.id,
      title: item.label?.trim() || builtin.title,
      href: builtin.href,
      icon: iconForName(item.icon) ?? builtin.icon,
      external: false,
      builtin: true,
      ...(builtin.permission ? { permission: builtin.permission } : {}),
      ...(builtin.feature ? { feature: builtin.feature } : {}),
    }
  }

  const href = item.href?.trim()
  if (!href || !isSafeNavHref(href)) return null
  const title = item.label?.trim()
  if (!title) return null
  return {
    id: item.id,
    title,
    href,
    icon: iconForName(item.icon) ?? LinkIcon,
    external: !href.startsWith('/'),
    builtin: false,
  }
}

export function resolveNavigation(
  navigation: NavigationSettings,
  features: FeatureSettings,
  identity: { permissions: readonly string[] } | null | undefined,
): ResolvedNavGroup[] {
  const groups: ResolvedNavGroup[] = []
  for (const group of navigation.groups) {
    const items: ResolvedNavItem[] = []
    for (const item of group.items) {
      if (item.hidden) continue
      const resolved = resolveItem(item, identity, features)
      if (resolved) items.push(resolved)
    }
    if (items.length > 0) {
      groups.push({ id: group.id, label: group.label, items })
    }
  }
  return groups
}

export function findNavItem(
  groups: readonly ResolvedNavGroup[],
  pathname: string,
): ResolvedNavItem | null {
  let match: ResolvedNavItem | null = null
  for (const group of groups) {
    for (const item of group.items) {
      if (item.href === pathname) return item
      const active =
        item.href === '/'
          ? pathname === '/'
          : pathname === item.href || pathname.startsWith(`${item.href}/`)
      if (active && (!match || item.href.length > match.href.length)) match = item
    }
  }
  return match
}

const PAGE_TITLES: Record<string, string> = {
  '/directory': '账号详情',
  '/settings': '系统设置',
  '/profile': '个人资料',
  '/system': '系统状态',
}

export function pageTitleForPath(
  groups: readonly ResolvedNavGroup[],
  pathname: string,
): string {
  const nav = findNavItem(groups, pathname)
  if (nav) {
    const nestedTitle = PAGE_TITLES[nav.href]
    if (nav.href !== pathname && nestedTitle) return nestedTitle
    return nav.title
  }
  return PAGE_TITLES[pathname] ?? '管理后台'
}
