import type { Kysely } from 'kysely'
import { describe, expect, it } from 'vitest'
import type { Database } from '../src/db/types.js'
import { silentLogger } from '../src/logger.js'
import {
  CONTENT_EXPORT_MAX_ROWS,
  exportAnalytics,
  exportContent,
  type ExportContext,
} from '../src/services/exports.js'
import type { UpstreamCallOptions } from '../src/upstream/client.js'
import { createFakeUpstream } from './helpers/fake-upstream.js'

const stubDb = {} as Kysely<Database>

function ctx(actor: string): ExportContext {
  return { db: stubDb, logger: silentLogger, actor, meta: {} }
}

function post(index: number, text = '社区内容') {
  return {
    uri: `at://did:plc:author/app.bsky.feed.post/${index}`,
    cid: `bafyrei${index}`,
    author: { did: 'did:plc:author', handle: 'author.test' },
    record: { text },
    indexedAt: '2026-10-29T01:00:00.000Z',
    likeCount: 1,
  }
}

function pagedAppview(total: number, pageSize = 100) {
  return createFakeUpstream((nsid, options?: UpstreamCallOptions) => {
    if (nsid !== 'app.bsky.feed.searchPosts') return {}
    const cursor =
      typeof options?.params?.cursor === 'string' ? Number(options.params.cursor) : 0
    const next = cursor + pageSize
    return {
      posts: Array.from({ length: Math.max(0, Math.min(pageSize, total - cursor)) }, (_, i) =>
        post(cursor + i),
      ),
      ...(next < total ? { cursor: String(next) } : {}),
    }
  })
}

describe('content export', () => {
  it('requires a keyword and never calls the upstream', async () => {
    const appview = pagedAppview(1)
    await expect(exportContent({ appview, logger: silentLogger }, ctx('did:plc:x1'), {})).rejects.toMatchObject({
      status: 400,
      body: { error: 'InvalidRequest' },
    })
    expect(appview.calls).toHaveLength(0)
  })

  it('exports matching posts with a fixed column order and BOM', async () => {
    const appview = pagedAppview(3)
    const result = await exportContent(
      { appview, logger: silentLogger },
      ctx('did:plc:x2'),
      { q: '社区', sort: 'latest' },
    )
    expect(result).toMatchObject({
      contentType: 'text/csv; charset=utf-8',
      rows: 3,
      truncated: false,
      limit: CONTENT_EXPORT_MAX_ROWS,
    })
    expect(result.filename).toMatch(/^content-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.csv$/)
    const lines = result.content.split('\r\n').filter(Boolean)
    expect(lines[0]).toBe(
      '\ufeff内容地址,作者账号名,作者标识,内容摘要,索引时间,可见状态,标签,点赞数,转发数,回复数',
    )
    expect(lines).toHaveLength(4)
    expect(lines[1]).toContain('at://did:plc:author/app.bsky.feed.post/0')
    expect(lines[1]).toContain('author.test')
    expect(lines[1]).toContain('2026-10-29T01:00:00.000Z')
    expect(lines[1]).toContain('可见')
    expect(appview.calls[0]?.options?.params).toMatchObject({
      q: '社区',
      sort: 'latest',
      limit: 100,
    })
  })

  it('stops at the row cap and flags truncation instead of silently cutting', async () => {
    const appview = pagedAppview(CONTENT_EXPORT_MAX_ROWS + 250)
    const result = await exportContent(
      { appview, logger: silentLogger },
      ctx('did:plc:x3'),
      { q: '社区' },
    )
    expect(result.rows).toBe(CONTENT_EXPORT_MAX_ROWS)
    expect(result.truncated).toBe(true)
    expect(result.limit).toBe(CONTENT_EXPORT_MAX_ROWS)
    expect(result.content.split('\r\n').filter(Boolean)).toHaveLength(CONTENT_EXPORT_MAX_ROWS + 1)
    expect(appview.calls).toHaveLength(CONTENT_EXPORT_MAX_ROWS / 100)
  })

  it('does not flag truncation when the upstream ends exactly at the cap', async () => {
    const appview = pagedAppview(CONTENT_EXPORT_MAX_ROWS)
    const result = await exportContent(
      { appview, logger: silentLogger },
      ctx('did:plc:x4'),
      { q: '社区' },
    )
    expect(result.rows).toBe(CONTENT_EXPORT_MAX_ROWS)
    expect(result.truncated).toBe(false)
  })

  it('propagates upstream failures as a service error', async () => {
    const appview = createFakeUpstream(() => {
      throw new Error('upstream down')
    })
    await expect(
      exportContent({ appview, logger: silentLogger }, ctx('did:plc:x5'), { q: '社区' }),
    ).rejects.toMatchObject({
      status: 502,
      body: { error: 'UpstreamUnavailable' },
    })
  })

  it('rate limits repeated exports per administrator', async () => {
    const appview = pagedAppview(0)
    for (let i = 0; i < 5; i += 1) {
      await exportContent({ appview, logger: silentLogger }, ctx('did:plc:x6'), { q: '社区' })
    }
    await expect(
      exportContent({ appview, logger: silentLogger }, ctx('did:plc:x6'), { q: '社区' }),
    ).rejects.toMatchObject({ status: 429, body: { error: 'RateLimited' } })
  })
})

describe('analytics export', () => {
  it('renders daily moderation stats with page-aligned columns', async () => {
    const ozone = createFakeUpstream((nsid) => {
      if (nsid === 'tools.ozone.report.getHistoricalStats') {
        return {
          stats: [
            {
              date: '2026-10-28',
              inboundCount: 3,
              pendingCount: 1,
              closedCount: 2,
              escalatedCount: 0,
              actionedCount: 2,
              acknowledgedCount: 1,
            },
            {
              date: '2026-10-29',
              inboundCount: 5,
              pendingCount: 2,
              closedCount: 3,
              escalatedCount: 1,
              actionedCount: 4,
              acknowledgedCount: 2,
            },
          ],
        }
      }
      return { stats: {} }
    })
    const result = await exportAnalytics(
      { ozone, logger: silentLogger },
      ctx('did:plc:a1'),
      { days: 7 },
    )
    const lines = result.content.split('\r\n').filter(Boolean)
    expect(lines[0]).toBe('\ufeff日期,新增举报,待处理,已结案,升级处理,已处置,已确认')
    expect(lines.slice(1)).toEqual([
      '2026-10-28,3,1,2,0,2,1',
      '2026-10-29,5,2,3,1,4,2',
    ])
    expect(result.rows).toBe(2)
    expect(result.filename).toMatch(/^moderation-analytics-.+\.csv$/)
  })

  it('rate limits analytics exports per administrator', async () => {
    const ozone = createFakeUpstream(() => ({ stats: [] }))
    for (let i = 0; i < 10; i += 1) {
      await exportAnalytics({ ozone, logger: silentLogger }, ctx('did:plc:a2'), { days: 7 })
    }
    await expect(
      exportAnalytics({ ozone, logger: silentLogger }, ctx('did:plc:a2'), { days: 7 }),
    ).rejects.toMatchObject({ status: 429, body: { error: 'RateLimited' } })
  })
})
