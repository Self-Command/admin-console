import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RelatedSignatureAccount, SignatureDetail } from '@/lib/data/types'
import { truncateDid } from '@/lib/format'
import { AccountRelatedSignatures } from '@/components/directory/account-related-signatures'

const mocks = vi.hoisted(() => ({
  did: 'did:plc:alice7x4k2m6q3n5p4w',
  findRelatedSignatureAccounts: vi.fn(),
  findSignatureCorrelation: vi.fn(),
}))

vi.mock('@/lib/data/use-data-provider', () => {
  const provider = {
    findRelatedSignatureAccounts: mocks.findRelatedSignatureAccounts,
    findSignatureCorrelation: mocks.findSignatureCorrelation,
  }
  return { useDataProvider: () => provider }
})

const aliceSimilarities: SignatureDetail[] = Array.from({ length: 8 }, (_, index) => ({
  property: `sig${index + 1}`,
  value: `value-${index + 1}`,
}))

const alice: RelatedSignatureAccount = {
  account: {
    did: 'did:plc:alice7x4k2m6q3n5p4w',
    handle: 'alice.example.com',
    indexedAt: '2026-10-01T00:00:00.000Z',
    threatSignatures: [
      { property: 'emailDomain', value: 'bulk-mail.example' },
      { property: 'ip', value: '203.0.113.10' },
    ],
  },
  similarities: aliceSimilarities,
}

const bob: RelatedSignatureAccount = {
  account: {
    did: 'did:plc:bob7x4k2m6q3n5p4wzz',
    handle: 'bob.example.com',
    indexedAt: '2026-10-02T00:00:00.000Z',
  },
  similarities: [{ property: 'phone', value: '+1-555-0100' }],
}

function renderPanel() {
  return render(<AccountRelatedSignatures did={mocks.did} />)
}

function correlationButton() {
  return screen.getByRole('button', { name: '查看签名相关性' })
}

async function selectAccounts(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText('alice.example.com')
  await user.click(screen.getByRole('checkbox', { name: '选择账号 alice.example.com' }))
  await user.click(screen.getByRole('checkbox', { name: '选择账号 bob.example.com' }))
}

describe('account related signatures', () => {
  beforeEach(() => {
    mocks.findRelatedSignatureAccounts.mockReset()
    mocks.findSignatureCorrelation.mockReset()
  })

  it('renders related accounts with signatures, threat signatures and detail links', async () => {
    mocks.findRelatedSignatureAccounts.mockResolvedValue({ accounts: [alice, bob] })
    renderPanel()

    expect(await screen.findByText('alice.example.com')).toBeInTheDocument()
    expect(mocks.findRelatedSignatureAccounts).toHaveBeenCalledWith({
      did: mocks.did,
      limit: 50,
    })

    expect(screen.getByText('bob.example.com')).toBeInTheDocument()
    expect(screen.getByText(truncateDid(alice.account.did))).toBeInTheDocument()
    expect(screen.getByText('相似签名 8 条')).toBeInTheDocument()
    expect(screen.getByText('相似签名 1 条')).toBeInTheDocument()

    expect(screen.getByText('sig1: value-1')).toBeInTheDocument()
    expect(screen.getByText('sig6: value-6')).toBeInTheDocument()
    expect(screen.queryByText('sig7: value-7')).not.toBeInTheDocument()
    expect(screen.getByText('另有 2 条')).toBeInTheDocument()

    expect(screen.getByText('账号威胁签名')).toBeInTheDocument()
    expect(screen.getByText('emailDomain: bulk-mail.example')).toBeInTheDocument()
    expect(screen.getByText('ip: 203.0.113.10')).toBeInTheDocument()

    const links = screen.getAllByRole('link', { name: '查看账号' })
    expect(links).toHaveLength(2)
    expect(links[0]).toHaveAttribute(
      'href',
      `/directory/${encodeURIComponent(alice.account.did)}`,
    )
    expect(links[1]).toHaveAttribute(
      'href',
      `/directory/${encodeURIComponent(bob.account.did)}`,
    )
  })

  it('loads the next page with the cursor and appends the accounts', async () => {
    const user = userEvent.setup()
    let releaseMore: (value: { accounts: RelatedSignatureAccount[] }) => void = () => {}
    const pendingMore = new Promise<{ accounts: RelatedSignatureAccount[] }>((resolve) => {
      releaseMore = resolve
    })
    mocks.findRelatedSignatureAccounts
      .mockResolvedValueOnce({ accounts: [alice], cursor: 'cursor-2' })
      .mockReturnValueOnce(pendingMore)

    renderPanel()

    const loadMore = await screen.findByRole('button', { name: '加载更多' })
    await user.click(loadMore)

    await waitFor(() =>
      expect(mocks.findRelatedSignatureAccounts).toHaveBeenLastCalledWith({
        did: mocks.did,
        cursor: 'cursor-2',
        limit: 50,
      }),
    )
    expect(loadMore).toBeDisabled()
    await user.click(loadMore)
    expect(mocks.findRelatedSignatureAccounts).toHaveBeenCalledTimes(2)

    releaseMore({ accounts: [bob] })

    expect(await screen.findByText('bob.example.com')).toBeInTheDocument()
    expect(screen.getByText('alice.example.com')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '加载更多' })).not.toBeInTheDocument()
  })

  it('shows the empty state and reloads on demand', async () => {
    const user = userEvent.setup()
    mocks.findRelatedSignatureAccounts
      .mockResolvedValueOnce({ accounts: [] })
      .mockResolvedValueOnce({ accounts: [alice] })

    renderPanel()

    expect(await screen.findByText('未发现关联账号')).toBeInTheDocument()
    expect(
      screen.getByText('审核服务未返回与该账号签名特征相同的其他账号。可以稍后重试。'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '重新加载' }))

    expect(await screen.findByText('alice.example.com')).toBeInTheDocument()
    expect(mocks.findRelatedSignatureAccounts).toHaveBeenCalledTimes(2)
  })

  it('shows a readable failure and recovers when retried', async () => {
    const user = userEvent.setup()
    mocks.findRelatedSignatureAccounts
      .mockRejectedValueOnce(new Error('upstream unavailable'))
      .mockResolvedValueOnce({ accounts: [alice] })

    renderPanel()

    expect(await screen.findByText('关联账号加载失败')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('操作失败，请稍后重试。')

    await user.click(screen.getByRole('button', { name: '重试' }))

    expect(await screen.findByText('alice.example.com')).toBeInTheDocument()
    expect(mocks.findRelatedSignatureAccounts).toHaveBeenCalledTimes(2)
  })

  it('enables correlation only after two accounts are selected and reports an empty result', async () => {
    const user = userEvent.setup()
    mocks.findRelatedSignatureAccounts.mockResolvedValue({ accounts: [alice, bob] })
    mocks.findSignatureCorrelation.mockResolvedValue({ details: [] })

    renderPanel()

    await screen.findByText('alice.example.com')
    expect(correlationButton()).toBeDisabled()
    expect(
      screen.getByText('至少选择两个账号才能比较签名相关性。'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: '选择账号 alice.example.com' }))
    expect(correlationButton()).toBeDisabled()

    await user.click(screen.getByRole('checkbox', { name: '选择账号 bob.example.com' }))
    expect(correlationButton()).toBeEnabled()

    await user.click(correlationButton())

    await waitFor(() =>
      expect(mocks.findSignatureCorrelation).toHaveBeenCalledWith([
        alice.account.did,
        bob.account.did,
      ]),
    )

    const dialog = await screen.findByRole('dialog')
    expect(
      await within(dialog).findByText('所选账号之间没有共同的签名特征。'),
    ).toBeInTheDocument()
  })

  it('keeps the dialog open with a readable error and retries the correlation query', async () => {
    const user = userEvent.setup()
    mocks.findRelatedSignatureAccounts.mockResolvedValue({ accounts: [alice, bob] })
    mocks.findSignatureCorrelation
      .mockRejectedValueOnce(new Error('upstream unavailable'))
      .mockResolvedValueOnce({
        details: [{ property: 'emailDomain', value: 'bulk-mail.example' }],
      })

    renderPanel()

    await selectAccounts(user)
    await user.click(correlationButton())

    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '操作失败，请稍后重试。',
    )

    await user.click(within(dialog).getByRole('button', { name: '重试' }))

    expect(await within(dialog).findByText('emailDomain')).toBeInTheDocument()
    expect(within(dialog).getByText('bulk-mail.example')).toBeInTheDocument()
    expect(mocks.findSignatureCorrelation).toHaveBeenCalledTimes(2)
  })

  it('limits the comparison selection to 25 accounts', async () => {
    const manyAccounts: RelatedSignatureAccount[] = Array.from(
      { length: 26 },
      (_, index) => ({
        account: {
          did: `did:plc:account${index}7x4k2m6q3n5p4w`,
          handle: `user${index}.example.com`,
          indexedAt: '2026-10-01T00:00:00.000Z',
        },
      }),
    )
    mocks.findRelatedSignatureAccounts.mockResolvedValue({ accounts: manyAccounts })

    renderPanel()

    await screen.findByText('user0.example.com')
    for (let index = 0; index < 25; index += 1) {
      fireEvent.click(
        screen.getByRole('checkbox', { name: `选择账号 user${index}.example.com` }),
      )
    }

    expect(
      screen.getByText('最多选择 25 个账号进行比较，请取消部分选择后再添加。'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('checkbox', { name: '选择账号 user25.example.com' }),
    ).toBeDisabled()
    expect(correlationButton()).toBeEnabled()
  })
})
