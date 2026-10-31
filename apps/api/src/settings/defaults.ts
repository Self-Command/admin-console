import { com } from '@admin/lexicons'
import { LexServerError } from '@atproto/lex-server'

export type SettingsSections = com.selfcommand.admin.defs.SettingsSections
export type SettingSection = com.selfcommand.admin.defs.SettingSection
export type BrandingSettings = com.selfcommand.admin.defs.BrandingSettings
export type ThemeSettings = com.selfcommand.admin.defs.ThemeSettings
export type LoginSettings = com.selfcommand.admin.defs.LoginSettings
export type NavigationSettings = com.selfcommand.admin.defs.NavigationSettings
export type FeatureSettings = com.selfcommand.admin.defs.FeatureSettings
export type UiSettings = com.selfcommand.admin.defs.UiSettings
export type IntegrationSettings = com.selfcommand.admin.defs.IntegrationSettings
export type AuditSettings = com.selfcommand.admin.defs.AuditSettings
export type IndexerSettings = com.selfcommand.admin.defs.IndexerSettings
export type NavGroup = com.selfcommand.admin.defs.NavGroup
export type NavItem = com.selfcommand.admin.defs.NavItem
export type LegalLink = com.selfcommand.admin.defs.LegalLink

export const SETTING_SECTIONS = [
  'branding',
  'theme',
  'login',
  'navigation',
  'features',
  'ui',
  'integrations',
  'audit',
  'indexer',
] as const

export type SectionKey = (typeof SETTING_SECTIONS)[number]

export const BUILTIN_NAV_IDS = [
  'dashboard',
  'content',
  'moderation-reports',
  'moderation-queues',
  'moderation-events',
  'moderation-scheduled',
  'moderation-analytics',
  'directory',
  'roles',
  'audit',
  'security',
  'verification',
  'notifications',
  'policy',
  'system-status',
  'settings',
  'profile',
] as const

const BUILTIN_NAV_HREFS: Record<string, string> = {
  dashboard: '/',
  content: '/content',
  'moderation-reports': '/moderation/reports',
  'moderation-queues': '/moderation/queues',
  'moderation-events': '/moderation/events',
  'moderation-scheduled': '/moderation/scheduled',
  'moderation-analytics': '/moderation/analytics',
  directory: '/directory',
  roles: '/roles',
  audit: '/audit',
  security: '/security',
  verification: '/verification',
  notifications: '/notifications',
  policy: '/policy',
  'system-status': '/system',
  settings: '/settings',
  profile: '/profile',
}

export const DEFAULT_SETTINGS: SettingsSections = {
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
  navigation: {
    groups: [
      {
        id: 'overview',
        label: '概览',
        items: [{ id: 'dashboard', hidden: false }],
      },
      {
        id: 'moderation',
        label: '内容审核',
        items: [
          { id: 'content', hidden: false },
          { id: 'moderation-reports', hidden: false },
          { id: 'moderation-queues', hidden: false },
          { id: 'moderation-events', hidden: false },
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
  },
  features: {
    auditExport: true,
    roleBulk: true,
    indexerControls: true,
    systemStatus: true,
    accountOperations: true,
    approvals: true,
    securityCenter: true,
    dashboardTrends: true,
  },
  ui: {
    pageSize: 10,
    dateFormat: 'date-time',
  },
  integrations: {},
  audit: {
    exportMaxRows: 5000,
  },
  indexer: {
    lagWarningSeconds: 300,
  },
}

export function isSettingSection(value: unknown): value is SectionKey {
  return typeof value === 'string' && (SETTING_SECTIONS as readonly string[]).includes(value)
}

export function defaultSection<K extends SectionKey>(section: K): SettingsSections[K] {
  return structuredClone(DEFAULT_SETTINGS[section])
}

function invalid(message: string): LexServerError {
  return new LexServerError(400, { error: 'InvalidRequest', message })
}

type Record_ = Record<string, unknown>

function asRecord(value: unknown, name: string): Record_ {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(`${name} must be an object`)
  }
  return value as Record_
}

function rejectUnknownKeys(obj: Record_, allowed: readonly string[], name: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) throw invalid(`${name} has an unknown field: ${key}`)
  }
}

function readString(
  obj: Record_,
  key: string,
  name: string,
  opts: { min?: number; max: number; trim?: boolean },
): string {
  const raw = obj[key]
  if (typeof raw !== 'string') throw invalid(`${name}.${key} must be a string`)
  const value = opts.trim === false ? raw : raw.trim()
  if (value.length < (opts.min ?? 0)) {
    throw invalid(`${name}.${key} must be at least ${opts.min} characters`)
  }
  if (value.length > opts.max) {
    throw invalid(`${name}.${key} must be at most ${opts.max} characters`)
  }
  return value
}

function readOptionalString(
  obj: Record_,
  key: string,
  name: string,
  max: number,
): string | undefined {
  const raw = obj[key]
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'string') throw invalid(`${name}.${key} must be a string`)
  const value = raw.trim()
  if (!value) return undefined
  if (value.length > max) throw invalid(`${name}.${key} must be at most ${max} characters`)
  return value
}

function readEnum<T extends string>(
  obj: Record_,
  key: string,
  name: string,
  values: readonly T[],
): T {
  const raw = obj[key]
  if (typeof raw !== 'string' || !(values as readonly string[]).includes(raw)) {
    throw invalid(`${name}.${key} must be one of ${values.join(', ')}`)
  }
  return raw as T
}

function readInt(
  obj: Record_,
  key: string,
  name: string,
  min: number,
  max: number,
): number {
  const raw = obj[key]
  if (!Number.isInteger(raw)) throw invalid(`${name}.${key} must be an integer`)
  const value = raw as number
  if (value < min || value > max) {
    throw invalid(`${name}.${key} must be between ${min} and ${max}`)
  }
  return value
}

function readBool(obj: Record_, key: string, name: string): boolean {
  const raw = obj[key]
  if (typeof raw !== 'boolean') throw invalid(`${name}.${key} must be a boolean`)
  return raw
}

export function isSafeLink(value: string, allowLocalHttp = false): boolean {
  if (value.startsWith('/') && !value.startsWith('//')) return value.length <= 512
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol === 'https:') return true
  if (
    allowLocalHttp &&
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)
  ) {
    return true
  }
  return false
}

function readLink(value: unknown, name: string, allowLocalHttp = false): string {
  if (typeof value !== 'string') throw invalid(`${name} must be a string`)
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 512) throw invalid(`${name} must be a URL or path`)
  if (!isSafeLink(trimmed, allowLocalHttp)) {
    throw invalid(`${name} must be an https URL or a path starting with /`)
  }
  return trimmed
}

function readOptionalLink(
  obj: Record_,
  key: string,
  name: string,
  allowLocalHttp = false,
): string | undefined {
  const raw = obj[key]
  if (raw === undefined || raw === null || raw === '') return undefined
  return readLink(raw, `${name}.${key}`, allowLocalHttp)
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i

function readColor(obj: Record_, key: string, name: string): string {
  const raw = obj[key]
  if (typeof raw !== 'string' || !HEX_COLOR.test(raw)) {
    throw invalid(`${name}.${key} must be a #rrggbb color`)
  }
  return raw.toLowerCase()
}

function channel(value: number): number {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const value = hex.replace('#', '')
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

function validateBranding(raw: Record_): BrandingSettings {
  rejectUnknownKeys(
    raw,
    ['name', 'shortName', 'description', 'logoSource', 'logoUrl', 'faviconUrl', 'supportUrl', 'docsUrl'],
    'branding',
  )
  return {
    name: readString(raw, 'name', 'branding', { min: 1, max: 60 }),
    shortName: readString(raw, 'shortName', 'branding', { min: 1, max: 24 }),
    description: readString(raw, 'description', 'branding', { max: 200 }),
    logoSource: readEnum(raw, 'logoSource', 'branding', ['icon', 'url', 'upload']),
    ...optionalField('logoUrl', readOptionalLink(raw, 'logoUrl', 'branding')),
    ...optionalField('faviconUrl', readOptionalLink(raw, 'faviconUrl', 'branding')),
    ...optionalField('supportUrl', readOptionalLink(raw, 'supportUrl', 'branding')),
    ...optionalField('docsUrl', readOptionalLink(raw, 'docsUrl', 'branding')),
  }
}

function optionalField<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V }
}

function validateTheme(raw: Record_): ThemeSettings {
  rejectUnknownKeys(
    raw,
    ['primaryLight', 'primaryDark', 'accentLight', 'accentDark', 'radius', 'density', 'fontFamily', 'defaultMode'],
    'theme',
  )
  const theme: ThemeSettings = {
    primaryLight: readColor(raw, 'primaryLight', 'theme'),
    primaryDark: readColor(raw, 'primaryDark', 'theme'),
    accentLight: readColor(raw, 'accentLight', 'theme'),
    accentDark: readColor(raw, 'accentDark', 'theme'),
    radius: readInt(raw, 'radius', 'theme', 0, 24),
    density: readEnum(raw, 'density', 'theme', ['comfortable', 'compact']),
    fontFamily: readEnum(raw, 'fontFamily', 'theme', ['sans', 'serif']),
    defaultMode: readEnum(raw, 'defaultMode', 'theme', ['light', 'dark', 'system']),
  }
  for (const key of ['primaryLight', 'accentLight'] as const) {
    if (contrastRatio(theme[key], '#ffffff') < 3) {
      throw invalid(`theme.${key} must reach a contrast ratio of at least 3.0 against white`)
    }
  }
  for (const key of ['primaryDark', 'accentDark'] as const) {
    if (contrastRatio(theme[key], '#0b1020') < 3) {
      throw invalid(`theme.${key} must reach a contrast ratio of at least 3.0 against the dark canvas`)
    }
  }
  return theme
}

function validateLogin(raw: Record_): LoginSettings {
  rejectUnknownKeys(raw, ['headline', 'subheadline', 'footer', 'background', 'legalLinks'], 'login')
  const linksRaw = raw.legalLinks
  if (!Array.isArray(linksRaw) || linksRaw.length > 5) {
    throw invalid('login.legalLinks must be an array of at most 5 links')
  }
  const legalLinks: LegalLink[] = linksRaw.map((item, index) => {
    const link = asRecord(item, `login.legalLinks[${index}]`)
    rejectUnknownKeys(link, ['label', 'url'], `login.legalLinks[${index}]`)
    return {
      label: readString(link, 'label', `login.legalLinks[${index}]`, { min: 1, max: 40 }),
      url: readLink(link.url, `login.legalLinks[${index}].url`),
    }
  })
  return {
    headline: readString(raw, 'headline', 'login', { min: 1, max: 80 }),
    subheadline: readString(raw, 'subheadline', 'login', { max: 160 }),
    footer: readString(raw, 'footer', 'login', { max: 200 }),
    background: readEnum(raw, 'background', 'login', ['gradient', 'solid', 'none']),
    legalLinks,
  }
}

const NAV_ID = /^[a-z0-9][a-z0-9-]{0,63}$/

function validateNavigation(raw: Record_): NavigationSettings {
  rejectUnknownKeys(raw, ['groups'], 'navigation')
  const groupsRaw = raw.groups
  if (!Array.isArray(groupsRaw) || groupsRaw.length === 0 || groupsRaw.length > 8) {
    throw invalid('navigation.groups must contain between 1 and 8 groups')
  }
  const seenGroups = new Set<string>()
  const seenItems = new Set<string>()
  const groups: NavGroup[] = groupsRaw.map((groupRaw, groupIndex) => {
    const group = asRecord(groupRaw, `navigation.groups[${groupIndex}]`)
    rejectUnknownKeys(group, ['id', 'label', 'items'], `navigation.groups[${groupIndex}]`)
    const id = readString(group, 'id', `navigation.groups[${groupIndex}]`, { min: 1, max: 32 })
    if (!NAV_ID.test(id)) throw invalid(`navigation.groups[${groupIndex}].id is not a valid identifier`)
    if (seenGroups.has(id)) throw invalid(`navigation group id is duplicated: ${id}`)
    seenGroups.add(id)
    const label = readString(group, 'label', `navigation.groups[${groupIndex}]`, { min: 1, max: 40 })
    const itemsRaw = group.items
    if (!Array.isArray(itemsRaw) || itemsRaw.length > 20) {
      throw invalid(`navigation.groups[${groupIndex}].items must be an array of at most 20 items`)
    }
    const items: NavItem[] = itemsRaw.map((itemRaw, itemIndex) => {
      const item = asRecord(itemRaw, `navigation.groups[${groupIndex}].items[${itemIndex}]`)
      rejectUnknownKeys(
        item,
        ['id', 'label', 'href', 'icon', 'hidden'],
        `navigation.groups[${groupIndex}].items[${itemIndex}]`,
      )
      const itemId = readString(item, 'id', `navigation item`, { min: 1, max: 64 })
      if (!NAV_ID.test(itemId)) throw invalid(`navigation item id is not a valid identifier: ${itemId}`)
      if (seenItems.has(itemId)) throw invalid(`navigation item id is duplicated: ${itemId}`)
      seenItems.add(itemId)
      const hidden = readBool(item, 'hidden', 'navigation item')
      const label = readOptionalString(item, 'label', 'navigation item', 40)
      const icon = readOptionalString(item, 'icon', 'navigation item', 32)
      const href = readOptionalLink(item, 'href', 'navigation item')

      const builtinHref = BUILTIN_NAV_HREFS[itemId]
      if (builtinHref) {
        if (href && href !== builtinHref) {
          throw invalid(`navigation item ${itemId} cannot change its built-in target`)
        }
        return { id: itemId, ...optionalField('label', label), ...optionalField('icon', icon), hidden }
      }
      if (!label) throw invalid(`navigation item ${itemId} requires a label`)
      if (!href) throw invalid(`navigation item ${itemId} requires a link`)
      return { id: itemId, label, href, ...optionalField('icon', icon), hidden }
    })
    return { id, label, items }
  })

  for (const builtin of BUILTIN_NAV_IDS) {
    if (!seenItems.has(builtin)) throw invalid(`navigation must keep the built-in item: ${builtin}`)
  }

  return { groups }
}

const FEATURE_KEYS = [
  'auditExport',
  'roleBulk',
  'indexerControls',
  'systemStatus',
  'accountOperations',
  'approvals',
  'securityCenter',
  'dashboardTrends',
] as const

function validateFeatures(raw: Record_): FeatureSettings {
  rejectUnknownKeys(raw, FEATURE_KEYS, 'features')
  return {
    auditExport: readBool(raw, 'auditExport', 'features'),
    roleBulk: readBool(raw, 'roleBulk', 'features'),
    indexerControls: readBool(raw, 'indexerControls', 'features'),
    systemStatus: readBool(raw, 'systemStatus', 'features'),
    accountOperations: readBool(raw, 'accountOperations', 'features'),
    approvals: readBool(raw, 'approvals', 'features'),
    securityCenter: readBool(raw, 'securityCenter', 'features'),
    dashboardTrends: readBool(raw, 'dashboardTrends', 'features'),
  }
}

function validateUi(raw: Record_): UiSettings {
  rejectUnknownKeys(raw, ['pageSize', 'dateFormat'], 'ui')
  return {
    pageSize: readInt(raw, 'pageSize', 'ui', 1, 100),
    dateFormat: readEnum(raw, 'dateFormat', 'ui', ['date-time', 'date']),
  }
}

function validateIntegrations(raw: Record_): IntegrationSettings {
  rejectUnknownKeys(raw, ['ozoneUrl', 'pdsUrl'], 'integrations')
  return {
    ...optionalField('ozoneUrl', readOptionalLink(raw, 'ozoneUrl', 'integrations', true)),
    ...optionalField('pdsUrl', readOptionalLink(raw, 'pdsUrl', 'integrations', true)),
  }
}

function validateAuditSettings(raw: Record_): AuditSettings {
  rejectUnknownKeys(raw, ['exportMaxRows'], 'audit')
  return { exportMaxRows: readInt(raw, 'exportMaxRows', 'audit', 100, 10000) }
}

function validateIndexerSettings(raw: Record_): IndexerSettings {
  rejectUnknownKeys(raw, ['lagWarningSeconds'], 'indexer')
  return { lagWarningSeconds: readInt(raw, 'lagWarningSeconds', 'indexer', 60, 86400) }
}

export function validateSection<K extends SectionKey>(
  section: K,
  values: unknown,
): SettingsSections[K] {
  const raw = asRecord(values, section)
  switch (section) {
    case 'branding':
      return validateBranding(raw) as SettingsSections[K]
    case 'theme':
      return validateTheme(raw) as SettingsSections[K]
    case 'login':
      return validateLogin(raw) as SettingsSections[K]
    case 'navigation':
      return validateNavigation(raw) as SettingsSections[K]
    case 'features':
      return validateFeatures(raw) as SettingsSections[K]
    case 'ui':
      return validateUi(raw) as SettingsSections[K]
    case 'integrations':
      return validateIntegrations(raw) as SettingsSections[K]
    case 'audit':
      return validateAuditSettings(raw) as SettingsSections[K]
    case 'indexer':
      return validateIndexerSettings(raw) as SettingsSections[K]
    default:
      throw invalid('unknown settings section')
  }
}

/**
 * Stored rows are validated on read so a corrupted or outdated partition can
 * never break the console; invalid partitions fall back to the defaults.
 */
export function normalizeStoredSection<K extends SectionKey>(
  section: K,
  values: unknown,
): SettingsSections[K] {
  try {
    return validateSection(section, values)
  } catch {
    return defaultSection(section)
  }
}

export function sectionsEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
