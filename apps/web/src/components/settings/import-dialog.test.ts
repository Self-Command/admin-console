import { describe, expect, it } from 'vitest'
import { parseSettingsDocument } from '@/components/settings/import-dialog'
import type { SettingsSections } from '@/lib/runtime/types'

function currentSettings(): SettingsSections {
  return {
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
    navigation: { groups: [] },
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
    ui: { pageSize: 10, dateFormat: 'date-time' },
    integrations: {},
    audit: { exportMaxRows: 5000 },
    indexer: { lagWarningSeconds: 900 },
  }
}

describe('parseSettingsDocument', () => {
  it('rejects files that are not valid JSON', () => {
    const result = parseSettingsDocument('{ not json', currentSettings())
    expect(result.sections).toEqual({})
    expect(result.fileError).toBe('文件不是有效的 JSON，请重新导出后再试。')
  })

  it('rejects unknown sections instead of silently ignoring them', () => {
    const result = parseSettingsDocument(
      JSON.stringify({ sections: { unknownSection: { name: 'x' } } }),
      currentSettings(),
    )
    expect(result.fileError).toBe('文件包含无法识别的分区：unknownSection。')
  })

  it('merges a partial branding section with the current values', () => {
    const result = parseSettingsDocument(
      JSON.stringify({ sections: { branding: { name: '星海社区管理后台' } } }),
      currentSettings(),
    )
    expect(result.fileError).toBeNull()
    expect(result.sectionErrors).toEqual([])
    expect(result.sections.branding).toMatchObject({
      name: '星海社区管理后台',
      shortName: 'SelfCommand',
      logoSource: 'icon',
    })
  })

  it('reports section errors for invalid values', () => {
    const result = parseSettingsDocument(
      JSON.stringify({
        sections: { theme: { primaryLight: 'not-a-color', radius: 10 } },
      }),
      currentSettings(),
    )
    expect(result.fileError).toBeNull()
    expect(result.sectionErrors).toHaveLength(1)
    expect(result.sectionErrors[0]?.section).toBe('theme')
    expect(result.sectionErrors[0]?.messages.length).toBeGreaterThan(0)
    expect(result.sections.theme).toBeUndefined()
  })

  it('reports fields that are not part of the section contract', () => {
    const result = parseSettingsDocument(
      JSON.stringify({ sections: { ui: { pageSize: 20, extra: true } } }),
      currentSettings(),
    )
    expect(result.sectionErrors[0]?.messages).toEqual([
      '包含无法识别的字段：extra。',
    ])
  })
})
