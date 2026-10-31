import { com } from '@admin/lexicons'
import { LexServerError } from '@atproto/lex-server'
import type { Kysely } from 'kysely'
import type { RequestMeta } from '../audit.js'
import { writeAudit, auditErrorCode } from '../audit.js'
import type { Database } from '../db/types.js'
import type { Logger } from '../logger.js'
import { rateLimit } from '../rate-limit.js'
import type { XrpcClient } from '../upstream/client.js'
import { callUpstream } from '../upstream/client.js'
import { invalid } from './action-payloads.js'
import { normalizePostView, type ContentView } from './content.js'
import { isoDate, renderCsv } from './csv.js'
import { moderationAnalytics } from './moderation.js'

export type ContentExportResult = com.selfcommand.admin.content.export.$OutputBody
export type AnalyticsExportResult = com.selfcommand.admin.analytics.export.$OutputBody

export type ExportContext = {
  db: Kysely<Database>
  logger: Logger
  actor: string
  meta: RequestMeta
}

export const CONTENT_EXPORT_MAX_ROWS = 10_000
const SEARCH_PAGE_LIMIT = 100
const EXPORT_WINDOW_MS = 10 * 60_000
const CONTENT_EXPORT_RATE = 5
const ANALYTICS_EXPORT_RATE = 10
const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8'

const CONTENT_COLUMNS = [
  '内容地址',
  '作者账号名',
  '作者标识',
  '内容摘要',
  '索引时间',
  '可见状态',
  '标签',
  '点赞数',
  '转发数',
  '回复数',
] as const

const ANALYTICS_COLUMNS = [
  '日期',
  '新增举报',
  '待处理',
  '已结案',
  '升级处理',
  '已处置',
  '已确认',
] as const

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
}

function limitExport(key: string, limit: number): void {
  const result = rateLimit(key, limit, EXPORT_WINDOW_MS)
  if (!result.allowed) {
    throw new LexServerError(429, {
      error: 'RateLimited',
      message: `导出操作过于频繁，请在 ${result.retryAfterSeconds} 秒后重试。`,
    })
  }
}

function filterSummary(params: {
  q: string
  author?: string
  mention?: string
  lang?: string
  domain?: string
  url?: string
  tag?: string
  since?: string
  until?: string
  sort?: string
}): string {
  const parts = [`关键词「${params.q}」`]
  if (params.author) parts.push(`作者 ${params.author}`)
  if (params.mention) parts.push(`提及 ${params.mention}`)
  if (params.lang) parts.push(`语言 ${params.lang}`)
  if (params.domain) parts.push(`域名 ${params.domain}`)
  if (params.url) parts.push(`链接 ${params.url}`)
  if (params.tag) parts.push(`标签 ${params.tag}`)
  if (params.since) parts.push(`起始 ${params.since}`)
  if (params.until) parts.push(`截止 ${params.until}`)
  if (params.sort) parts.push(`排序 ${params.sort}`)
  return parts.join('；')
}

function contentRow(view: ContentView): string[] {
  return [
    view.uri,
    view.authorHandle ?? '',
    view.author,
    view.text ?? '',
    isoDate(view.indexedAt),
    view.hidden ? '已隐藏' : '可见',
    (view.labels ?? []).join('、'),
    view.likeCount === undefined ? '' : String(view.likeCount),
    view.repostCount === undefined ? '' : String(view.repostCount),
    view.replyCount === undefined ? '' : String(view.replyCount),
  ]
}

export type ContentExportParams = {
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
}

export async function exportContent(
  deps: { appview: XrpcClient; logger: Logger },
  ctx: ExportContext,
  params: ContentExportParams,
): Promise<ContentExportResult> {
  const q = params.q?.trim()
  if (!q) throw invalid('请输入搜索关键词。')
  if (q.length > 256) throw invalid('搜索关键词不能超过 256 个字符。')

  limitExport(`export:content:${ctx.actor}`, CONTENT_EXPORT_RATE)
  const filters = filterSummary({ ...params, q })

  const rows: ContentView[] = []
  let cursor: string | undefined
  let truncated = false
  try {
    while (rows.length < CONTENT_EXPORT_MAX_ROWS) {
      const page = await callUpstream<{ posts?: unknown[]; cursor?: string }>(
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
            limit: SEARCH_PAGE_LIMIT,
            ...(cursor ? { cursor } : {}),
          },
        },
      )
      const posts = Array.isArray(page.posts) ? page.posts : []
      for (const post of posts) {
        if (rows.length >= CONTENT_EXPORT_MAX_ROWS) {
          truncated = true
          break
        }
        rows.push(normalizePostView(post))
      }
      const next = typeof page.cursor === 'string' && page.cursor ? page.cursor : undefined
      if (!next || posts.length === 0) break
      if (rows.length >= CONTENT_EXPORT_MAX_ROWS) {
        truncated = true
        break
      }
      cursor = next
    }
  } catch (error) {
    await writeAudit(ctx.db, ctx.logger, {
      actor: ctx.actor,
      action: 'com.selfcommand.admin.content.export',
      targetType: 'content',
      target: '内容检索',
      result: 'error',
      detail: `导出内容检索结果失败（错误码：${auditErrorCode(error)}）；${filters}`,
      ...ctx.meta,
    })
    throw error
  }

  const content = renderCsv(CONTENT_COLUMNS, rows.map(contentRow))
  await writeAudit(ctx.db, ctx.logger, {
    actor: ctx.actor,
    action: 'com.selfcommand.admin.content.export',
    targetType: 'content',
    target: '内容检索',
    result: 'success',
    detail: truncated
      ? `导出内容检索结果 ${rows.length} 行（已达到 ${CONTENT_EXPORT_MAX_ROWS} 行上限并截断，请缩小筛选范围）；${filters}`
      : `导出内容检索结果 ${rows.length} 行；${filters}`,
    ...ctx.meta,
  })

  return {
    filename: `content-${stamp()}.csv`,
    contentType: CSV_CONTENT_TYPE,
    content,
    rows: rows.length,
    truncated,
    limit: CONTENT_EXPORT_MAX_ROWS,
  }
}

export async function exportAnalytics(
  deps: { ozone: XrpcClient; logger: Logger },
  ctx: ExportContext,
  params: { days: number; queueId?: number },
): Promise<AnalyticsExportResult> {
  const days = Math.min(90, Math.max(1, Math.trunc(params.days)))
  limitExport(`export:analytics:${ctx.actor}`, ANALYTICS_EXPORT_RATE)
  const scope = params.queueId === undefined ? '' : `；举报队列 ${params.queueId}`

  let analytics: Awaited<ReturnType<typeof moderationAnalytics>>
  try {
    analytics = await moderationAnalytics(deps, { days, ...(params.queueId !== undefined ? { queueId: params.queueId } : {}) })
  } catch (error) {
    await writeAudit(ctx.db, ctx.logger, {
      actor: ctx.actor,
      action: 'com.selfcommand.admin.analytics.export',
      targetType: 'analytics',
      target: '审核统计',
      result: 'error',
      detail: `导出审核统计失败（错误码：${auditErrorCode(error)}）；最近 ${days} 天${scope}`,
      ...ctx.meta,
    })
    throw error
  }

  const content = renderCsv(
    ANALYTICS_COLUMNS,
    analytics.days.map((day) => [
      day.day,
      String(day.inboundCount),
      String(day.pendingCount),
      String(day.closedCount),
      String(day.escalatedCount),
      String(day.actionedCount),
      String(day.acknowledgedCount),
    ]),
  )
  await writeAudit(ctx.db, ctx.logger, {
    actor: ctx.actor,
    action: 'com.selfcommand.admin.analytics.export',
    targetType: 'analytics',
    target: '审核统计',
    result: 'success',
    detail: `导出审核统计 ${analytics.days.length} 天；最近 ${days} 天${scope}`,
    ...ctx.meta,
  })

  return {
    filename: `moderation-analytics-${stamp()}.csv`,
    contentType: CSV_CONTENT_TYPE,
    content,
    rows: analytics.days.length,
  }
}
