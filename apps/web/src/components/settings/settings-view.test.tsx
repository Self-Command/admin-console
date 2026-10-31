import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminApiError } from '@/lib/api/admin-client'
import type { SettingsGetResult, SettingsSections } from '@/lib/runtime/types'
import { SettingsView } from '@/components/settings/settings-view'

const mocks = vi.hoisted(() => ({
  callAdmin: vi.fn(),
  refreshWorkspace: vi.fn(),
  routerRefresh: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  permissions: ['settings.read', 'settings.write'] as string[],
}))

vi.mock('@/components/auth/auth-provider', () => ({
  useAuth: () => ({
    identity: {
      did: 'did:web:ops.selfcommand.example',
      role: 'admin',
      permissions: mocks.permissions,
    },
    callAdmin: mocks.callAdmin,
  }),
}))

vi.mock('@/components/layout/workspace-provider', () => ({
  useWorkspace: () => ({
    dateFormat: 'date-time',
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
    refresh: mocks.refreshWorkspace,
  }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.routerRefresh }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub)

const SETTINGS_GET = 'com.selfcommand.admin.settings.get'
const SETTINGS_UPDATE = 'com.selfcommand.admin.settings.update'

function buildSettings(): SettingsSections {
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
    navigation: {
      groups: [
        { id: 'overview', label: '概览', items: [{ id: 'dashboard', hidden: false }] },
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
    ui: { pageSize: 10, dateFormat: 'date-time' },
    integrations: {},
    audit: { exportMaxRows: 5000 },
    indexer: { lagWarningSeconds: 900 },
  }
}

function buildFixture(settings: SettingsSections, version = 3): SettingsGetResult {
  return {
    settings,
    defaults: buildSettings(),
    meta: [
      {
        section: 'branding',
        version,
        updatedAt: '2026-10-29T04:00:00.000Z',
        updatedBy: 'did:web:ops.selfcommand.example',
      },
    ],
  }
}

describe('settings view', () => {
  let serverSettings: SettingsSections

  beforeEach(() => {
    serverSettings = buildSettings()
    mocks.permissions = ['settings.read', 'settings.write']
    mocks.callAdmin.mockReset()
    mocks.refreshWorkspace.mockReset()
    mocks.routerRefresh.mockReset()
    mocks.toastSuccess.mockReset()
    mocks.toastError.mockReset()

    mocks.callAdmin.mockImplementation(
      (nsid: string, options?: { body?: { section: string; values: unknown } }) => {
        if (nsid === SETTINGS_GET) {
          return Promise.resolve(buildFixture(serverSettings))
        }
        if (nsid === SETTINGS_UPDATE && options?.body) {
          const { section, values } = options.body
          serverSettings = {
            ...serverSettings,
            [section]: values,
          } as SettingsSections
          return Promise.resolve({
            meta: {
              section,
              version: 4,
              updatedAt: '2026-10-29T05:00:00.000Z',
            },
          })
        }
        return Promise.reject(new Error(`unexpected call ${nsid}`))
      },
    )
  })

  it('renders the branding section with version metadata and a saved state', async () => {
    render(<SettingsView />)

    expect(await screen.findByRole('heading', { name: '品牌标识' })).toBeInTheDocument()
    expect(screen.getByText('版本 3')).toBeInTheDocument()
    expect(screen.getByText('所有更改已保存')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('例如：星海社区管理后台')).toHaveValue(
      'SelfCommand 管理后台',
    )
  })

  it('shows a read-only badge and blocks writes without settings.write', async () => {
    mocks.permissions = ['settings.read']
    render(<SettingsView />)

    expect(await screen.findByText('只读权限')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导入设置' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '全部恢复默认' })).toBeDisabled()
    const save = screen.getByRole('button', { name: '保存更改' })
    expect(save).toBeDisabled()
    expect(screen.getByPlaceholderText('例如：星海社区管理后台')).toBeDisabled()
  })

  it('saves the edited section with the expected version and clears the draft', async () => {
    const user = userEvent.setup()
    render(<SettingsView />)

    const description = await screen.findByPlaceholderText('用一句话说明这个后台的用途')
    await user.clear(description)
    await user.type(description, '账号、角色与审计的统一运营控制台，支持版式定制。')
    expect(screen.getByText('有未保存的更改')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '保存更改' }))

    await waitFor(() => {
      expect(mocks.callAdmin).toHaveBeenCalledWith(
        SETTINGS_UPDATE,
        expect.objectContaining({
          body: expect.objectContaining({
            section: 'branding',
            expectedVersion: 3,
            values: expect.objectContaining({
              description: '账号、角色与审计的统一运营控制台，支持版式定制。',
            }),
          }),
        }),
      )
    })
    await waitFor(() => {
      expect(mocks.toastSuccess).toHaveBeenCalledWith('「品牌标识」已保存。')
    })
    expect(await screen.findByText('所有更改已保存')).toBeInTheDocument()
    expect(mocks.routerRefresh).toHaveBeenCalled()
  })

  it('restores a historical revision through the history dialog', async () => {
    const user = userEvent.setup()
    const previousBranding = {
      ...buildSettings().branding,
      description: '恢复前的旧描述',
    }
    mocks.callAdmin.mockImplementation(
      (nsid: string, options?: { body?: { section: string; values: unknown } }) => {
        if (nsid === SETTINGS_GET) {
          return Promise.resolve(buildFixture(serverSettings))
        }
        if (nsid === 'com.selfcommand.admin.settings.history') {
          return Promise.resolve({
            revisions: [
              {
                id: 1,
                section: 'branding',
                version: 3,
                actor: 'did:web:ops.selfcommand.example',
                createdAt: '2026-10-29T04:00:00.000Z',
                before: previousBranding,
                after: buildSettings().branding,
              },
            ],
            total: 1,
          })
        }
        if (nsid === SETTINGS_UPDATE && options?.body) {
          return Promise.resolve({
            meta: {
              section: options.body.section,
              version: 4,
              updatedAt: '2026-10-29T05:00:00.000Z',
            },
          })
        }
        return Promise.reject(new Error(`unexpected call ${nsid}`))
      },
    )
    render(<SettingsView />)

    await screen.findByRole('heading', { name: '品牌标识' })
    await user.click(screen.getByRole('button', { name: '版本历史' }))

    const history = await screen.findByRole('dialog', { name: '版本历史 · 品牌标识' })
    expect(within(history).getByText('变更：')).toBeInTheDocument()
    await user.click(within(history).getByRole('button', { name: '查看详情' }))

    const detail = await screen.findByRole('dialog', { name: '版本 3 的变更内容' })
    await user.click(within(detail).getByRole('button', { name: '恢复到此次修改前' }))

    await waitFor(() => {
      expect(mocks.callAdmin).toHaveBeenCalledWith(
        SETTINGS_UPDATE,
        expect.objectContaining({
          body: expect.objectContaining({
            section: 'branding',
            reason: '恢复到版本 3 之前',
            values: expect.objectContaining({ description: '恢复前的旧描述' }),
          }),
        }),
      )
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('「品牌标识」已恢复到所选版本。')
  })

  it('resets every section after confirming the destructive action', async () => {
    const user = userEvent.setup()
    const defaults = buildSettings()
    mocks.callAdmin.mockImplementation((nsid: string) => {
      if (nsid === SETTINGS_GET) {
        return Promise.resolve(buildFixture(serverSettings))
      }
      if (nsid === 'com.selfcommand.admin.settings.reset') {
        return Promise.resolve({ settings: defaults, meta: [] })
      }
      return Promise.reject(new Error(`unexpected call ${nsid}`))
    })
    render(<SettingsView />)

    await screen.findByRole('heading', { name: '品牌标识' })
    await user.click(screen.getByRole('button', { name: '全部恢复默认' }))

    const dialog = await screen.findByRole('alertdialog', {
      name: '将所有分区恢复默认值？',
    })
    await user.click(within(dialog).getByRole('button', { name: '恢复默认' }))

    await waitFor(() => {
      expect(mocks.callAdmin).toHaveBeenCalledWith(
        'com.selfcommand.admin.settings.reset',
        { body: {} },
      )
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('所有分区已恢复内置默认值。')
  })

  it('keeps the draft and offers a reload action after a version conflict', async () => {
    const user = userEvent.setup()
    mocks.callAdmin.mockImplementation((nsid: string) => {
      if (nsid === SETTINGS_GET) {
        return Promise.resolve(buildFixture(serverSettings))
      }
      return Promise.reject(new AdminApiError('conflict', 409, 'SettingsConflict'))
    })
    render(<SettingsView />)

    const description = await screen.findByPlaceholderText('用一句话说明这个后台的用途')
    await user.clear(description)
    await user.type(description, '与另一位管理员并发修改后的内容。')
    await user.click(screen.getByRole('button', { name: '保存更改' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      '此分区已被其他管理员修改，当前草稿基于旧版本。请重新加载最新设置后再保存。',
    )
    expect(mocks.toastError).toHaveBeenCalledWith(
      '该分区已被其他管理员修改，请重新加载后再保存。',
    )
    expect(screen.getByRole('button', { name: '重新加载设置' })).toBeInTheDocument()
    expect(screen.getByText('有未保存的更改')).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText('用一句话说明这个后台的用途'),
    ).toHaveValue('与另一位管理员并发修改后的内容。')
  })
})
