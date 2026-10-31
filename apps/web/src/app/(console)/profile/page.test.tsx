import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminApiError } from '@/lib/api/admin-client'
import ProfilePage from '@/app/(console)/profile/page'

const mocks = vi.hoisted(() => ({
  getSelfAccess: vi.fn(),
  savePreferences: vi.fn(),
  signOut: vi.fn(),
  identity: {
    did: 'did:web:ops.selfcommand.example',
    role: 'admin',
    permissions: [
      'directory.read',
      'role.read',
      'role.write',
      'audit.read',
      'settings.read',
      'settings.write',
    ],
  },
  session: {
    did: 'did:web:ops.selfcommand.example',
    service: 'https://pds.selfcommand.example',
  },
}))

vi.mock('@/components/auth/auth-provider', () => ({
  useAuth: () => ({
    identity: mocks.identity,
    session: mocks.session,
    displayName: '运营负责人',
    signOut: mocks.signOut,
  }),
}))

vi.mock('@/components/layout/workspace-provider', () => ({
  useWorkspace: () => ({
    preferences: { themeMode: 'system' },
    density: 'comfortable',
    pageSize: 20,
    dateFormat: 'date-time',
    savingPreferences: false,
    savePreferences: mocks.savePreferences,
  }),
}))

vi.mock('@/lib/data/use-data-provider', () => {
  const provider = { getSelfAccess: mocks.getSelfAccess }
  return { useDataProvider: () => provider }
})

describe('profile page access records', () => {
  beforeEach(() => {
    mocks.getSelfAccess.mockReset()
    mocks.savePreferences.mockReset()
    mocks.signOut.mockReset()
  })

  it('lists the caller access records with the unblocked state', async () => {
    mocks.getSelfAccess.mockResolvedValue({
      blocked: false,
      records: [
        {
          did: mocks.identity.did,
          ip: '203.0.113.10',
          userAgent: 'Chrome/126',
          firstSeenAt: '2026-10-28T01:00:00.000Z',
          lastSeenAt: '2026-10-29T02:00:00.000Z',
          requestCount: 4,
        },
      ],
    })

    render(<ProfilePage />)

    expect(await screen.findByText('当前未被封锁，后台访问正常。')).toBeInTheDocument()
    expect(screen.getByText('203.0.113.10')).toBeInTheDocument()
    expect(screen.getByText('Chrome/126')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.queryByText(/暂无访问记录/)).not.toBeInTheDocument()
  })

  it('shows the block reason and who applied it', async () => {
    mocks.getSelfAccess.mockResolvedValue({
      blocked: true,
      blockedAt: '2026-10-28T03:00:00.000Z',
      blockedBy: 'did:web:security.selfcommand.example',
      reason: '账号共享',
      records: [],
    })

    render(<ProfilePage />)

    expect(await screen.findByText('后台访问已被封锁')).toBeInTheDocument()
    expect(screen.getByText('账号共享')).toBeInTheDocument()
    expect(screen.getByText(/解除需由其他管理员操作/)).toBeInTheDocument()
    expect(screen.queryByText('当前未被封锁，后台访问正常。')).not.toBeInTheDocument()
  })

  it('offers a retry when the access records fail to load', async () => {
    mocks.getSelfAccess
      .mockRejectedValueOnce(new AdminApiError('server', 500))
      .mockResolvedValueOnce({ blocked: false, records: [] })
    const user = userEvent.setup()

    render(<ProfilePage />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('后台服务暂时不可用，请稍后重试。')
    await user.click(screen.getByRole('button', { name: '重试' }))

    expect(await screen.findByText('当前未被封锁，后台访问正常。')).toBeInTheDocument()
    expect(mocks.getSelfAccess).toHaveBeenCalledTimes(2)
  })
})