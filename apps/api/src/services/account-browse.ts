import { com } from '@admin/lexicons'
import type { Logger } from '../logger.js'
import { callUpstream, type XrpcClient } from '../upstream/client.js'
import { invalid } from './action-payloads.js'
import { iso, nonNegative, rec, shape, str } from './values.js'

export type AccountSummary = com.selfcommand.admin.account.defs.AccountSummary
export type ListSummary = com.selfcommand.admin.account.defs.ListSummary
export type PostSummary = com.selfcommand.admin.account.defs.PostSummary

export type AccountGraphResult = com.selfcommand.admin.account.graph.$OutputBody
export type AccountPostsResult = com.selfcommand.admin.account.posts.$OutputBody

export type AccountBrowseDeps = {
  appview: XrpcClient
  logger: Logger
}

type GraphKind = 'follows' | 'followers' | 'blocks' | 'lists'
type PostFilter = 'posts' | 'withReplies' | 'withMedia'

type GraphSource = {
  nsid: string
  field: GraphKind
  actor: boolean
}

const GRAPH_SOURCES: Record<GraphKind, GraphSource> = {
  follows: { nsid: 'app.bsky.graph.getFollows', field: 'follows', actor: true },
  followers: {
    nsid: 'app.bsky.graph.getFollowers',
    field: 'followers',
    actor: true,
  },
  blocks: { nsid: 'app.bsky.graph.getBlocks', field: 'blocks', actor: false },
  lists: { nsid: 'app.bsky.graph.getLists', field: 'lists', actor: true },
}

const FEED_FILTERS: Record<PostFilter, string> = {
  posts: 'posts_no_replies',
  withReplies: 'posts_with_replies',
  withMedia: 'posts_with_media',
}

function atUri(value: unknown): string | undefined {
  const uri = str(value)
  return uri && uri.startsWith('at://') ? uri : undefined
}

export function normalizeAccountSummary(raw: unknown): AccountSummary {
  const account = rec(raw)
  const did = str(account?.did)
  const handle = str(account?.handle, 256)
  if (!did || !did.startsWith('did:') || !handle) throw shape('账号浏览')
  const displayName = str(account?.displayName, 640)
  const description = str(account?.description, 3000)
  const avatar = str(account?.avatar, 2048)
  const createdAt = iso(account?.createdAt)
  return {
    did: did as AccountSummary['did'],
    handle: handle as AccountSummary['handle'],
    ...(displayName ? { displayName } : {}),
    ...(description ? { description } : {}),
    ...(avatar ? { avatar: avatar as AccountSummary['avatar'] } : {}),
    ...(createdAt ? { createdAt: createdAt as AccountSummary['createdAt'] } : {}),
  }
}

export function normalizeListSummary(raw: unknown): ListSummary {
  const list = rec(raw)
  const uri = atUri(list?.uri)
  const cid = str(list?.cid, 128)
  const name = str(list?.name, 64)
  const purpose = str(list?.purpose, 128)
  const indexedAt = iso(list?.indexedAt)
  if (!uri || !cid || !name || !purpose || !indexedAt) throw shape('账号浏览')
  const description = str(list?.description, 3000)
  const avatar = str(list?.avatar, 2048)
  const listItemCount = nonNegative(list?.listItemCount)
  return {
    uri: uri as ListSummary['uri'],
    cid: cid as ListSummary['cid'],
    name,
    purpose,
    ...(description ? { description } : {}),
    ...(avatar ? { avatar: avatar as ListSummary['avatar'] } : {}),
    ...(listItemCount !== undefined ? { listItemCount } : {}),
    indexedAt: indexedAt as ListSummary['indexedAt'],
  }
}

export function normalizePostSummary(raw: unknown): PostSummary {
  const post = rec(raw)
  const uri = atUri(post?.uri)
  const cid = str(post?.cid, 128)
  const indexedAt = iso(post?.indexedAt)
  if (!uri || !cid || !indexedAt) throw shape('账号浏览')
  const record = rec(post?.record)
  const textValue = record?.text
  const text = typeof textValue === 'string' ? textValue.slice(0, 10000) : ''
  const parent = rec(rec(record?.reply)?.parent)
  const replyParentUri = atUri(parent?.uri)
  const embedType =
    str(rec(post?.embed)?.$type, 128) ?? str(rec(record?.embed)?.$type, 128)
  return {
    uri: uri as PostSummary['uri'],
    cid: cid as PostSummary['cid'],
    text,
    indexedAt: indexedAt as PostSummary['indexedAt'],
    visibility: typeof textValue === 'string' ? 'available' : 'unavailable',
    ...(replyParentUri
      ? { replyParentUri: replyParentUri as PostSummary['replyParentUri'] }
      : {}),
    ...(embedType ? { embedType } : {}),
  }
}

function graphParams(
  source: GraphSource,
  params: { did: string; cursor?: string; limit: number },
): Record<string, unknown> {
  return {
    ...(source.actor ? { actor: params.did } : {}),
    ...(params.cursor ? { cursor: params.cursor } : {}),
    limit: params.limit,
  }
}

export async function getAccountGraph(
  deps: AccountBrowseDeps,
  params: {
    did: string
    kind: GraphKind
    cursor?: string
    limit: number
  },
): Promise<AccountGraphResult> {
  const source = (
    GRAPH_SOURCES as Record<string, GraphSource | undefined>
  )[params.kind]
  if (!source) throw invalid('不支持的浏览类型。')

  const raw = await callUpstream<unknown>(deps.appview, source.nsid, {
    params: graphParams(source, params),
  })
  const body = rec(raw)
  const entries = body?.[source.field]
  if (!body || !Array.isArray(entries)) throw shape('账号浏览')
  const cursor = str(body.cursor)

  if (source.field === 'lists') {
    return {
      lists: entries.map(normalizeListSummary),
      ...(cursor ? { cursor } : {}),
    }
  }
  return {
    accounts: entries.map(normalizeAccountSummary),
    ...(cursor ? { cursor } : {}),
  }
}

export async function getAccountPosts(
  deps: AccountBrowseDeps,
  params: {
    did: string
    filter: PostFilter
    cursor?: string
    limit: number
  },
): Promise<AccountPostsResult> {
  const filter = (FEED_FILTERS as Record<string, string | undefined>)[
    params.filter
  ]
  if (!filter) throw invalid('不支持的浏览类型。')

  const raw = await callUpstream<unknown>(
    deps.appview,
    'app.bsky.feed.getAuthorFeed',
    {
      params: {
        actor: params.did,
        filter,
        ...(params.cursor ? { cursor: params.cursor } : {}),
        limit: params.limit,
      },
    },
  )
  const body = rec(raw)
  const feed = body?.feed
  if (!body || !Array.isArray(feed)) throw shape('账号浏览')
  const cursor = str(body.cursor)
  return {
    posts: feed.map((entry) => normalizePostSummary(rec(entry)?.post)),
    ...(cursor ? { cursor } : {}),
  }
}
