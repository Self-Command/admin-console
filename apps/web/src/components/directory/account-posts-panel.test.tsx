import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountPost, AccountPostsQuery } from '@/lib/data/types'
import { AccountPostsPanel } from '@/components/directory/account-posts-panel'
import { formatDateTime } from '@/lib/format'

const mocks = vi.hoisted(() => ({
  did: 'did:plc:bob4k2m6q3n5p4w7x',
  getAccountPosts: vi.fn(),
}))

vi.mock('@/lib/data/use-data-provider', () => {
  const provider = { getAccountPosts: mocks.getAccountPosts }
  return { useDataProvider: () => provider }
})

const basePost: AccountPost = {
  uri: 'at://did:plc:bob4k2m6q3n5p4w7x/app.bsky.feed.post/3kbase',
  cid: 'bafyreibasepostcid',
  text: '今天拍摄了一组城市夜景。',
  indexedAt: '2026-10-28T02:00:00.000Z',
  visibility: 'available',
  replyParentUri: 'at://did:plc:other4k2m6q3n5p4w/app.bsky.feed.post/3kparent',
  embedType: 'app.bsky.embed.images#view',
}

const replyPost: AccountPost = {
  uri: 'at://did:plc:bob4k2m6q3n5p4w7x/app.bsky.feed.post/3kreply',
  cid: 'bafyreireplypostcid',
  text: '感谢分享，构图很有层次。',
  indexedAt: '2026-10-28T03:00:00.000Z',
  visibility: 'available',
}

const secondPost: AccountPost = {
  uri: 'at://did:plc:bob4k2m6q3n5p4w7x/app.bsky.feed.post/3ksecond',
  cid: 'bafyreisecondpostcid',
  text: '补充一张清晨的街景。',
  indexedAt: '2026-10-29T01:00:00.000Z',
  visibility: 'available',
}

describe('account posts panel', () => {
  beforeEach(() => {
    mocks.getAccountPosts.mockReset()
  })

  it('默认加载全部帖子并展示文本、时间与引用信息', async () => {
    mocks.getAccountPosts.mockResolvedValue({ posts: [basePost] })

    render(<AccountPostsPanel did={mocks.did} />)

    await waitFor(() =>
      expect(mocks.getAccountPosts).toHaveBeenCalledWith({
        did: mocks.did,
        filter: 'posts',
        limit: 50,
      }),
    )

    expect(await screen.findByText(basePost.text)).toBeInTheDocument()
    expect(screen.getByText(formatDateTime(basePost.indexedAt))).toBeInTheDocument()
    expect(screen.getByText('可见')).toBeInTheDocument()
    expect(screen.getByText('回复其他帖子')).toBeInTheDocument()
    expect(screen.getByText('包含引用内容')).toBeInTheDocument()
    expect(screen.getByLabelText('帖子筛选')).toHaveValue('posts')
    expect(
      screen.getByText('帖子内容来自账号服务，仅展示文本摘要与可用状态。'),
    ).toBeInTheDocument()
  })

  it('切换筛选后按新条件从第一页重新加载', async () => {
    const user = userEvent.setup()
    mocks.getAccountPosts.mockImplementation(async (query: AccountPostsQuery) =>
      query.filter === 'withReplies' ? { posts: [replyPost] } : { posts: [basePost] },
    )

    render(<AccountPostsPanel did={mocks.did} />)
    await screen.findByText(basePost.text)

    await user.selectOptions(screen.getByLabelText('帖子筛选'), 'withReplies')

    await waitFor(() =>
      expect(mocks.getAccountPosts).toHaveBeenLastCalledWith({
        did: mocks.did,
        filter: 'withReplies',
        limit: 50,
      }),
    )
    expect(await screen.findByText(replyPost.text)).toBeInTheDocument()
    expect(screen.queryByText(basePost.text)).not.toBeInTheDocument()
    expect(screen.getByLabelText('帖子筛选')).toHaveValue('withReplies')
  })

  it('按可见状态展示对应文案，并为无正文帖子提供说明', async () => {
    const posts: AccountPost[] = [
      {
        ...basePost,
        uri: 'at://did:plc:bob4k2m6q3n5p4w7x/app.bsky.feed.post/3kavailable',
        cid: 'bafyreiavailablecid',
        text: '正常可见的帖子。',
        replyParentUri: undefined,
        embedType: undefined,
        visibility: 'available',
      },
      {
        ...basePost,
        uri: 'at://did:plc:bob4k2m6q3n5p4w7x/app.bsky.feed.post/3knotfound',
        cid: 'bafyreinotfoundcid',
        text: '上游返回该记录内容不存在。',
        replyParentUri: undefined,
        embedType: undefined,
        visibility: 'notFound',
      },
      {
        ...basePost,
        uri: 'at://did:plc:bob4k2m6q3n5p4w7x/app.bsky.feed.post/3kblocked',
        cid: 'bafyreiblockedcid',
        text: '上游返回该记录已被屏蔽。',
        replyParentUri: undefined,
        embedType: undefined,
        visibility: 'blocked',
      },
      {
        ...basePost,
        uri: 'at://did:plc:bob4k2m6q3n5p4w7x/app.bsky.feed.post/3kunavailable',
        cid: 'bafyreiunavailablecid',
        text: '   ',
        replyParentUri: undefined,
        embedType: undefined,
        visibility: 'unavailable',
      },
    ]
    mocks.getAccountPosts.mockResolvedValue({ posts })

    render(<AccountPostsPanel did={mocks.did} />)

    expect(await screen.findByText('可见')).toBeInTheDocument()
    expect(screen.getByText('内容不存在')).toBeInTheDocument()
    expect(screen.getByText('已屏蔽')).toBeInTheDocument()
    expect(screen.getByText('不可用')).toBeInTheDocument()
    expect(screen.getByText('该帖子没有正文内容。')).toBeInTheDocument()
  })

  it('加载更多时携带游标并追加帖子', async () => {
    const user = userEvent.setup()
    mocks.getAccountPosts
      .mockResolvedValueOnce({ posts: [basePost], cursor: 'cursor-posts-2' })
      .mockResolvedValueOnce({ posts: [secondPost] })

    render(<AccountPostsPanel did={mocks.did} />)
    await screen.findByText(basePost.text)

    await user.click(screen.getByRole('button', { name: '加载更多' }))

    await waitFor(() =>
      expect(mocks.getAccountPosts).toHaveBeenLastCalledWith({
        did: mocks.did,
        filter: 'posts',
        cursor: 'cursor-posts-2',
        limit: 50,
      }),
    )
    expect(await screen.findByText(secondPost.text)).toBeInTheDocument()
    expect(screen.getByText(basePost.text)).toBeInTheDocument()
    expect(screen.getByText('已加载 2 条帖子')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '已加载全部' })).toBeDisabled()
  })

  it('没有帖子时展示空态', async () => {
    mocks.getAccountPosts.mockResolvedValue({ posts: [] })

    render(<AccountPostsPanel did={mocks.did} />)

    expect(await screen.findByText('暂无帖子')).toBeInTheDocument()
    expect(
      screen.getByText('该账号目前没有可展示的公开帖子。可以调整帖子筛选后再试。'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '加载更多' })).not.toBeInTheDocument()
  })

  it('加载失败时展示失败原因并支持重试', async () => {
    const user = userEvent.setup()
    mocks.getAccountPosts
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({ posts: [basePost] })

    render(<AccountPostsPanel did={mocks.did} />)

    expect(await screen.findByText('帖子加载失败')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('操作失败，请稍后重试。')

    await user.click(screen.getByRole('button', { name: '重试' }))

    expect(await screen.findByText(basePost.text)).toBeInTheDocument()
    expect(mocks.getAccountPosts).toHaveBeenCalledTimes(2)
  })
})
