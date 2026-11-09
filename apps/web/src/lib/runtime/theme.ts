import type { RuntimeTheme } from '@/lib/runtime/types'

const DARK_CANVAS = '#0b1020'
const LIGHT_CANVAS = '#ffffff'

const HEX_COLOR = /^#[0-9a-f]{6}$/i

export function normalizeHex(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value.toLowerCase() : fallback
}

function hexToRgb(hex: string): [number, number, number] | null {
  if (!HEX_COLOR.test(hex)) return null
  const value = hex.slice(1)
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ]
}

function toHex(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, '0')
}

export function mixHex(base: string, tint: string, tintWeight: number): string {
  const a = hexToRgb(base)
  const b = hexToRgb(tint)
  if (!a || !b) return base
  const weight = Math.max(0, Math.min(1, tintWeight))
  return `#${toHex(a[0] + (b[0] - a[0]) * weight)}${toHex(a[1] + (b[1] - a[1]) * weight)}${toHex(a[2] + (b[2] - a[2]) * weight)}`
}

function channel(value: number): number {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2])
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

export function readableForeground(background: string): string {
  return contrastRatio(background, LIGHT_CANVAS) >= contrastRatio(background, DARK_CANVAS)
    ? LIGHT_CANVAS
    : DARK_CANVAS
}

export type ThemeVariables = Record<string, string>

export type ThemeVariableSet = {
  light: ThemeVariables
  dark: ThemeVariables
}

const SERIF_STACK =
  "ui-serif, Georgia, Cambria, 'Songti SC', 'SimSun', 'Noto Serif SC', serif"

export function buildThemeVariables(theme: RuntimeTheme): ThemeVariableSet {
  const accentLight = mixHex(LIGHT_CANVAS, theme.accentLight, 0.12)
  const accentDark = mixHex(DARK_CANVAS, theme.accentDark, 0.22)
  const primaryLightForeground = readableForeground(theme.primaryLight)
  const primaryDarkForeground = readableForeground(theme.primaryDark)

  const shared: ThemeVariables = {
    '--radius': `${theme.radius}px`,
  }

  if (theme.fontFamily === 'serif') {
    shared['--font-sans'] = SERIF_STACK
  }

  return {
    light: {
      ...shared,
      '--primary': theme.primaryLight,
      '--primary-foreground': primaryLightForeground,
      '--ring': theme.primaryLight,
      '--accent': accentLight,
      '--accent-foreground': readableForeground(accentLight),
      '--sidebar-primary': theme.primaryLight,
      '--sidebar-primary-foreground': primaryLightForeground,
      '--sidebar-ring': theme.primaryLight,
      '--sidebar-accent': accentLight,
      '--sidebar-accent-foreground': readableForeground(accentLight),
    },
    dark: {
      ...shared,
      '--primary': theme.primaryDark,
      '--primary-foreground': primaryDarkForeground,
      '--ring': theme.primaryDark,
      '--accent': accentDark,
      '--accent-foreground': readableForeground(accentDark),
      '--sidebar-primary': theme.primaryDark,
      '--sidebar-primary-foreground': primaryDarkForeground,
      '--sidebar-ring': theme.primaryDark,
      '--sidebar-accent': accentDark,
      '--sidebar-accent-foreground': readableForeground(accentDark),
    },
  }
}

function declarations(variables: ThemeVariables): string {
  return Object.entries(variables)
    .map(([key, value]) => `${key}:${value};`)
    .join('')
}

export function buildThemeStyleTag(theme: RuntimeTheme): string {
  const { light, dark } = buildThemeVariables(theme)
  return `html:root{${declarations(light)}}html.dark{${declarations(dark)}}`
}
