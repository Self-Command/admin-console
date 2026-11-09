import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AccountGraphKind,
  AccountGraphQuery,
  AccountListSummary,
  AccountSummary,
} from '@/lib/data/types'
import { AccountRelationshipPanel } from '@/components/directory/account-relationship-panel'
import { formatDateTime, truncateDid } from '@/lib/format'

const mocks = vi.hoisted(() => ({
  did: 'did:plc:alice7x4k2m6q3n5p4w',
  getAccountGraph: vi.fn(),
}))

vi.mock('@/lib/data/use-data-provider', () => {
  const provider = { getAccountGraph: mocks.getAccountGraph }
  return { useDataProvider: () => provider }
})

const bob: AccountSummary = {
  did: 'did:plc:bob4k2m6q3n5p4w7x',
  handle: 'bob.example.com',
  displayName: '鲍勃',
  description: '城市摄影爱好者，长期记录城市夜景。',
}

const carol: AccountSummary = {
  did: 'did:plc:carol9m6q3n5p4w7x2z',
  handle: 'carol.example.com',
}

const curatedList: AccountListSummary = {
  uri: 'at://did:plc:alice7x4k2m6q3n5p4w/app.bsky.graph.list/curated',
  cid: 'bafyreicuratedlistcid',
  name: '城市摄影',
  purpose: 'app.bsky.graph.defs#curatelist',
  description: '收录城市夜景与街拍摄影账号。',
  listItemCount: 12,
  indexedAt: '2026-10-27T08:30:00.000Z',
}

const modList: AccountListSummary = {
  uri: 'at://did:plc:alice7x4k2m6q3n5p4w/app.bsky.graph.list/moderation',
  cid: 'bafyreimoderationlistcid',
  name: '重点关注',
  purpose: 'app.bsky.graph.defs#modlist',
  indexedAt: '2026-10-26T03:15:00.000Z',
}

const otherList: AccountListSummary = {
  uri: 'at://did:plc:alice7x4k2m6q3n5p4w/app.bsky.graph.list/reference',
  cid: 'bafyreireferencelistcid',
  name: '参考清单',
  purpose: 'app.bsky.graph.defs#referencelist',
  indexedAt: '2026-10-25T11:45:00.000Z',
}

function callsFor(kind: AccountGraphKind) {
  return mocks.getAccountGraph.mock.calls.filter(
    (call) => (call[0] as AccountGraphQuery).kind === kind,
  )
}

describe('account relationship panel', () => {
  beforeEach(() => {
    mocks.getAccountGraph.mockReset()
  })

  it('默认加载关注账号并展示账号信息与跳转入口', async () => {
    mocks.getAccountGraph.mockResolvedValue({ accounts: [bob] })

    render(<AccountRelationshipPanel did={mocks.did} />)

    await waitFor(() =>
      expect(mocks.getAccountGraph).toHaveBeenCalledWith({
        did: mocks.did,
        kind: 'follows',
        limit: 50,
      }),
    )

    expect(await screen.findByText('鲍勃')).toBeInTheDocument()
    expect(screen.getByText('@bob.example.com')).toBeInTheDocument()
    expect(
      screen.getByText(truncateDid(bob.did)),
    ).toBeInTheDocument()
    expect(screen.getByText('账号标识：')).toBeInTheDocument()
    expect(
      screen.getByText('社交关系数据来自账号服务，按页加载，可能随时间变化。'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '查看账号' })).toHaveAttribute(
      'href',
      `/directory/${encodeURIComponent(bob.did)}`,
    )
    expect(screen.getByText('已加载 1 个账号')).toBeInTheDocument()
  })

  it('切换粉丝页签使用正确类型加载，并在切回时复用缓存', async () => {
    const user = userEvent.setup()
    mocks.getAccountGraph.mockImplementation(async (query: AccountGraphQuery) =>
      query.kind === 'followers' ? { accounts: [carol] } : { accounts: [bob] },
    )

    render(<AccountRelationshipPanel did={mocks.did} />)
    await screen.findByText('鲍勃')

    await user.click(screen.getByRole('tab', { name: '粉丝' }))

    await waitFor(() =>
      expect(mocks.getAccountGraph).toHaveBeenCalledWith({
        did: mocks.did,
        kind: 'followers',
        limit: 50,
      }),
    )
    expect(await screen.findByText('@carol.example.com')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '关注' }))
    expect(await screen.findByText('鲍勃')).toBeInTheDocument()
    expect(callsFor('follows')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: '刷新' }))
    await waitFor(() => expect(callsFor('follows')).toHaveLength(2))
  })

  it('加载更多时携带游标并追加账号', async () => {
    const user = userEvent.setup()
    mocks.getAccountGraph
      .mockResolvedValueOnce({ accounts: [bob], cursor: 'cursor-follows-2' })
      .mockResolvedValueOnce({ accounts: [carol] })

    render(<AccountRelationshipPanel did={mocks.did} />)
    await screen.findByText('鲍勃')

    await user.click(screen.getByRole('button', { name: '加载更多' }))

    await waitFor(() =>
      expect(mocks.getAccountGraph).toHaveBeenLastCalledWith({
        did: mocks.did,
        kind: 'follows',
        cursor: 'cursor-follows-2',
        limit: 50,
      }),
    )
    expect(await screen.findByText('@carol.example.com')).toBeInTheDocument()
    expect(screen.getByText('鲍勃')).toBeInTheDocument()
    expect(screen.getByText('已加载 2 个账号')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '已加载全部' })).toBeDisabled()
  })

  it('没有关注账号时展示正式空态', async () => {
    mocks.getAccountGraph.mockResolvedValue({ accounts: [] })

    render(<AccountRelationshipPanel did={mocks.did} />)

    expect(await screen.findByText('暂无关注账号')).toBeInTheDocument()
    expect(
      screen.getByText('该账号目前没有公开的关注账号。'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '加载更多' })).not.toBeInTheDocument()
  })

  it('加载失败时展示失败原因并支持重试', async () => {
    const user = userEvent.setup()
    mocks.getAccountGraph
      .mockRejectedValueOnce(new Error('upstream unavailable'))
      .mockResolvedValueOnce({ accounts: [bob] })

    render(<AccountRelationshipPanel did={mocks.did} />)

    expect(await screen.findByText('关注列表加载失败')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('操作失败，请稍后重试。')

    await user.click(screen.getByRole('button', { name: '重试' }))

    expect(await screen.findByText('鲍勃')).toBeInTheDocument()
    expect(callsFor('follows')).toHaveLength(2)
  })

  it('列表页签展示列表用途、成员数、索引时间与列表标识', async () => {
    const user = userEvent.setup()
    mocks.getAccountGraph.mockImplementation(async (query: AccountGraphQuery) =>
      query.kind === 'lists'
        ? { lists: [curatedList, modList, otherList] }
        : { accounts: [bob] },
    )

    render(<AccountRelationshipPanel did={mocks.did} />)
    await screen.findByText('鲍勃')

    await user.click(screen.getByRole('tab', { name: '列表' }))
    expect(await screen.findByText('城市摄影')).toBeInTheDocument()

    const table = screen.getByRole('table')
    expect(within(table).getByText('内容列表')).toBeInTheDocument()
    expect(within(table).getByText('审核列表')).toBeInTheDocument()
    expect(within(table).getByText('其他列表')).toBeInTheDocument()
    expect(within(table).getByText('12')).toBeInTheDocument()
    expect(within(table).getAllByText('—')).toHaveLength(2)
    expect(
      within(table).getByText(formatDateTime(curatedList.indexedAt)),
    ).toBeInTheDocument()
    expect(within(table).getByText(curatedList.uri)).toBeInTheDocument()
    expect(screen.getByText('已加载 3 个列表')).toBeInTheDocument()
  })
})
