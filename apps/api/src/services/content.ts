import { com } from '@admin/lexicons'
import { LexServerError } from '@atproto/lex-server'
import type { Logger } from '../logger.js'
import {
  callUpstream,
  fetchImageSearch,
  type XrpcClient,
} from '../upstream/client.js'
import { invalid } from './action-payloads.js'
import {
  normalizeEventView,
  normalizeReportView,
  type EventView,
} from './moderation.js'

export type ContentView = com.selfcommand.admin.defs.ContentView
export type ImageResult = com.selfcommand.admin.defs.ImageResult

export type ContentDeps = {
  appview: XrpcClient
  ozone: XrpcClient
  logger: Logger
}

export type ImageSearchConfig = {
  imageSearchUrl?: string
  imageSearchToken?: string
}

type RecordLike = Record<string, unknown>

function rec(value: unknown): RecordLike | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as RecordLike)
    : undefined
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function str(value: unknown, max = 2048): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : undefined
}

function integer(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

function nonNegative(value: unknown): number | undefined {
  const parsed = integer(value)
  return parsed !== undefined && parsed >= 0 ? parsed : undefined
}

function iso(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString()
}

function shape(what: string): LexServerError {
  return new LexServerError(502, {
    error: 'UpstreamUnavailable',
    message: `上游服务返回了无法识别的${what}数据，请稍后重试。`,
  })
}

function labelValues(...sources: unknown[]): string[] | undefined {
  const values: string[] = []
  for (const source of sources) {
    for (const entry of list(source)) {
      const value = str(rec(entry)?.val, 64) ?? str(entry, 64)
      if (value && !values.includes(value)) values.push(value)
    }
  }
  return values.length ? values.slice(0, 20) : undefined
}

function collectionOf(uri: string): string | undefined {
  return uri.startsWith('at://') ? uri.split('/').at(3) : undefined
}

function statusOf(entry: RecordLike | undefined): RecordLike | undefined {
  return rec(rec(entry?.moderation)?.subjectStatus) ?? rec(entry?.status)
}

export function normalizePostView(raw: unknown, entry?: unknown): ContentView {
  const post = rec(raw)
  const entryRecord = rec(entry)
  const author = rec(post?.author)
  const record = rec(post?.record)
  const status = statusOf(entryRecord)
  const uri = str(post?.uri)
  const authorDid = str(author?.did)
  if (!post || !uri || !authorDid) throw shape('内容')
  const labels = labelValues(post.labels, entryRecord?.labels)
  const authorHandle = str(author?.handle, 256)
  const text = str(record?.text, 1000)
  const collection = collectionOf(uri)
  const indexedAt = iso(post.indexedAt)
  const reviewState = str(status?.reviewState, 64)
  const likeCount = nonNegative(post.likeCount)
  const repostCount = nonNegative(post.repostCount)
  const replyCount = nonNegative(post.replyCount)
  const cid = str(post.cid, 128)
  return {
    uri: uri as ContentView['uri'],
    ...(cid ? { cid } : {}),
    author: authorDid as ContentView['author'],
    ...(authorHandle ? { authorHandle } : {}),
    ...(text ? { text } : {}),
    ...(collection ? { collection: collection as ContentView['collection'] } : {}),
    ...(indexedAt ? { indexedAt: indexedAt as ContentView['indexedAt'] } : {}),
    hidden: Boolean(status?.takendown),
    ...(reviewState ? { reviewState } : {}),
    ...(labels ? { labels } : {}),
    ...(likeCount !== undefined ? { likeCount } : {}),
    ...(repostCount !== undefined ? { repostCount } : {}),
    ...(replyCount !== undefined ? { replyCount } : {}),
  }
}

function normalizeRecordView(raw: unknown): ContentView {
  const entry = rec(raw)
  const value = rec(entry?.value)
  const repo = rec(entry?.repo)
  const status = statusOf(entry)
  const uri = str(entry?.uri)
  const authorDid = str(repo?.did)
  if (!entry || !uri || !authorDid) throw shape('内容')
  const labels = labelValues(entry.labels)
  const handle = str(repo?.handle, 256)
  const text = str(value?.text, 1000)
  const collection = collectionOf(uri)
  const indexedAt = iso(entry.indexedAt)
  const reviewState = str(status?.reviewState, 64)
  const cid = str(entry.cid, 128)
  return {
    uri: uri as ContentView['uri'],
    ...(cid ? { cid } : {}),
    author: authorDid as ContentView['author'],
    ...(handle ? { authorHandle: handle } : {}),
    ...(text ? { text } : {}),
    ...(collection ? { collection: collection as ContentView['collection'] } : {}),
    ...(indexedAt ? { indexedAt: indexedAt as ContentView['indexedAt'] } : {}),
    hidden: Boolean(status?.takendown),
    ...(reviewState ? { reviewState } : {}),
    ...(labels ? { labels } : {}),
  }
}

async function enrichStatuses(
  deps: ContentDeps,
  uris: string[],
): Promise<Map<string, unknown>> {
  if (!deps.ozone.configured || !uris.length) return new Map()
  const result = await callUpstream<{ records?: unknown[] }>(
    deps.ozone,
    'tools.ozone.moderation.getRecords',
    { params: { uris } },
  )
  const map = new Map<string, unknown>()
  for (const entry of list(result.records)) {
    const uri = str(rec(entry)?.uri)
    if (uri) map.set(uri, entry)
  }
  return map
}

export type ContentSearchResult = com.selfcommand.admin.content.search.$OutputBody

export async function searchContent(
  deps: ContentDeps,
  params: {
    q?: string
    author?: string
    mention?: string
    lang?: string
    domain?: string
    url?: string
    tag?: string
    since?: string
    until?: string
    sort?: string
    limit: number
    cursor?: string
  },
): Promise<ContentSearchResult> {
  const q = str(params.q, 256)
  if (!q) throw invalid('请输入搜索关键词。')
  const result = await callUpstream<{ posts?: unknown[]; cursor?: string }>(
    deps.appview,
    'app.bsky.feed.searchPosts',
    {
      params: {
        q,
        author: params.author,
        mentions: params.mention,
        lang: params.lang,
        domain: params.domain,
        url: params.url,
        tag: params.tag,
        since: params.since,
        until: params.until,
        sort: params.sort ?? 'latest',
        limit: params.limit,
        cursor: params.cursor,
      },
    },
  )
  const posts = list(result.posts)
  const uris = posts
    .map((post) => str(rec(post)?.uri))
    .filter((uri): uri is string => uri !== undefined)
  const statuses = await enrichStatuses(deps, uris)
  return {
    content: posts.map((post) => {
      const uri = str(rec(post)?.uri)
      return normalizePostView(post, uri ? statuses.get(uri) : undefined)
    }),
    moderationAvailable: deps.ozone.configured,
    ...(result.cursor !== undefined ? { cursor: result.cursor } : {}),
  }
}

export type ContentGetResult = com.selfcommand.admin.content.get.$OutputBody

export async function getContent(
  deps: ContentDeps,
  uri: string,
): Promise<ContentGetResult> {
  if (!uri.startsWith('at://')) throw invalid('内容地址格式不正确')
  if (!deps.ozone.configured) {
    const posts = await callUpstream<{ posts?: unknown[] }>(
      deps.appview,
      'app.bsky.feed.getPosts',
      { params: { uris: [uri] } },
    )
    const post = list(posts.posts)[0]
    if (!post) {
      throw new LexServerError(404, {
        error: 'NotFound',
        message: '内容不存在或已被删除。',
      })
    }
    return {
      record: normalizePostView(post),
      events: [],
      reports: [],
      moderationAvailable: false,
    }
  }

  const [postsResult, recordsResult, openReports, closedReports, eventsResult] =
    await Promise.all([
      callUpstream<{ posts?: unknown[] }>(deps.appview, 'app.bsky.feed.getPosts', {
        params: { uris: [uri] },
      }).catch((error: unknown) => {
        deps.logger.warn('appview post lookup failed', {
          uri,
          error: error instanceof Error ? error.message : 'Error',
        })
        return { posts: [] }
      }),
      callUpstream<{ records?: unknown[] }>(deps.ozone, 'tools.ozone.moderation.getRecords', {
        params: { uris: [uri] },
      }),
      callUpstream<{ reports?: unknown[] }>(deps.ozone, 'tools.ozone.report.queryReports', {
        params: { status: 'open', subject: uri, limit: 5 },
      }),
      callUpstream<{ reports?: unknown[] }>(deps.ozone, 'tools.ozone.report.queryReports', {
        params: { status: 'closed', subject: uri, limit: 5 },
      }),
      callUpstream<{ events?: unknown[] }>(deps.ozone, 'tools.ozone.moderation.queryEvents', {
        params: { subject: uri, limit: 20 },
      }),
    ])

  const found = list(recordsResult.records)[0]
  const entry = rec(found) && rec(rec(found)?.value) ? found : undefined
  const post = list(postsResult.posts)[0]
  if (!entry && !post) {
    throw new LexServerError(404, {
      error: 'NotFound',
      message: '内容不存在或已被删除。',
    })
  }
  const record = post
    ? normalizePostView(post, entry)
    : normalizeRecordView(entry)
  const reports = [...list(openReports.reports), ...list(closedReports.reports)]
    .map(normalizeReportView)
    .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1))
    .slice(0, 10)
  const events: EventView[] = list(eventsResult.events).map(normalizeEventView)
  const status = statusOf(rec(entry))

  return {
    record,
    ...(status ? { status: status as never } : {}),
    events,
    reports,
    moderationAvailable: true,
  }
}

function httpUrl(value: unknown, max = 2048): string | undefined {
  const text = str(value, max)
  if (!text) return undefined
  try {
    const url = new URL(text)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

export function normalizeImageResult(raw: unknown): ImageResult | undefined {
  const image = rec(raw)
  const imageUrl = httpUrl(image?.imageUrl)
  if (!image || !imageUrl) return undefined
  const thumbnailUrl = httpUrl(image.thumbnailUrl)
  const postUri = str(image.postUri)
  const author = str(image.author, 256)
  const description = str(image.description, 500)
  const score = nonNegative(image.score)
  return {
    imageUrl,
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...(postUri ? { postUri } : {}),
    ...(author ? { author } : {}),
    ...(description ? { description } : {}),
    ...(score !== undefined ? { score } : {}),
  }
}

export type ImageSearchResult = com.selfcommand.admin.content.imageSearch.$OutputBody

export async function searchImages(
  config: ImageSearchConfig,
  params: { q: string; limit: number; cursor?: string },
): Promise<ImageSearchResult> {
  const q = str(params.q, 200)
  if (!q) throw invalid('请输入图片检索关键词。')
  const raw = await fetchImageSearch(config, {
    q,
    limit: params.limit,
    ...(params.cursor ? { cursor: params.cursor } : {}),
  })
  const body = rec(raw) ?? {}
  const results = list(body.results)
    .map(normalizeImageResult)
    .filter((entry): entry is ImageResult => entry !== undefined)
  const total = nonNegative(body.total)
  const cursor = str(body.cursor)
  return {
    results,
    ...(total !== undefined ? { total } : {}),
    ...(cursor ? { cursor } : {}),
  }
}
