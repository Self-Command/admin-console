import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getSystemStatus,
  probeLabeler,
  probeOzone,
  probeOzoneDaemon,
  probeServiceHealth,
  resetLabelerProbeCache,
  resetOzoneDaemonProbeCache,
  resetOzoneProbeCache,
  resetServiceProbeCache,
} from '../src/services/system.js'
import {
  UpstreamFailure,
  type UpstreamHealth,
  type XrpcClient,
} from '../src/upstream/client.js'
import {
  createFakeAppview,
  createFakeUpstream,
  type FakeUpstream,
} from './helpers/fake-upstream.js'

function countingClient(health: UpstreamHealth): { client: XrpcClient; probes: string[] } {
  const probes: string[] = []
  return {
    probes,
    client: {
      name: 'Ozone',
      configured: true,
      async call() {
        throw new Error('not used')
      },
      async probe(nsid) {
        probes.push(nsid)
        return health
      },
    },
  }
}

afterEach(() => {
  resetOzoneProbeCache()
  resetOzoneDaemonProbeCache()
  resetServiceProbeCache()
  resetLabelerProbeCache()
  vi.unstubAllGlobals()
})

describe('ozone status probe', () => {
  it('queries the reviewed Ozone endpoint and caches the result briefly', async () => {
    const { client, probes } = countingClient({ status: 'ok', latencyMs: 12 })

    await expect(probeOzone(client)).resolves.toEqual({ status: 'ok', latencyMs: 12 })
    await expect(probeOzone(client)).resolves.toEqual({ status: 'ok', latencyMs: 12 })
    expect(probes).toEqual(['tools.ozone.report.getLiveStats'])

    resetOzoneProbeCache()
    await probeOzone(client)
    expect(probes).toHaveLength(2)
  })

  it('deduplicates concurrent probes', async () => {
    let resolve: ((health: UpstreamHealth) => void) | undefined
    let calls = 0
    const client: XrpcClient = {
      name: 'Ozone',
      configured: true,
      async call() {
        throw new Error('not used')
      },
      probe() {
        calls += 1
        return new Promise<UpstreamHealth>((done) => {
          resolve = done
        })
      },
    }

    const first = probeOzone(client)
    const second = probeOzone(client)
    expect(calls).toBe(1)
    resolve?.({ status: 'ok', latencyMs: 5 })
    await expect(Promise.all([first, second])).resolves.toEqual([
      { status: 'ok', latencyMs: 5 },
      { status: 'ok', latencyMs: 5 },
    ])
  })

  it('reports an unconfigured Ozone as unavailable without probing', async () => {
    const ozone = createFakeUpstream(() => ({}), { configured: false })
    await expect(probeOzone(ozone)).resolves.toEqual({
      status: 'unavailable',
      detail: '未配置管理员凭据',
    })
  })
})

describe('service health probe', () => {
  it('queries the XRPC health endpoint and caches briefly', async () => {
    const fetchMock = vi.fn(async () => new Response('{"version":"1.0.0"}'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(probeServiceHealth('内容服务', 'http://appview.test')).resolves.toMatchObject({
      status: 'ok',
    })
    await probeServiceHealth('内容服务', 'http://appview.test')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url] = fetchMock.mock.calls[0] as unknown as [URL]
    expect(String(url)).toBe('http://appview.test/xrpc/_health')
  })

  it('reports degraded on a failing health check', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })))
    await expect(probeServiceHealth('审核服务', 'http://ozone.test')).resolves.toMatchObject({
      status: 'degraded',
      detail: '审核服务健康检查未通过',
    })
  })

  it('reports unavailable when the service cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connection refused')
      }),
    )
    await expect(probeServiceHealth('内容服务', 'http://appview.test')).resolves.toMatchObject({
      status: 'unavailable',
      detail: '无法连接内容服务',
    })
  })
})

describe('ozone report daemon probe', () => {
  const EVENT_AT = '2026-10-30T08:00:00.000Z'

  function daemonUpstream(reportAt: string | undefined): FakeUpstream {
    return createFakeUpstream((nsid) => {
      if (nsid === 'tools.ozone.moderation.queryEvents') return { events: [{ createdAt: EVENT_AT }] }
      if (nsid === 'tools.ozone.report.getLatestReport') {
        if (!reportAt) throw new UpstreamFailure('notfound', 'not found', 404)
        return { report: { createdAt: reportAt } }
      }
      return {}
    })
  }

  it('reports ok when the latest report is recent and queries the report event type', async () => {
    const ozone = daemonUpstream('2026-10-30T07:59:50.000Z')

    await expect(probeOzoneDaemon(ozone)).resolves.toMatchObject({
      status: 'ok',
      lastEventAt: EVENT_AT,
      lastReportAt: '2026-10-30T07:59:50.000Z',
      lagSeconds: 10,
    })
    expect(ozone.calls[0]?.options).toEqual({
      params: {
        types: ['tools.ozone.moderation.defs#modEventReport'],
        sortDirection: 'desc',
        limit: 1,
      },
    })
  })

  it('reports degraded when routing lags behind report events', async () => {
    const ozone = daemonUpstream('2026-10-30T07:50:00.000Z')

    await expect(probeOzoneDaemon(ozone)).resolves.toMatchObject({
      status: 'degraded',
      lagSeconds: 600,
      detail: '举报路由已滞后 10 分钟',
    })
  })

  it('reports degraded when report events have not reached the queue', async () => {
    const ozone = daemonUpstream(undefined)

    await expect(probeOzoneDaemon(ozone)).resolves.toMatchObject({
      status: 'degraded',
      lastEventAt: EVENT_AT,
      detail: '举报事件尚未进入举报队列',
    })
  })

  it('reports ok when no report events exist', async () => {
    const ozone = createFakeUpstream((nsid) => {
      if (nsid === 'tools.ozone.moderation.queryEvents') return { events: [] }
      throw new Error(`unexpected ${nsid}`)
    })

    await expect(probeOzoneDaemon(ozone)).resolves.toMatchObject({
      status: 'ok',
      detail: '暂无举报事件',
    })
  })

  it('reports unavailable without credentials', async () => {
    const ozone = createFakeUpstream(() => ({}), { configured: false })
    await expect(probeOzoneDaemon(ozone)).resolves.toEqual({
      status: 'unavailable',
      detail: '未配置管理员凭据',
    })
  })

  it('reports unavailable when Ozone cannot be read', async () => {
    const ozone = createFakeUpstream(() => {
      throw new UpstreamFailure('unavailable', 'connection failed')
    })

    await expect(probeOzoneDaemon(ozone)).resolves.toMatchObject({
      status: 'unavailable',
      detail: '无法读取举报路由状态',
    })
  })
})

describe('labeler probe', () => {
  function labelerUpstreams(): { ozone: FakeUpstream; appview: FakeUpstream } {
    return {
      ozone: createFakeUpstream((nsid) =>
        nsid === 'com.atproto.server.describeServer' ? { did: 'did:web:ozone.test' } : {},
      ),
      appview: createFakeAppview(),
    }
  }

  it('does not query upstream when Ozone is not configured', async () => {
    const ozone = createFakeUpstream(() => ({}), { configured: false })
    const appview = createFakeAppview()

    await expect(probeLabeler({ ozone, appview })).resolves.toMatchObject({
      status: 'disabled',
      detail: '未配置审核服务凭据',
    })
    expect(ozone.calls).toHaveLength(0)
    expect(appview.calls).toHaveLength(0)
  })

  it('reports ok with the labeler handle and an ISO check time', async () => {
    const { ozone, appview } = labelerUpstreams()

    const health = await probeLabeler({ ozone, appview })
    expect(health).toMatchObject({ status: 'ok', detail: '标签服务 ozone.e2e.test' })
    expect(Number.isNaN(Date.parse(health.checkedAt))).toBe(false)
    expect(appview.calls.map((call) => call.nsid)).toEqual(['app.bsky.labeler.getServices'])
  })

  it('reports the upstream reason when the labeler cannot be resolved', async () => {
    const ozone = createFakeUpstream(() => {
      throw new Error('describe failed')
    })

    await expect(probeLabeler({ ozone, appview: createFakeAppview() })).resolves.toMatchObject({
      status: 'unavailable',
      detail: '暂时无法读取审核服务信息，请稍后重试。',
    })
  })

  it('probes once within the five second cache window', async () => {
    const { ozone, appview } = labelerUpstreams()

    await probeLabeler({ ozone, appview })
    await probeLabeler({ ozone, appview })
    expect(ozone.calls.filter((call) => call.nsid === 'com.atproto.server.describeServer')).toHaveLength(1)
    expect(appview.calls).toHaveLength(1)

    resetLabelerProbeCache()
    await probeLabeler({ ozone, appview })
    expect(appview.calls).toHaveLength(2)
  })

  it('includes the labeler in the system status external services', async () => {
    const { ozone, appview } = labelerUpstreams()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"version":"1.0.0"}')))

    const status = await getSystemStatus({
      config: {
        version: '0.1.0',
        readyDbTimeoutMs: 50,
        pdsUrl: 'http://pds.test',
        pdsTimeoutMs: 200,
        appviewUrl: 'http://appview.test',
        chatModerationEnabled: false,
      } as never,
      db: {} as never,
      indexer: {
        snapshot: () => ({
          enabled: false,
          initialized: true,
          backfillComplete: true,
          connected: false,
          paused: false,
          pausedBy: null,
          pausedAt: null,
          lastEventAt: null,
          lastIndexedAt: null,
          cursor: null,
        }),
      } as never,
      startedAt: Date.now(),
      ozone,
      appview,
    })

    expect(status.externalServices).toContainEqual(
      expect.objectContaining({
        key: 'labeler',
        name: '标签服务',
        status: 'ok',
        detail: '标签服务 ozone.e2e.test',
      }),
    )
  })
})
