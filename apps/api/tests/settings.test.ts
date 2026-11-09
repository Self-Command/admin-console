import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  SETTING_SECTIONS,
  contrastRatio,
  defaultSection,
  isSafeLink,
  normalizeStoredSection,
  sectionsEqual,
  validateSection,
  type NavigationSettings,
} from '../src/settings/defaults.js'

function withNav(nav: NavigationSettings): unknown {
  return nav
}

describe('settings validation', () => {
  it('accepts every built-in default partition', () => {
    for (const section of SETTING_SECTIONS) {
      expect(() => validateSection(section, defaultSection(section))).not.toThrow()
    }
  })

  it('rejects unknown keys instead of silently dropping them', () => {
    expect(() =>
      validateSection('branding', { ...DEFAULT_SETTINGS.branding, surprise: 1 }),
    ).toThrow(/unknown field/)
  })

  it('enforces readable theme colors', () => {
    expect(() =>
      validateSection('theme', { ...DEFAULT_SETTINGS.theme, primaryLight: '#fefefe' }),
    ).toThrow(/contrast/)
    expect(() =>
      validateSection('theme', { ...DEFAULT_SETTINGS.theme, primaryLight: 'blue' }),
    ).toThrow(/#rrggbb/)
  })

  it('rejects unsafe links in login and branding', () => {
    expect(() =>
      validateSection('login', {
        ...DEFAULT_SETTINGS.login,
        legalLinks: [{ label: 'Terms', url: 'javascript:alert(1)' }],
      }),
    ).toThrow(/https URL/)
    expect(() =>
      validateSection('branding', { ...DEFAULT_SETTINGS.branding, faviconUrl: '//evil.test' }),
    ).toThrow(/https URL/)
  })

  it('accepts relative paths and https links', () => {
    expect(isSafeLink('/privacy')).toBe(true)
    expect(isSafeLink('https://example.com/terms')).toBe(true)
    expect(isSafeLink('http://example.com')).toBe(false)
    expect(isSafeLink('http://localhost:2583', true)).toBe(true)
  })

  it('keeps every built-in navigation item present', () => {
    const nav = structuredClone(DEFAULT_SETTINGS.navigation)
    nav.groups[0]?.items.splice(0, 1)
    expect(() => validateSection('navigation', withNav(nav))).toThrow(/built-in item/)

    const renamed = structuredClone(DEFAULT_SETTINGS.navigation)
    renamed.groups[0]!.items[0] = { id: 'dashboard', href: '/elsewhere', hidden: false }
    expect(() => validateSection('navigation', withNav(renamed))).toThrow(/built-in target/)
  })

  it('requires a label and link on custom navigation items', () => {
    const nav = structuredClone(DEFAULT_SETTINGS.navigation)
    nav.groups[0]!.items.push({ id: 'reports', href: '/reports', hidden: false })
    expect(() => validateSection('navigation', withNav(nav))).toThrow(/requires a label/)

    const missingHref = structuredClone(DEFAULT_SETTINGS.navigation)
    missingHref.groups[0]!.items.push({ id: 'reports', label: '报表', hidden: false })
    expect(() => validateSection('navigation', withNav(missingHref))).toThrow(/requires a link/)

    const valid = structuredClone(DEFAULT_SETTINGS.navigation)
    valid.groups[0]!.items.push({ id: 'reports', label: '报表', href: '/reports', hidden: false })
    expect(() => validateSection('navigation', withNav(valid))).not.toThrow()
  })

  it('rejects duplicate navigation identifiers', () => {
    const nav = structuredClone(DEFAULT_SETTINGS.navigation)
    nav.groups[1]!.items.push({ id: 'dashboard', hidden: false })
    expect(() => validateSection('navigation', withNav(nav))).toThrow(/duplicated/)
  })

  it('falls back to defaults when a stored partition is corrupted', () => {
    const fallback = normalizeStoredSection('theme', { primaryLight: 'nope' })
    expect(fallback).toEqual(DEFAULT_SETTINGS.theme)
  })

  it('compares sections structurally', () => {
    expect(sectionsEqual(DEFAULT_SETTINGS.branding, structuredClone(DEFAULT_SETTINGS.branding))).toBe(true)
    expect(sectionsEqual(DEFAULT_SETTINGS.branding, { ...DEFAULT_SETTINGS.branding, name: 'x' })).toBe(false)
  })

  it('computes WCAG contrast ratios used by the validator', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
  })
})
