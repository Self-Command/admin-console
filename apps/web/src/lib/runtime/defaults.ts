import type {
  FeatureSettings,
  NavigationSettings,
  Preferences,
  PublicSettings,
  UiSettings,
} from '@/lib/runtime/types'

export const DEFAULT_PUBLIC_SETTINGS: PublicSettings = {
  branding: {
    name: 'SelfCommand 管理后台',
    shortName: 'SelfCommand',
    description: '账号、角色与审计的统一运营控制台',
    logoSource: 'icon',
  },
  theme: {
    primaryLight: '#2563eb',
    primaryDark: '#60a5fa',
    accentLight: '#7c3aed',
    accentDark: '#a78bfa',
    radius: 10,
    density: 'comfortable',
    fontFamily: 'sans',
    defaultMode: 'system',
  },
  login: {
    headline: '登录管理后台',
    subheadline: '使用平台账号登录，管理账号目录、角色与审计记录。',
    footer: '需要权限请联系平台管理员。',
    background: 'gradient',
    legalLinks: [],
  },
  version: 0,
}

export const DEFAULT_FEATURES: FeatureSettings = {
  auditExport: true,
  roleBulk: true,
  indexerControls: true,
  systemStatus: true,
  accountOperations: true,
  approvals: true,
  securityCenter: true,
  dashboardTrends: true,
}

export const DEFAULT_UI: UiSettings = {
  pageSize: 10,
  dateFormat: 'date-time',
}

export const DEFAULT_NAVIGATION: NavigationSettings = {
  groups: [
    { id: 'overview', label: '概览', items: [{ id: 'dashboard', hidden: false }] },
    {
      id: 'moderation',
      label: '内容审核',
      items: [
        { id: 'content', hidden: false },
        { id: 'moderation-reports', hidden: false },
        { id: 'moderation-queues', hidden: false },
        { id: 'moderation-events', hidden: false },
        { id: 'moderation-status', hidden: false },
        { id: 'moderation-scheduled', hidden: false },
        { id: 'moderation-analytics', hidden: false },
      ],
    },
    {
      id: 'operations',
      label: '运营',
      items: [
        { id: 'directory', hidden: false },
        { id: 'roles', hidden: false },
        { id: 'audit', hidden: false },
        { id: 'security', hidden: false },
      ],
    },
    {
      id: 'governance',
      label: '治理与通知',
      items: [
        { id: 'verification', hidden: false },
        { id: 'notifications', hidden: false },
        { id: 'announcements', hidden: false },
        { id: 'policy', hidden: false },
      ],
    },
    {
      id: 'system',
      label: '系统',
      items: [
        { id: 'system-status', hidden: false },
        { id: 'settings', hidden: false },
        { id: 'profile', hidden: false },
      ],
    },
  ],
}

export const EMPTY_PREFERENCES: Preferences = {}
