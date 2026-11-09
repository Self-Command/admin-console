import { describe, expect, it } from 'vitest'
import { silentLogger } from '../src/logger.js'
import {
  getContent,
  normalizeImageResult,
  normalizePostView,
  searchContent,
  searchImages,
} from '../src/services/content.js'
import { createFakeAppview, createFakeOzone, createFakeUpstream } from './helpers/fake-upstream.js'

const POST = {
  uri: 'at://did:plc:author/app.bsky.feed.post/3kabc',
  cid: 'bafyreipost',
  author: { did: 'did:plc:author', handle: 'author.test' },
  record: { text: '社区内容' },
  indexedAt: '2026-10-29T01:00:00.000Z',
  likeCount: 8,
}

function deps(overrides: { appview?: ReturnType<typeof createFakeAppview>; ozone?: ReturnType<typeof createFakeOzone> } = {}) {
  return {
    appview: overrides.appview ?? createFakeAppview(),
    ozone: overrides.ozone ?? createFakeOzone(),
    logger: silentLogger,
  }
}

describe('post view normalization', () => {
  it('maps a post and its moderation status', () => {
    expect(
      normalizePostView(POST, {
        moderation: { subjectStatus: { reviewState: 'reviewed', takendown: true } },
        labels: [{ val: 'spam' }],
      }),
    ).toEqual({
      uri: POST.uri,
      cid: 'bafyreipost',
      author: 'did:plc:author',
      authorHandle: 'author.test',
      text: '社区内容',
      collection: 'app.bsky.feed.post',
      indexedAt: '2026-10-29T01:00:00.000Z',
      hidden: true,
      reviewState: 'reviewed',
      labels: ['spam'],
      likeCount: 8,
    })
  })

  it('rejects posts without a uri or author', () => {
    expect(() => normalizePostView({ ...POST, uri: undefined })).toThrow(/无法识别的内容/)
    expect(() => normalizePostView({ ...POST, author: {} })).toThrow(/无法识别的内容/)
  })
})

describe('content search', () => {
  it('requires a keyword before calling the AppView', async () => {
    const appview = createFakeAppview()
    await expect(searchContent(deps({ appview }), { limit: 25 })).rejects.toMatchObject({
      status: 400,
      body: { error: 'InvalidRequest' },
    })
    expect(appview.calls).toHaveLength(0)
  })

  it('returns posts with moderation availability', async () => {
    const appview = createFakeUpstream((nsid) =>
      nsid === 'app.bsky.feed.searchPosts' ? { posts: [POST] } : {},
    )
    const ozone = createFakeUpstream((nsid) =>
      nsid === 'tools.ozone.moderation.getRecords'
        ? {
            records: [
              {
                uri: POST.uri,
                moderation: { subjectStatus: { takendown: true } },
              },
            ],
          }
        : {},
    )

    const result = await searchContent(deps({ appview, ozone }), { q: '社区', limit: 25 })
    expect(result.moderationAvailable).toBe(true)
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toMatchObject({ uri: POST.uri, hidden: true })
  })

  it('reports moderation as unavailable when Ozone has no credential', async () => {
    const appview = createFakeUpstream((nsid) =>
      nsid === 'app.bsky.feed.searchPosts' ? { posts: [POST] } : {},
    )
    const ozone = createFakeUpstream(() => ({}), { configured: false })

    const result = await searchContent(deps({ appview, ozone }), { q: '社区', limit: 25 })
    expect(result.moderationAvailable).toBe(false)
    expect(result.content[0]).toMatchObject({ hidden: false })
    expect(ozone.calls).toHaveLength(0)
  })
})

describe('content detail', () => {
  it('rejects malformed content addresses', async () => {
    await expect(getContent(deps(), 'https://example.com/post')).rejects.toMatchObject({
      status: 400,
      body: { error: 'InvalidRequest' },
    })
  })

  it('returns the record, events and reports for a configured deployment', async () => {
    const ozone = createFakeUpstream((nsid, options) => {
      if (nsid === 'tools.ozone.report.queryReports') {
        if (options?.params?.status === 'closed') return { reports: [] }
        return {
          reports: [
            {
              id: 1,
              status: 'open',
              subject: { type: 'record', subject: POST.uri },
              reportType: 'com.atproto.moderation.defs#reasonSpam',
              reportedBy: 'did:plc:reporter',
              createdAt: '2026-10-29T01:00:00.000Z',
            },
          ],
        }
      }
      if (nsid === 'tools.ozone.moderation.queryEvents') {
        return {
          events: [
            {
              id: 2,
              event: { $type: 'tools.ozone.moderation.defs#modEventComment', comment: '核查' },
              subject: { uri: POST.uri },
              createdBy: 'did:plc:admin',
              createdAt: '2026-10-29T02:00:00.000Z',
            },
          ],
        }
      }
      return { records: [] }
    })

    const appview = createFakeUpstream((nsid) =>
      nsid === 'app.bsky.feed.getPosts' ? { posts: [POST] } : {},
    )
    const result = await getContent(deps({ appview, ozone }), POST.uri)
    expect(result.moderationAvailable).toBe(true)
    expect(result.record).toMatchObject({ uri: POST.uri, author: 'did:plc:author' })
    expect(result.reports).toHaveLength(1)
    expect(result.events).toHaveLength(1)
  })

  it('answers NotFound when neither the AppView nor Ozone knows the record', async () => {
    const appview = createFakeUpstream(() => ({}))
    await expect(getContent(deps({ appview }), POST.uri)).rejects.toMatchObject({
      status: 404,
      body: { error: 'NotFound' },
    })
  })
})

describe('image search', () => {
  it('requires a keyword and a configured service', async () => {
    await expect(searchImages({}, { q: '', limit: 20 })).rejects.toMatchObject({
      status: 400,
    })
    await expect(searchImages({}, { q: '社区', limit: 20 })).rejects.toMatchObject({
      status: 503,
      body: { error: 'NotConfigured' },
    })
  })

  it('filters unsafe image URLs', () => {
    expect(
      normalizeImageResult({
        imageUrl: 'https://img.test/a.png',
        thumbnailUrl: 'https://img.test/a-thumb.png',
        postUri: POST.uri,
        author: 'author.test',
        score: 3,
      }),
    ).toEqual({
      imageUrl: 'https://img.test/a.png',
      thumbnailUrl: 'https://img.test/a-thumb.png',
      postUri: POST.uri,
      author: 'author.test',
      score: 3,
    })
    expect(normalizeImageResult({ imageUrl: 'javascript:alert(1)' })).toBeUndefined()
    expect(normalizeImageResult({})).toBeUndefined()
  })
})
