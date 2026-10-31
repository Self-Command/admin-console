import {
  ActivityIcon,
  Building2Icon,
  CompassIcon,
  LogInIcon,
  PaletteIcon,
  ScrollTextIcon,
  SlidersHorizontalIcon,
  TablePropertiesIcon,
  PlugZapIcon,
  type LucideIcon,
} from 'lucide-react'
import type {
  SettingMeta,
  SettingSectionKey,
  SettingsSections,
} from '@/lib/runtime/types'

export const SETTING_SECTIONS: readonly SettingSectionKey[] = [
  'branding',
  'theme',
  'login',
  'navigation',
  'features',
  'ui',
  'integrations',
  'audit',
  'indexer',
]

export type SectionMeta = {
  key: SettingSectionKey
  label: string
  description: string
  icon: LucideIcon
}

export const SECTION_META: readonly SectionMeta[] = [
  {
    key: 'branding',
    label: '品牌标识',
    description: '系统名称、Logo、站点图标与支持入口，会应用到登录页、侧边栏和浏览器标签。',
    icon: Building2Icon,
  },
  {
    key: 'theme',
    label: '外观主题',
    description: '主色、强调色、圆角、密度与默认明暗模式，保存后全站立即生效。',
    icon: PaletteIcon,
  },
  {
    key: 'login',
    label: '登录页',
    description: '登录页标题、说明、页脚、背景样式与条款链接。',
    icon: LogInIcon,
  },
  {
    key: 'navigation',
    label: '导航菜单',
    description: '调整侧边栏分组、入口顺序、显示名称与自定义链接。',
    icon: CompassIcon,
  },
  {
    key: 'features',
    label: '功能入口',
    description: '控制审计导出、角色批量导入、索引器控制与系统状态的界面入口。',
    icon: SlidersHorizontalIcon,
  },
  {
    key: 'ui',
    label: '界面默认值',
    description: '列表默认每页条数与日期显示格式，用户可在个人资料中覆盖。',
    icon: TablePropertiesIcon,
  },
  {
    key: 'integrations',
    label: '外部系统',
    description: 'Ozone 与 PDS 地址，用于账号详情中的核查入口。',
    icon: PlugZapIcon,
  },
  {
    key: 'audit',
    label: '审计导出',
    description: '单次审计导出允许的最大记录数。',
    icon: ScrollTextIcon,
  },
  {
    key: 'indexer',
    label: '索引监控',
    description: '索引延迟提醒阈值，用于系统状态与总览的告警判断。',
    icon: ActivityIcon,
  },
]

export const RUNTIME_SECTIONS: ReadonlySet<SettingSectionKey> = new Set([
  'branding',
  'theme',
  'login',
  'navigation',
])

export function sectionMeta(key: SettingSectionKey): SectionMeta {
  return SECTION_META.find((item) => item.key === key) ?? SECTION_META[0]!
}

export function sectionLabel(key: SettingSectionKey): string {
  return sectionMeta(key).label
}

export function metaFor(
  meta: readonly SettingMeta[],
  section: SettingSectionKey,
): SettingMeta | undefined {
  return meta.find((item) => item.section === section)
}

export function replaceMeta(
  meta: readonly SettingMeta[],
  next: SettingMeta,
): SettingMeta[] {
  const rest = meta.filter((item) => item.section !== next.section)
  return [...rest, next].sort(
    (a, b) => SETTING_SECTIONS.indexOf(a.section) - SETTING_SECTIONS.indexOf(b.section),
  )
}

export function cloneSections(sections: SettingsSections): SettingsSections {
  return structuredClone(sections)
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableValue(item)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function valuesEqual(a: unknown, b: unknown): boolean {
  return stableValue(a) === stableValue(b)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function optionalText(value: unknown): string | undefined {
  const result = text(value)
  return result || undefined
}

function color(value: unknown): string {
  return text(value).toLowerCase()
}

function integer(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Math.trunc(Number(value))
  }
  return fallback
}

function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : []
}

/**
 * Mirrors the server normalisation so a saved draft compares equal to the
 * canonical value the server stores (trimmed strings, lower-case colours and
 * absent optional fields).
 */
export function normalizeSectionValues<K extends SettingSectionKey>(
  section: K,
  input: unknown,
): SettingsSections[K] {
  const value = record(input)
  let result: SettingsSections[SettingSectionKey]
  switch (section) {
    case 'branding': {
      const logoUrl = optionalText(value.logoUrl)
      const faviconUrl = optionalText(value.faviconUrl)
      const supportUrl = optionalText(value.supportUrl)
      const docsUrl = optionalText(value.docsUrl)
      result = {
        name: text(value.name),
        shortName: text(value.shortName),
        description: text(value.description),
        logoSource: oneOf(value.logoSource, ['icon', 'url', 'upload'] as const, 'icon'),
        ...(logoUrl ? { logoUrl } : {}),
        ...(faviconUrl ? { faviconUrl } : {}),
        ...(supportUrl ? { supportUrl } : {}),
        ...(docsUrl ? { docsUrl } : {}),
      }
      break
    }
    case 'theme':
      result = {
        primaryLight: color(value.primaryLight),
        primaryDark: color(value.primaryDark),
        accentLight: color(value.accentLight),
        accentDark: color(value.accentDark),
        radius: integer(value.radius, 0),
        density: oneOf(value.density, ['comfortable', 'compact'] as const, 'comfortable'),
        fontFamily: oneOf(value.fontFamily, ['sans', 'serif'] as const, 'sans'),
        defaultMode: oneOf(value.defaultMode, ['light', 'dark', 'system'] as const, 'system'),
      }
      break
    case 'login':
      result = {
        headline: text(value.headline),
        subheadline: text(value.subheadline),
        footer: text(value.footer),
        background: oneOf(value.background, ['gradient', 'solid', 'none'] as const, 'gradient'),
        legalLinks: records(value.legalLinks)
          .slice(0, 5)
          .map((link) => ({ label: text(link.label), url: text(link.url) })),
      }
      break
    case 'navigation':
      result = {
        groups: records(value.groups).map((group) => ({
          id: text(group.id),
          label: text(group.label),
          items: records(group.items).map((item) => {
            const id = text(item.id)
            const label = optionalText(item.label)
            const href = optionalText(item.href)
            const icon = optionalText(item.icon)
            return {
              id,
              ...(label ? { label } : {}),
              ...(href ? { href } : {}),
              ...(icon ? { icon } : {}),
              hidden: boolean(item.hidden, false),
            }
          }),
        })),
      }
      break
    case 'features':
      result = {
        auditExport: boolean(value.auditExport, false),
        roleBulk: boolean(value.roleBulk, false),
        indexerControls: boolean(value.indexerControls, false),
        systemStatus: boolean(value.systemStatus, false),
        accountOperations: boolean(value.accountOperations, false),
        approvals: boolean(value.approvals, false),
        securityCenter: boolean(value.securityCenter, false),
        dashboardTrends: boolean(value.dashboardTrends, false),
      }
      break
    case 'ui':
      result = {
        pageSize: integer(value.pageSize, 0),
        dateFormat: oneOf(value.dateFormat, ['date-time', 'date'] as const, 'date-time'),
      }
      break
    case 'integrations': {
      const ozoneUrl = optionalText(value.ozoneUrl)
      const pdsUrl = optionalText(value.pdsUrl)
      result = {
        ...(ozoneUrl ? { ozoneUrl } : {}),
        ...(pdsUrl ? { pdsUrl } : {}),
      }
      break
    }
    case 'audit':
      result = { exportMaxRows: integer(value.exportMaxRows, 0) }
      break
    case 'indexer':
      result = { lagWarningSeconds: integer(value.lagWarningSeconds, 0) }
      break
  }
  return result as SettingsSections[K]
}

const FIELD_LABELS: Record<SettingSectionKey, Record<string, string>> = {
  branding: {
    name: '系统名称',
    shortName: '简称',
    description: '系统描述',
    logoSource: 'Logo 来源',
    logoUrl: 'Logo 地址',
    faviconUrl: '站点图标',
    supportUrl: '支持链接',
    docsUrl: '文档链接',
  },
  theme: {
    primaryLight: '浅色主色',
    primaryDark: '深色主色',
    accentLight: '浅色强调色',
    accentDark: '深色强调色',
    radius: '圆角',
    density: '界面密度',
    fontFamily: '字体',
    defaultMode: '默认明暗模式',
  },
  login: {
    headline: '登录标题',
    subheadline: '登录说明',
    footer: '页脚说明',
    background: '登录背景',
    legalLinks: '条款链接',
  },
  navigation: { groups: '导航分组与入口' },
  features: {
    auditExport: '审计导出入口',
    roleBulk: '角色批量导入入口',
    indexerControls: '索引器控制入口',
    systemStatus: '系统状态入口',
    accountOperations: '账号运营记录入口',
    approvals: '双人审批入口',
    securityCenter: '访问安全入口',
    dashboardTrends: '趋势看板',
  },
  ui: { pageSize: '默认每页条数', dateFormat: '日期格式' },
  integrations: { ozoneUrl: 'Ozone 地址', pdsUrl: 'PDS 地址' },
  audit: { exportMaxRows: '审计导出上限' },
  indexer: { lagWarningSeconds: '索引延迟阈值' },
}

export function describeChangedFields(
  section: SettingSectionKey,
  before: unknown,
  after: unknown,
): string[] {
  if (valuesEqual(before, after)) return []
  const previous = record(before)
  const next = record(after)
  const labels = FIELD_LABELS[section]
  const changed = Object.keys(labels)
    .filter((key) => !valuesEqual(previous[key], next[key]))
    .map((key) => labels[key])
    .filter((label): label is string => Boolean(label))
  return changed.length > 0 ? changed : ['设置内容']
}

export function settingsExportFilename(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `admin-settings-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.json`
}

export function downloadTextFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
