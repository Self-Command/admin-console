import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account, IndexerStatus, SignatureAccount } from '@/lib/data/types'
import type { SavedView } from '@/lib/runtime/types'
import DirectoryPage from '@/app/(console)/directory/page'

const BASE_PERMISSIONS = ['directory.read', 'role.read', 'role.write', 'audit.read']

const mocks = vi.hoisted(() => ({
  permissions: ['directory.read', 'role.read', 'role.write', 'audit.read'] as string[],
  listAccounts: vi.fn(),
  getAccount: vi.fn(),
  batchExportAccounts: vi.fn(),
  searchSignatureAccounts: vi.fn(),
  savePreferences: vi.fn(),
  downloadTextFile: vi.fn(),
  preferences: {} as { savedViews?: SavedView[] },
}))

vi.mock('@/lib/download', () => ({
  downloadTextFile: mocks.downloadTextFile,
  exportTimestamp: () => '20261029-1200',
}))

vi.mock('@/components/auth/auth-provider', () => ({
  useAuth: () => ({
    identity: {
      did: 'did:web:ops.selfcommand.example',
      role: 'admin',
      permissions: mocks.permissions,
    },
    preview: true,
  }),
}))

vi.mock('@/lib/data/use-data-provider', () => {
  const provider = {
    listAccounts: mocks.listAccounts,
    getAccount: mocks.getAccount,
    batchExportAccounts: mocks.batchExportAccounts,
    searchSignatureAccounts: mocks.searchSignatureAccounts,
  }
  return { useDataProvider: () => provider }
})

vi.mock('@/components/layout/workspace-provider', () => ({
  useWorkspace: () => ({
    pageSize: 10,
    dateFormat: 'date-time' as const,
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
    preferences: mocks.preferences,
    savingPreferences: false,
    savePreferences: mocks.savePreferences,
  }),
}))

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

const signatureAccount: SignatureAccount = {
  did: 'did:plc:mallory5k7m2n9q4w6x8',
  handle: 'mallory.example.com',
  indexedAt: '2026-10-29T08:15:00.000Z',
  threatSignatures: [
    { property: 'email', value: 'mallory@example.com' },
    { property: 'domain', value: 'spam.example' },
  ],
}

const secondSignatureAccount: SignatureAccount = {
  did: 'did:plc:trent9c4v6b8n2m5q7z',
  handle: 'trent.example.com',
  indexedAt: '2026-10-29T08:20:00.000Z',
  threatSignatures: [{ property: 'email', value: 'trent@example.com' }],
}

function grantModerationRead() {
  mocks.permissions = [...BASE_PERMISSIONS, 'moderation.read']
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
    mocks.permissions = [...BASE_PERMISSIONS]
    mocks.listAccounts.mockReset()
    mocks.getAccount.mockReset()
    mocks.batchExportAccounts.mockReset()
    mocks.searchSignatureAccounts.mockReset()
    mocks.savePreferences.mockReset()
    mocks.downloadTextFile.mockReset()
    mocks.savePreferences.mockResolvedValue(true)
    mocks.preferences = {}
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

  it('requests sorted accounts and links each row to its detail route', async () => {
    mocks.listAccounts.mockResolvedValue(listResult())

    render(<DirectoryPage />)
    await screen.findByText('alice.example.com')

    expect(mocks.listAccounts).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, sort: 'indexedAt', order: 'desc' }),
    )

    const href = `/directory/${encodeURIComponent(account.did)}`
    expect(screen.getByRole('link', { name: /详情/ })).toHaveAttribute('href', href)
    expect(screen.getByRole('link', { name: /alice\.example\.com/ })).toHaveAttribute(
      'href',
      href,
    )
  })

  it('selects accounts and exports the chosen DID list as CSV', async () => {
    mocks.listAccounts.mockResolvedValue(listResult())
    mocks.batchExportAccounts.mockResolvedValue({
      count: 1,
      format: 'csv',
      content: 'did,handle\ndid:plc:alice7x4k2m6q3n5p4w,alice.example.com\n',
    })
    const user = userEvent.setup()
    render(<DirectoryPage />)
    await screen.findByText('alice.example.com')

    await user.click(screen.getByRole('checkbox', { name: '选择 alice.example.com' }))
    expect(screen.getByText(/已选择/)).toHaveTextContent('已选择 1 个账号')

    await user.click(screen.getByRole('button', { name: '导出 CSV' }))

    await waitFor(() =>
      expect(mocks.batchExportAccounts).toHaveBeenCalledWith([account.did], 'csv'),
    )
    expect(mocks.downloadTextFile).toHaveBeenCalledWith(
      'account-operations-20261029-1200.csv',
      'did,handle\ndid:plc:alice7x4k2m6q3n5p4w,alice.example.com\n',
      'text/csv;charset=utf-8',
    )
    expect(screen.getByText(/已选择/)).toHaveTextContent('已选择 1 个账号')
  })

  it('selects every account on the current page', async () => {
    const second: Account = {
      ...account,
      did: 'did:plc:bob2k5n8q4w7x1z3',
      handle: 'bob.example.com',
    }
    mocks.listAccounts.mockResolvedValue(
      listResult({ accounts: [account, second], total: 2 }),
    )
    const user = userEvent.setup()
    render(<DirectoryPage />)
    await screen.findByText('bob.example.com')

    await user.click(screen.getByRole('checkbox', { name: '选择当前页全部账号' }))

    expect(screen.getByText(/已选择/)).toHaveTextContent('已选择 2 个账号')
    expect(
      screen.getByRole('checkbox', { name: '选择当前页全部账号' }),
    ).toBeChecked()

    await user.click(screen.getByRole('button', { name: '清除选择' }))
    expect(screen.queryByText(/已选择/)).not.toBeInTheDocument()
  })

  it('saves the current filters as a named view', async () => {
    mocks.listAccounts.mockResolvedValue(listResult())
    mocks.savePreferences.mockImplementation(async (next: { savedViews?: SavedView[] }) => {
      mocks.preferences = { ...mocks.preferences, ...next }
      return true
    })
    const user = userEvent.setup()
    render(<DirectoryPage />)
    await screen.findByText('alice.example.com')

    await user.selectOptions(screen.getByLabelText('按状态筛选'), 'deactivated')
    await user.click(screen.getByRole('button', { name: /筛选视图/ }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/当前筛选：全部关键词/)).toHaveTextContent(/已停用/)

    await user.type(within(dialog).getByLabelText('视图名称'), '待核实停用账号')
    await user.click(within(dialog).getByRole('button', { name: '保存当前筛选' }))

    await waitFor(() =>
      expect(mocks.savePreferences).toHaveBeenCalledWith({
        savedViews: [
          expect.objectContaining({
            name: '待核实停用账号',
            status: 'deactivated',
            sort: 'indexedAt',
            order: 'desc',
          }),
        ],
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.preferences.savedViews?.[0]?.name).toBe('待核实停用账号')
  })

  it('applies a saved view to the list query', async () => {
    mocks.listAccounts.mockResolvedValue(listResult())
    mocks.preferences = {
      savedViews: [
        { id: 'view-1', name: '停用账号', status: 'deactivated', sort: 'handle', order: 'asc' },
      ],
    }
    const user = userEvent.setup()
    render(<DirectoryPage />)
    await screen.findByText('alice.example.com')

    await user.click(screen.getByRole('button', { name: /筛选视图/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/全部关键词 · 已停用 · 句柄升序/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: '应用' }))

    await waitFor(() =>
      expect(mocks.listAccounts).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'deactivated', sort: 'handle', order: 'asc' }),
      ),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('deletes a saved view after confirmation of the stored list', async () => {
    mocks.listAccounts.mockResolvedValue(listResult())
    mocks.preferences = {
      savedViews: [{ id: 'view-1', name: '停用账号', status: 'deactivated', sort: 'handle', order: 'asc' }],
    }
    mocks.savePreferences.mockImplementation(async (next: { savedViews?: SavedView[] }) => {
      mocks.preferences = { ...mocks.preferences, ...next }
      return true
    })
    const user = userEvent.setup()
    render(<DirectoryPage />)
    await screen.findByText('alice.example.com')

    await user.click(screen.getByRole('button', { name: /筛选视图/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: '删除视图 停用账号' }))

    await waitFor(() => expect(mocks.savePreferences).toHaveBeenCalledWith({ savedViews: [] }))
    expect(mocks.preferences.savedViews).toEqual([])
  })

  it('hides the signature search tab without moderation read permission', async () => {
    mocks.listAccounts.mockResolvedValue(listResult())

    render(<DirectoryPage />)

    await screen.findByText('alice.example.com')
    expect(screen.getByRole('tab', { name: '账号目录' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '威胁签名检索' })).not.toBeInTheDocument()
  })

  it('shows the signature search tab with moderation read permission', async () => {
    grantModerationRead()
    mocks.listAccounts.mockResolvedValue(listResult())

    render(<DirectoryPage />)

    expect(await screen.findByRole('tab', { name: '威胁签名检索' })).toBeInTheDocument()
  })

  it('searches deduplicated signature values and renders results without totals or indexer columns', async () => {
    grantModerationRead()
    mocks.listAccounts.mockResolvedValue(listResult())
    mocks.searchSignatureAccounts.mockResolvedValue({ accounts: [signatureAccount] })
    const user = userEvent.setup()
    render(<DirectoryPage />)

    await user.click(await screen.findByRole('tab', { name: '威胁签名检索' }))
    fireEvent.change(screen.getByLabelText('威胁签名值'), {
      target: { value: '  mallory@example.com  \n\nspam.example\nmallory@example.com\n' },
    })
    await user.click(screen.getByRole('button', { name: '开始检索' }))

    await waitFor(() =>
      expect(mocks.searchSignatureAccounts).toHaveBeenCalledWith({
        values: ['mallory@example.com', 'spam.example'],
        limit: 50,
      }),
    )
    expect(await screen.findByText('mallory.example.com')).toBeInTheDocument()
    expect(screen.getByText('email: mallory@example.com')).toBeInTheDocument()
    expect(screen.getByText('domain: spam.example')).toBeInTheDocument()
    expect(
      screen.getByText(
        '签名检索结果由审核服务实时计算，可能不包含全部匹配账号；可继续加载更多结果。',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('账号总数')).not.toBeInTheDocument()
    expect(screen.queryByText(/共 \d+ 条/)).not.toBeInTheDocument()
    expect(screen.queryByText('索引器运行正常')).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: '索引器状态' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      '账号',
      '账号标识',
      '威胁签名',
      '索引时间',
      '操作',
    ])
    expect(screen.getByRole('link', { name: '查看账号' })).toHaveAttribute(
      'href',
      `/directory/${encodeURIComponent(signatureAccount.did)}`,
    )
  })

  it('validates empty, oversized and overlong signature values before searching', async () => {
    grantModerationRead()
    mocks.listAccounts.mockResolvedValue(listResult())
    const user = userEvent.setup()
    render(<DirectoryPage />)

    await user.click(await screen.findByRole('tab', { name: '威胁签名检索' }))
    await user.click(screen.getByRole('button', { name: '开始检索' }))
    expect(screen.getByText('请输入至少一个签名值。')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('威胁签名值'), {
      target: { value: Array.from({ length: 11 }, (_, index) => `sig-${index}`).join('\n') },
    })
    await user.click(screen.getByRole('button', { name: '开始检索' }))
    expect(
      screen.getByText('一次最多检索 10 个签名值，请精简后重试。'),
    ).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('威胁签名值'), {
      target: { value: 'a'.repeat(2049) },
    })
    await user.click(screen.getByRole('button', { name: '开始检索' }))
    expect(screen.getByText('单个签名值不能超过 2048 个字符。')).toBeInTheDocument()
    expect(mocks.searchSignatureAccounts).not.toHaveBeenCalled()
  })

  it('appends more signature results with the cursor and prevents duplicate clicks', async () => {
    grantModerationRead()
    mocks.listAccounts.mockResolvedValue(listResult())
    let resolveMore!: (value: { accounts: SignatureAccount[] }) => void
    const moreResults = new Promise<{ accounts: SignatureAccount[] }>((resolve) => {
      resolveMore = resolve
    })
    mocks.searchSignatureAccounts
      .mockResolvedValueOnce({ accounts: [signatureAccount], cursor: 'cursor-2' })
      .mockReturnValueOnce(moreResults)
    const user = userEvent.setup()
    render(<DirectoryPage />)

    await user.click(await screen.findByRole('tab', { name: '威胁签名检索' }))
    fireEvent.change(screen.getByLabelText('威胁签名值'), {
      target: { value: 'mallory@example.com\nspam.example' },
    })
    await user.click(screen.getByRole('button', { name: '开始检索' }))
    await screen.findByText('mallory.example.com')

    await user.click(screen.getByRole('button', { name: '加载更多' }))
    await waitFor(() =>
      expect(mocks.searchSignatureAccounts).toHaveBeenLastCalledWith({
        values: ['mallory@example.com', 'spam.example'],
        cursor: 'cursor-2',
        limit: 50,
      }),
    )
    expect(screen.getByRole('button', { name: '加载更多' })).toBeDisabled()

    resolveMore({ accounts: [secondSignatureAccount] })

    expect(await screen.findByText('trent.example.com')).toBeInTheDocument()
    expect(screen.getByText('mallory.example.com')).toBeInTheDocument()
    expect(screen.getByText(/已加载 2 个账号/)).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '加载更多' })).not.toBeInTheDocument(),
    )
  })

  it('resets the cursor and previous results when the query changes', async () => {
    grantModerationRead()
    mocks.listAccounts.mockResolvedValue(listResult())
    mocks.searchSignatureAccounts
      .mockResolvedValueOnce({ accounts: [signatureAccount], cursor: 'cursor-2' })
      .mockResolvedValueOnce({ accounts: [secondSignatureAccount] })
    const user = userEvent.setup()
    render(<DirectoryPage />)

    await user.click(await screen.findByRole('tab', { name: '威胁签名检索' }))
    fireEvent.change(screen.getByLabelText('威胁签名值'), {
      target: { value: 'mallory@example.com' },
    })
    await user.click(screen.getByRole('button', { name: '开始检索' }))
    await screen.findByText('mallory.example.com')
    expect(screen.getByRole('button', { name: '加载更多' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('威胁签名值'), {
      target: { value: 'trent@example.com' },
    })
    await user.click(screen.getByRole('button', { name: '开始检索' }))

    expect(await screen.findByText('trent.example.com')).toBeInTheDocument()
    expect(screen.queryByText('mallory.example.com')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '加载更多' })).not.toBeInTheDocument()
    expect(mocks.searchSignatureAccounts).toHaveBeenLastCalledWith({
      values: ['trent@example.com'],
      limit: 50,
    })
  })

  it('shows the empty state when no signature account matches', async () => {
    grantModerationRead()
    mocks.listAccounts.mockResolvedValue(listResult())
    mocks.searchSignatureAccounts.mockResolvedValue({ accounts: [] })
    const user = userEvent.setup()
    render(<DirectoryPage />)

    await user.click(await screen.findByRole('tab', { name: '威胁签名检索' }))
    fireEvent.change(screen.getByLabelText('威胁签名值'), {
      target: { value: 'unknown.example' },
    })
    await user.click(screen.getByRole('button', { name: '开始检索' }))

    expect(await screen.findByText('未找到匹配账号')).toBeInTheDocument()
    expect(
      screen.getByText('审核服务未返回使用该签名值的账号。可以调整签名值后重试。'),
    ).toBeInTheDocument()
  })

  it('reports signature search failures and retries with the applied values', async () => {
    grantModerationRead()
    mocks.listAccounts.mockResolvedValue(listResult())
    mocks.searchSignatureAccounts
      .mockRejectedValueOnce(new Error('upstream unavailable'))
      .mockResolvedValueOnce({ accounts: [signatureAccount] })
    const user = userEvent.setup()
    render(<DirectoryPage />)

    await user.click(await screen.findByRole('tab', { name: '威胁签名检索' }))
    fireEvent.change(screen.getByLabelText('威胁签名值'), {
      target: { value: 'mallory@example.com' },
    })
    await user.click(screen.getByRole('button', { name: '开始检索' }))

    expect(await screen.findByText('签名检索失败')).toBeInTheDocument()
    expect(screen.getByText('操作失败，请稍后重试。')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '重试' }))

    expect(await screen.findByText('mallory.example.com')).toBeInTheDocument()
    expect(mocks.searchSignatureAccounts).toHaveBeenLastCalledWith({
      values: ['mallory@example.com'],
      limit: 50,
    })
    expect(mocks.searchSignatureAccounts).toHaveBeenCalledTimes(2)
  })
})
