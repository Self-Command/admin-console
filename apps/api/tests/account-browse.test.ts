import { describe, expect, it } from 'vitest'
import { silentLogger } from '../src/logger.js'
import {
  getAccountGraph,
  getAccountPosts,
} from '../src/services/account-browse.js'
import { createFakeUpstream } from './helpers/fake-upstream.js'

const VIEWER_DID = 'did:plc:viewer'
const ISO = '2026-10-29T01:00:00.000Z'
const SHAPE_ERROR = '上游服务返回了无法识别的账号浏览数据，请稍后重试。'

const ACCOUNT = {
  did: 'did:plc:alice',
  handle: 'alice.test',
  displayName: '爱丽丝',
  description: '社区成员',
  avatar: 'https://cdn.test/avatar/alice.png',
  createdAt: ISO,
}

const LIST = {
  uri: 'at://did:plc:alice/app.bsky.graph.list/3klist',
  cid: 'bafyreilist',
  name: '重点关注',
  purpose: 'app.bsky.graph.defs#curatelist',
  description: '社区关注列表',
  avatar: 'https://cdn.test/avatar/list.png',
  listItemCount: 3,
  indexedAt: ISO,
}

const POST = {
  uri: 'at://did:plc:alice/app.bsky.feed.post/3kpost',
  cid: 'bafyreipost',
  record: {
    text: '社区内容',
    reply: { parent: { uri: 'at://did:plc:bob/app.bsky.feed.post/3kparent' } },
  },
  embed: { $type: 'app.bsky.embed.images#view' },
  indexedAt: ISO,
}

function deps(appview: ReturnType<typeof createFakeUpstream>) {
  return { appview, logger: silentLogger }
}

describe('account graph browsing', () => {
  it('maps follows with actor, cursor and limit', async () => {
    const appview = createFakeUpstream((nsid) =>
      nsid === 'app.bsky.graph.getFollows'
        ? { follows: [ACCOUNT], cursor: 'next-page' }
        : {},
    )

    const result = await getAccountGraph(deps(appview), {
      did: VIEWER_DID,
      kind: 'follows',
      cursor: 'page-1',
      limit: 20,
    })

    expect(appview.calls).toHaveLength(1)
    expect(appview.calls[0]?.nsid).toBe('app.bsky.graph.getFollows')
    expect(appview.calls[0]?.options?.params).toStrictEqual({
      actor: VIEWER_DID,
      cursor: 'page-1',
      limit: 20,
    })
    expect(result).toStrictEqual({
      accounts: [
        {
          did: ACCOUNT.did,
          handle: ACCOUNT.handle,
          displayName: ACCOUNT.displayName,
          description: ACCOUNT.description,
          avatar: ACCOUNT.avatar,
          createdAt: ISO,
        },
      ],
      cursor: 'next-page',
    })
  })

  it('maps followers and returns an empty page', async () => {
    const appview = createFakeUpstream((nsid) =>
      nsid === 'app.bsky.graph.getFollowers' ? { followers: [] } : {},
    )

    const result = await getAccountGraph(deps(appview), {
      did: VIEWER_DID,
      kind: 'followers',
      limit: 10,
    })

    expect(appview.calls[0]?.nsid).toBe('app.bsky.graph.getFollowers')
    expect(appview.calls[0]?.options?.params).toStrictEqual({
      actor: VIEWER_DID,
      limit: 10,
    })
    expect(result).toStrictEqual({ accounts: [] })
  })

  it('omits actor when reading the viewer block list', async () => {
    const appview = createFakeUpstream((nsid) =>
      nsid === 'app.bsky.graph.getBlocks' ? { blocks: [ACCOUNT] } : {},
    )

    const result = await getAccountGraph(deps(appview), {
      did: VIEWER_DID,
      kind: 'blocks',
      limit: 30,
    })

    expect(appview.calls[0]?.nsid).toBe('app.bsky.graph.getBlocks')
    expect(appview.calls[0]?.options?.params).toStrictEqual({ limit: 30 })
    expect(result.accounts).toHaveLength(1)
  })

  it('maps lists with their own summary shape', async () => {
    const appview = createFakeUpstream((nsid) =>
      nsid === 'app.bsky.graph.getLists'
        ? { lists: [LIST], cursor: 'more' }
        : {},
    )

    const result = await getAccountGraph(deps(appview), {
      did: VIEWER_DID,
      kind: 'lists',
      limit: 10,
    })

    expect(appview.calls[0]?.nsid).toBe('app.bsky.graph.getLists')
    expect(appview.calls[0]?.options?.params).toStrictEqual({
      actor: VIEWER_DID,
      limit: 10,
    })
    expect(result).toStrictEqual({
      lists: [
        {
          uri: LIST.uri,
          cid: LIST.cid,
          name: LIST.name,
          purpose: LIST.purpose,
          description: LIST.description,
          avatar: LIST.avatar,
          listItemCount: LIST.listItemCount,
          indexedAt: ISO,
        },
      ],
      cursor: 'more',
    })
  })

  it('rejects accounts without a handle', async () => {
    const appview = createFakeUpstream(() => ({
      follows: [{ did: ACCOUNT.did }],
    }))

    await expect(
      getAccountGraph(deps(appview), {
        did: VIEWER_DID,
        kind: 'follows',
        limit: 10,
      }),
    ).rejects.toMatchObject({
      status: 502,
      body: { error: 'UpstreamUnavailable', message: SHAPE_ERROR },
    })
  })

  it('rejects non-array graph payloads', async () => {
    const appview = createFakeUpstream(() => ({ follows: {} }))

    await expect(
      getAccountGraph(deps(appview), {
        did: VIEWER_DID,
        kind: 'follows',
        limit: 10,
      }),
    ).rejects.toMatchObject({
      status: 502,
      body: { error: 'UpstreamUnavailable', message: SHAPE_ERROR },
    })
  })

  it('rejects unsupported graph kinds without calling upstream', async () => {
    const appview = createFakeUpstream(() => ({}))

    await expect(
      getAccountGraph(deps(appview), {
        did: VIEWER_DID,
        kind: 'likes' as never,
        limit: 10,
      }),
    ).rejects.toMatchObject({
      status: 400,
      body: { error: 'InvalidRequest', message: '不支持的浏览类型。' },
    })
    expect(appview.calls).toHaveLength(0)
  })

  it('passes through NotConfigured when the AppView has no credential', async () => {
    const appview = createFakeUpstream(() => ({}), { configured: false })

    await expect(
      getAccountGraph(deps(appview), {
        did: VIEWER_DID,
        kind: 'follows',
        limit: 10,
      }),
    ).rejects.toMatchObject({
      status: 503,
      body: { error: 'NotConfigured' },
    })
  })
})

describe('account post browsing', () => {
  const FILTER_CASES: [('posts' | 'withReplies' | 'withMedia'), string][] = [
    ['posts', 'posts_no_replies'],
    ['withReplies', 'posts_with_replies'],
    ['withMedia', 'posts_with_media'],
  ]

  it('maps authored posts with visibility, reply and embed fields', async () => {
    const appview = createFakeUpstream((nsid) =>
      nsid === 'app.bsky.feed.getAuthorFeed'
        ? { feed: [{ post: POST }], cursor: 'next-page' }
        : {},
    )

    const result = await getAccountPosts(deps(appview), {
      did: VIEWER_DID,
      filter: 'posts',
      cursor: 'page-1',
      limit: 25,
    })

    expect(appview.calls).toHaveLength(1)
    expect(appview.calls[0]?.nsid).toBe('app.bsky.feed.getAuthorFeed')
    expect(appview.calls[0]?.options?.params).toStrictEqual({
      actor: VIEWER_DID,
      filter: 'posts_no_replies',
      cursor: 'page-1',
      limit: 25,
    })
    expect(result).toStrictEqual({
      posts: [
        {
          uri: POST.uri,
          cid: POST.cid,
          text: '社区内容',
          indexedAt: ISO,
          visibility: 'available',
          replyParentUri: 'at://did:plc:bob/app.bsky.feed.post/3kparent',
          embedType: 'app.bsky.embed.images#view',
        },
      ],
      cursor: 'next-page',
    })
  })

  it.each(FILTER_CASES)(
    'maps the %s filter to %s and returns an empty page',
    async (filter, upstreamFilter) => {
      const appview = createFakeUpstream((nsid) =>
        nsid === 'app.bsky.feed.getAuthorFeed' ? { feed: [] } : {},
      )

      const result = await getAccountPosts(deps(appview), {
        did: VIEWER_DID,
        filter,
        limit: 5,
      })

      expect(appview.calls[0]?.options?.params).toStrictEqual({
        actor: VIEWER_DID,
        filter: upstreamFilter,
        limit: 5,
      })
      expect(result).toStrictEqual({ posts: [] })
    },
  )

  it('marks posts without string record text as unavailable', async () => {
    const appview = createFakeUpstream(() => ({
      feed: [
        {
          post: {
            uri: 'at://did:plc:alice/app.bsky.feed.post/3kempty',
            cid: 'bafyreiempty',
            record: {},
            indexedAt: ISO,
          },
        },
        {
          post: {
            uri: 'at://did:plc:alice/app.bsky.feed.post/3kinvalid',
            cid: 'bafyreiinvalid',
            record: { text: 42, embed: { $type: 'app.bsky.embed.video' } },
            indexedAt: ISO,
          },
        },
      ],
    }))

    const result = await getAccountPosts(deps(appview), {
      did: VIEWER_DID,
      filter: 'posts',
      limit: 10,
    })

    expect(result.posts).toStrictEqual([
      {
        uri: 'at://did:plc:alice/app.bsky.feed.post/3kempty',
        cid: 'bafyreiempty',
        text: '',
        indexedAt: ISO,
        visibility: 'unavailable',
      },
      {
        uri: 'at://did:plc:alice/app.bsky.feed.post/3kinvalid',
        cid: 'bafyreiinvalid',
        text: '',
        indexedAt: ISO,
        visibility: 'unavailable',
        embedType: 'app.bsky.embed.video',
      },
    ])
  })

  it('rejects posts without a cid', async () => {
    const appview = createFakeUpstream(() => ({
      feed: [{ post: { ...POST, cid: undefined } }],
    }))

    await expect(
      getAccountPosts(deps(appview), {
        did: VIEWER_DID,
        filter: 'posts',
        limit: 10,
      }),
    ).rejects.toMatchObject({
      status: 502,
      body: { error: 'UpstreamUnavailable', message: SHAPE_ERROR },
    })
  })

  it('rejects unsupported filters without calling upstream', async () => {
    const appview = createFakeUpstream(() => ({}))

    await expect(
      getAccountPosts(deps(appview), {
        did: VIEWER_DID,
        filter: 'likes' as never,
        limit: 10,
      }),
    ).rejects.toMatchObject({
      status: 400,
      body: { error: 'InvalidRequest', message: '不支持的浏览类型。' },
    })
    expect(appview.calls).toHaveLength(0)
  })

  it('passes through NotConfigured when the AppView has no credential', async () => {
    const appview = createFakeUpstream(() => ({}), { configured: false })

    await expect(
      getAccountPosts(deps(appview), {
        did: VIEWER_DID,
        filter: 'posts',
        limit: 10,
      }),
    ).rejects.toMatchObject({
      status: 503,
      body: { error: 'NotConfigured' },
    })
  })
})
