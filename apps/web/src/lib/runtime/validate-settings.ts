import type {
  SettingSectionKey,
  SettingsSections,
} from '@/lib/runtime/types'
import { contrastRatio } from '@/lib/runtime/theme'

const HEX_COLOR = /^#[0-9a-f]{6}$/i
const NAV_ID = /^[a-z0-9][a-z0-9-]{0,63}$/

const BUILTIN_HREFS: Record<string, string> = {
  dashboard: '/',
  content: '/content',
  'moderation-reports': '/moderation/reports',
  'moderation-queues': '/moderation/queues',
  'moderation-events': '/moderation/events',
  'moderation-scheduled': '/moderation/scheduled',
  directory: '/directory',
  roles: '/roles',
  audit: '/audit',
  security: '/security',
  'system-status': '/system',
  settings: '/settings',
  profile: '/profile',
  verification: '/verification',
  notifications: '/notifications',
  policy: '/policy',
}

export function isSafeLink(value: string, allowLocalHttp = false): boolean {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 512) return false
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return true
  try {
    const url = new URL(trimmed)
    if (url.protocol === 'https:') return true
    return (
      allowLocalHttp &&
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)
    )
  } catch {
    return false
  }
}

function lengthError(value: string, label: string, min: number, max: number): string | null {
  const length = value.trim().length
  if (length < min) return `${label}至少需要 ${min} 个字符。`
  if (length > max) return `${label}不能超过 ${max} 个字符。`
  return null
}

function validateBranding(values: SettingsSections['branding']): string[] {
  const errors: string[] = []
  const name = lengthError(values.name, '系统名称', 1, 60)
  if (name) errors.push(name)
  const shortName = lengthError(values.shortName, '简称', 1, 24)
  if (shortName) errors.push(shortName)
  const description = lengthError(values.description, '系统描述', 0, 200)
  if (description) errors.push(description)
  if (values.logoSource === 'url' && !isSafeLink(values.logoUrl ?? '')) {
    errors.push('Logo 地址必须是 https 链接或以 / 开头的站内路径。')
  }
  for (const [key, label, value] of [
    ['logoUrl', 'Logo 地址', values.logoUrl],
    ['faviconUrl', '站点图标地址', values.faviconUrl],
    ['supportUrl', '支持链接', values.supportUrl],
    ['docsUrl', '文档链接', values.docsUrl],
  ] as const) {
    if (value && !isSafeLink(value)) {
      errors.push(`${label}必须是 https 链接或以 / 开头的站内路径。`)
    }
    void key
  }
  return errors
}

function validateTheme(values: SettingsSections['theme']): string[] {
  const errors: string[] = []
  for (const [key, label] of [
    ['primaryLight', '浅色主色'],
    ['primaryDark', '深色主色'],
    ['accentLight', '浅色强调色'],
    ['accentDark', '深色强调色'],
  ] as const) {
    if (!HEX_COLOR.test(values[key])) errors.push(`${label}必须使用 #rrggbb 格式。`)
  }
  if (!Number.isInteger(values.radius) || values.radius < 0 || values.radius > 24) {
    errors.push('圆角必须在 0 到 24 之间。')
  }
  if (errors.length === 0) {
    if (contrastRatio(values.primaryLight, '#ffffff') < 3) {
      errors.push('浅色主色与白色的对比度需要达到 3.0，否则按钮文字难以辨认。')
    }
    if (contrastRatio(values.accentLight, '#ffffff') < 3) {
      errors.push('浅色强调色与白色的对比度需要达到 3.0。')
    }
    if (contrastRatio(values.primaryDark, '#0b1020') < 3) {
      errors.push('深色主色与深色背景的对比度需要达到 3.0。')
    }
    if (contrastRatio(values.accentDark, '#0b1020') < 3) {
      errors.push('深色强调色与深色背景的对比度需要达到 3.0。')
    }
  }
  return errors
}

function validateLogin(values: SettingsSections['login']): string[] {
  const errors: string[] = []
  const headline = lengthError(values.headline, '登录标题', 1, 80)
  if (headline) errors.push(headline)
  const subheadline = lengthError(values.subheadline, '登录说明', 0, 160)
  if (subheadline) errors.push(subheadline)
  const footer = lengthError(values.footer, '页脚说明', 0, 200)
  if (footer) errors.push(footer)
  if (values.legalLinks.length > 5) errors.push('条款链接最多 5 条。')
  values.legalLinks.forEach((link, index) => {
    const label = lengthError(link.label, `第 ${index + 1} 条链接名称`, 1, 40)
    if (label) errors.push(label)
    if (!isSafeLink(link.url)) {
      errors.push(`第 ${index + 1} 条链接地址必须是 https 链接或以 / 开头的站内路径。`)
    }
  })
  return errors
}

function validateNavigation(values: SettingsSections['navigation']): string[] {
  const errors: string[] = []
  if (values.groups.length < 1 || values.groups.length > 8) {
    errors.push('导航分组需要保留 1 到 8 个。')
  }
  const groupIds = new Set<string>()
  const itemIds = new Set<string>()

  for (const group of values.groups) {
    if (!NAV_ID.test(group.id)) errors.push(`分组标识 ${group.id} 不合法。`)
    if (groupIds.has(group.id)) errors.push(`分组标识 ${group.id} 重复。`)
    groupIds.add(group.id)
    const label = lengthError(group.label, '分组名称', 1, 40)
    if (label) errors.push(label)
    if (group.items.length > 20) errors.push(`分组「${group.label}」最多 20 个入口。`)
    for (const item of group.items) {
      if (!NAV_ID.test(item.id)) errors.push(`入口标识 ${item.id} 不合法。`)
      if (itemIds.has(item.id)) errors.push(`入口标识 ${item.id} 重复。`)
      itemIds.add(item.id)
      if (item.label !== undefined) {
        const itemLabel = lengthError(item.label, `入口 ${item.id} 的名称`, 0, 40)
        if (itemLabel) errors.push(itemLabel)
      }
      const builtinHref = BUILTIN_HREFS[item.id]
      if (builtinHref) continue
      if (!item.label?.trim()) errors.push(`自定义入口 ${item.id} 需要填写名称。`)
      if (!item.href || !isSafeLink(item.href)) {
        errors.push(`自定义入口 ${item.label || item.id} 的链接必须是 https 或站内路径。`)
      }
    }
  }

  for (const builtin of Object.keys(BUILTIN_HREFS)) {
    if (!itemIds.has(builtin)) errors.push(`内置入口 ${builtin} 不能删除。`)
  }
  return errors
}

function validateUi(values: SettingsSections['ui']): string[] {
  if (!Number.isInteger(values.pageSize) || values.pageSize < 1 || values.pageSize > 100) {
    return ['每页条数需要在 1 到 100 之间。']
  }
  return []
}

function validateIntegrations(values: SettingsSections['integrations']): string[] {
  const errors: string[] = []
  if (values.ozoneUrl && !isSafeLink(values.ozoneUrl, true)) {
    errors.push('Ozone 地址必须是 https 链接；本地调试允许 localhost 的 http 地址。')
  }
  if (values.pdsUrl && !isSafeLink(values.pdsUrl, true)) {
    errors.push('PDS 地址必须是 https 链接；本地调试允许 localhost 的 http 地址。')
  }
  return errors
}

function validateAudit(values: SettingsSections['audit']): string[] {
  if (
    !Number.isInteger(values.exportMaxRows) ||
    values.exportMaxRows < 100 ||
    values.exportMaxRows > 10000
  ) {
    return ['审计导出上限需要在 100 到 10000 之间。']
  }
  return []
}

function validateIndexer(values: SettingsSections['indexer']): string[] {
  if (
    !Number.isInteger(values.lagWarningSeconds) ||
    values.lagWarningSeconds < 60 ||
    values.lagWarningSeconds > 86400
  ) {
    return ['索引延迟提醒阈值需要在 60 到 86400 秒之间。']
  }
  return []
}

export function validateSectionValues<K extends SettingSectionKey>(
  section: K,
  values: SettingsSections[K],
): string[] {
  switch (section) {
    case 'branding':
      return validateBranding(values as SettingsSections['branding'])
    case 'theme':
      return validateTheme(values as SettingsSections['theme'])
    case 'login':
      return validateLogin(values as SettingsSections['login'])
    case 'navigation':
      return validateNavigation(values as SettingsSections['navigation'])
    case 'features':
      return []
    case 'ui':
      return validateUi(values as SettingsSections['ui'])
    case 'integrations':
      return validateIntegrations(values as SettingsSections['integrations'])
    case 'audit':
      return validateAudit(values as SettingsSections['audit'])
    case 'indexer':
      return validateIndexer(values as SettingsSections['indexer'])
  }
}
