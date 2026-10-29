import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account, IndexerStatus } from '@/lib/data/types'
import DirectoryPage from '@/app/(console)/directory/page'

const mocks = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  getAccount: vi.fn(),
}))

vi.mock('@/components/auth/auth-provider', () => ({
  useAuth: () => ({
    identity: {
      did: 'did:web:ops.selfcommand.example',
      role: 'admin',
      permissions: ['directory.read', 'role.read', 'role.write', 'audit.read'],
    },
    preview: true,
  }),
}))

vi.mock('@/lib/data/use-data-provider', () => {
  const provider = {
    listAccounts: mocks.listAccounts,
    getAccount: mocks.getAccount,
  }
  return { useDataProvider: () => provider }
})

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub)

const account: Account = {
  did: 'did:plc:alice7x4k2m6q3n5p4w',
  handle: 'alice.example.com',
  status: 'active',
  lastEventAt: '2026-10-29T07:40:02.000Z',
  indexedAt: '2026-10-29T07:41:14.000Z',
}

function indexer(overrides: Partial<IndexerStatus> = {}): IndexerStatus {
  return {
    backfillComplete: true,
    lastIndexedAt: new Date().toISOString(),
    cursor: '48213917',
    ...overrides,
  }
}

function listResult(overrides: Partial<{
  accounts: Account[]
  total: number
  indexer: IndexerStatus
  cursor: string
}> = {}) {
  return { accounts: [account], total: 1, indexer: indexer(), ...overrides }
}

describe('directory page', () => {
  beforeEach(() => {
    mocks.listAccounts.mockReset()
    mocks.getAccount.mockReset()
  })

  it('renders indexed accounts with a healthy indexer banner', async () => {
    mocks.listAccounts.mockResolvedValue(listResult())

    render(<DirectoryPage />)

    expect(await screen.findByText('alice.example.com')).toBeInTheDocument()
    expect(screen.getByText('索引器运行正常')).toBeInTheDocument()
    expect(screen.getByText('订阅中')).toBeInTheDocument()
    expect(screen.getAllByText(/共 1 条/)).toHaveLength(2)
  })

  it('keeps the directory readable while the indexer is stale', async () => {
    mocks.listAccounts.mockResolvedValue(
      listResult({
        indexer: indexer({ lastIndexedAt: '2026-10-28T00:00:00.000Z' }),
      }),
    )

    render(<DirectoryPage />)

    expect(await screen.findByText('索引可能已中断')).toBeInTheDocument()
    expect(screen.getByText(/只读查询仍可用/)).toBeInTheDocument()
    expect(screen.getByText('alice.example.com')).toBeInTheDocument()
  })

  it('reports backfilling before the initial sync finishes', async () => {
    mocks.listAccounts.mockResolvedValue(
      listResult({ indexer: indexer({ backfillComplete: false }) }),
    )

    render(<DirectoryPage />)

    expect(await screen.findByText('索引回填进行中')).toBeInTheDocument()
    expect(screen.getByText('回填中')).toBeInTheDocument()
  })

  it('searches on the server and shows the empty state', async () => {
    const user = userEvent.setup()
    mocks.listAccounts.mockResolvedValueOnce(listResult())
    mocks.listAccounts.mockResolvedValueOnce({ accounts: [], total: 0, indexer: indexer() })

    render(<DirectoryPage />)
    await screen.findByText('alice.example.com')

    await user.type(screen.getByLabelText('搜索账号'), 'nobody')

    await waitFor(() =>
      expect(mocks.listAccounts).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'nobody' }),
      ),
    )
    expect(await screen.findByText('没有匹配的账号')).toBeInTheDocument()
  })

  it('loads a read-only detail sheet through the provider', async () => {
    const user = userEvent.setup()
    mocks.listAccounts.mockResolvedValue(listResult())
    mocks.getAccount.mockResolvedValue({ account, indexer: indexer() })

    render(<DirectoryPage />)
    await screen.findByText('alice.example.com')
    await user.click(screen.getByRole('button', { name: '详情' }))

    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('alice.example.com')).toBeInTheDocument()
    expect(within(dialog).getByText(account.did)).toBeInTheDocument()
    expect(within(dialog).getByText('只读视图，数据来自账号目录索引。')).toBeInTheDocument()
    expect(mocks.getAccount).toHaveBeenCalledWith(account.did)
  })
})
