import { cache } from 'react'
import { adminApiConfig } from '@/lib/config'
import { DEFAULT_PUBLIC_SETTINGS } from '@/lib/runtime/defaults'
import type {
  LegalLink,
  LoginBackground,
  PublicSettings,
  RuntimeBranding,
  RuntimeLogin,
  RuntimeTheme,
} from '@/lib/runtime/types'

export const PUBLIC_SETTINGS_TIMEOUT_MS = 1500

const HEX_COLOR = /^#[0-9a-f]{6}$/i
const THEME_MODES = ['light', 'dark', 'system'] as const
const DENSITIES = ['comfortable', 'compact'] as const
const FONTS = ['sans', 'serif'] as const
const BACKGROUNDS = ['gradient', 'solid', 'none'] as const
const LOGO_SOURCES = ['icon', 'url', 'upload'] as const

export function isSafePublicLink(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 512) return false
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return true
  try {
    return new URL(trimmed).protocol === 'https:'
  } catch {
    return false
  }
}

function readString(value: unknown, fallback: string, max: number, min = 0): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (trimmed.length < min || trimmed.length > max) return fallback
  return trimmed
}

function readOptionalLink(value: unknown): string | undefined {
  return isSafePublicLink(value) ? value.trim() : undefined
}

function readEnum<T extends string>(
  value: unknown,
  values: readonly T[],
  fallback: T,
): T {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

function readInteger(value: unknown, fallback: number, min: number, max: number): number {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max
    ? (value as number)
    : fallback
}

function normalizeBranding(raw: unknown): RuntimeBranding {
  const defaults = DEFAULT_PUBLIC_SETTINGS.branding
  if (!raw || typeof raw !== 'object') return defaults
  const value = raw as Record<string, unknown>
  const branding: RuntimeBranding = {
    name: readString(value.name, defaults.name, 60, 1),
    shortName: readString(value.shortName, defaults.shortName, 24, 1),
    description: readString(value.description, defaults.description, 200),
    logoSource: readEnum(value.logoSource, LOGO_SOURCES, defaults.logoSource),
  }
  const logoUrl = readOptionalLink(value.logoUrl)
  const faviconUrl = readOptionalLink(value.faviconUrl)
  const supportUrl = readOptionalLink(value.supportUrl)
  const docsUrl = readOptionalLink(value.docsUrl)
  if (logoUrl) branding.logoUrl = logoUrl
  if (faviconUrl) branding.faviconUrl = faviconUrl
  if (supportUrl) branding.supportUrl = supportUrl
  if (docsUrl) branding.docsUrl = docsUrl
  return branding
}

function normalizeTheme(raw: unknown): RuntimeTheme {
  const defaults = DEFAULT_PUBLIC_SETTINGS.theme
  if (!raw || typeof raw !== 'object') return defaults
  const value = raw as Record<string, unknown>
  return {
    primaryLight: HEX_COLOR.test(String(value.primaryLight))
      ? String(value.primaryLight).toLowerCase()
      : defaults.primaryLight,
    primaryDark: HEX_COLOR.test(String(value.primaryDark))
      ? String(value.primaryDark).toLowerCase()
      : defaults.primaryDark,
    accentLight: HEX_COLOR.test(String(value.accentLight))
      ? String(value.accentLight).toLowerCase()
      : defaults.accentLight,
    accentDark: HEX_COLOR.test(String(value.accentDark))
      ? String(value.accentDark).toLowerCase()
      : defaults.accentDark,
    radius: readInteger(value.radius, defaults.radius, 0, 24),
    density: readEnum(value.density, DENSITIES, defaults.density),
    fontFamily: readEnum(value.fontFamily, FONTS, defaults.fontFamily),
    defaultMode: readEnum(value.defaultMode, THEME_MODES, defaults.defaultMode),
  }
}

function normalizeLegalLinks(raw: unknown): LegalLink[] {
  if (!Array.isArray(raw)) return []
  return raw
    .slice(0, 5)
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const value = item as Record<string, unknown>
      const label = readString(value.label, '', 40, 1)
      if (!label || !isSafePublicLink(value.url)) return null
      return { label, url: (value.url as string).trim() }
    })
    .filter((item): item is LegalLink => item !== null)
}

function normalizeLogin(raw: unknown): RuntimeLogin {
  const defaults = DEFAULT_PUBLIC_SETTINGS.login
  if (!raw || typeof raw !== 'object') return defaults
  const value = raw as Record<string, unknown>
  return {
    headline: readString(value.headline, defaults.headline, 80, 1),
    subheadline: readString(value.subheadline, defaults.subheadline, 160),
    footer: readString(value.footer, defaults.footer, 200),
    background: readEnum<LoginBackground>(value.background, BACKGROUNDS, defaults.background),
    legalLinks: normalizeLegalLinks(value.legalLinks),
  }
}

export function normalizePublicSettings(raw: unknown): PublicSettings {
  if (!raw || typeof raw !== 'object') {
    return structuredClone(DEFAULT_PUBLIC_SETTINGS)
  }
  const value = raw as Record<string, unknown>
  return {
    branding: normalizeBranding(value.branding),
    theme: normalizeTheme(value.theme),
    login: normalizeLogin(value.login),
    version: readInteger(value.version, 0, 0, Number.MAX_SAFE_INTEGER),
    ...(typeof value.updatedAt === 'string' ? { updatedAt: value.updatedAt } : {}),
  }
}

export function resolveLogoUrl(
  branding: RuntimeBranding,
  apiUrl: string = adminApiConfig.url,
): string | undefined {
  if (branding.logoSource === 'upload') return `${apiUrl.replace(/\/+$/, '')}/branding/logo`
  if (branding.logoSource === 'url' && isSafePublicLink(branding.logoUrl)) {
    return branding.logoUrl.trim()
  }
  return undefined
}

export function resolveFaviconUrl(
  branding: RuntimeBranding,
  apiUrl: string = adminApiConfig.url,
): string | undefined {
  if (isSafePublicLink(branding.faviconUrl)) return branding.faviconUrl.trim()
  if (branding.logoSource === 'upload') return `${apiUrl.replace(/\/+$/, '')}/branding/logo`
  return undefined
}

async function fetchPublicSettings(): Promise<PublicSettings> {
  try {
    const response = await fetch(
      `${adminApiConfig.url}/xrpc/com.selfcommand.admin.settings.public`,
      {
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(PUBLIC_SETTINGS_TIMEOUT_MS),
      },
    )
    if (!response.ok) return structuredClone(DEFAULT_PUBLIC_SETTINGS)
    return normalizePublicSettings(await response.json())
  } catch {
    return structuredClone(DEFAULT_PUBLIC_SETTINGS)
  }
}

/** Request-scoped runtime settings; always resolves so pages never fail on branding. */
export const getPublicSettings = cache(fetchPublicSettings)
