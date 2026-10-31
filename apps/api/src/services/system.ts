import { com } from '@admin/lexicons'
import type { Kysely } from 'kysely'
import type { Config } from '../config.js'
import { pingDb } from '../db/index.js'
import { migrationStatus } from '../db/migrations.js'
import type { Database } from '../db/types.js'
import type { DirectoryIndexer } from '../directory/indexer.js'
import { silentLogger, type Logger } from '../logger.js'
import { UpstreamFailure, type UpstreamHealth, type XrpcClient } from '../upstream/client.js'
import { toIndexerStatus } from './accounts.js'
import { getLabelerConfig } from './policy.js'

export type SystemStatusResult = com.selfcommand.admin.system.status.$OutputBody

export type SystemStatusDeps = {
  config: Config
  db: Kysely<Database>
  indexer: DirectoryIndexer
  startedAt: number
  ozone: XrpcClient
  appview: XrpcClient
  logger?: Logger
}

export type PdsHealth = {
  status: 'ok' | 'degraded' | 'unavailable'
  latencyMs?: number
  checkedAt: string
  detail?: string
}

const PDS_PROBE_TIMEOUT_MS = 1500
const PDS_PROBE_CACHE_MS = 5000

let pdsProbeCache: { url: string; at: number; health: PdsHealth } | undefined
let pdsProbeInFlight: { url: string; promise: Promise<PdsHealth> } | undefined

export async function probePds(
  config: Pick<Config, 'pdsUrl' | 'pdsTimeoutMs'>,
  timeoutMs = PDS_PROBE_TIMEOUT_MS,
): Promise<PdsHealth> {
  const cached = pdsProbeCache
  if (cached && cached.url === config.pdsUrl && Date.now() - cached.at < PDS_PROBE_CACHE_MS) {
    return cached.health
  }
  if (pdsProbeInFlight?.url === config.pdsUrl) return pdsProbeInFlight.promise

  const promise = runProbe(config, timeoutMs)
    .then((health) => {
      pdsProbeCache = { url: config.pdsUrl, at: Date.now(), health }
      return health
    })
    .finally(() => {
      if (pdsProbeInFlight?.promise === promise) pdsProbeInFlight = undefined
    })
  pdsProbeInFlight = { url: config.pdsUrl, promise }
  return promise
}

async function runProbe(
  config: Pick<Config, 'pdsUrl' | 'pdsTimeoutMs'>,
  timeoutMs: number,
): Promise<PdsHealth> {
  const checkedAt = new Date().toISOString()
  const started = Date.now()
  try {
    const response = await fetch(new URL('/xrpc/_health', config.pdsUrl), {
      signal: AbortSignal.timeout(Math.min(config.pdsTimeoutMs, timeoutMs)),
      headers: { accept: 'application/json' },
    })
    const latencyMs = Date.now() - started
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      return {
        status: 'degraded',
        latencyMs,
        checkedAt,
        detail: '账号服务健康检查未通过',
      }
    }
    await response.body?.cancel().catch(() => {})
    return { status: 'ok', latencyMs, checkedAt }
  } catch {
    return { status: 'unavailable', checkedAt, detail: '无法连接账号服务' }
  }
}

export function resetPdsProbeCache(): void {
  pdsProbeCache = undefined
  pdsProbeInFlight = undefined
}

const SERVICE_PROBE_CACHE_MS = 5000
const serviceProbeCache = new Map<string, { at: number; health: PdsHealth }>()
const serviceProbeInFlight = new Map<string, Promise<PdsHealth>>()

export async function probeServiceHealth(
  name: string,
  url: string,
  timeoutMs = PDS_PROBE_TIMEOUT_MS,
): Promise<PdsHealth> {
  const cached = serviceProbeCache.get(url)
  if (cached && Date.now() - cached.at < SERVICE_PROBE_CACHE_MS) return cached.health
  const inFlight = serviceProbeInFlight.get(url)
  if (inFlight) return inFlight

  const promise = runServiceProbe(name, url, timeoutMs)
    .then((health) => {
      serviceProbeCache.set(url, { at: Date.now(), health })
      return health
    })
    .finally(() => {
      if (serviceProbeInFlight.get(url) === promise) serviceProbeInFlight.delete(url)
    })
  serviceProbeInFlight.set(url, promise)
  return promise
}

async function runServiceProbe(
  name: string,
  url: string,
  timeoutMs: number,
): Promise<PdsHealth> {
  const checkedAt = new Date().toISOString()
  const started = Date.now()
  try {
    const response = await fetch(new URL('/xrpc/_health', url), {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json' },
    })
    const latencyMs = Date.now() - started
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      return {
        status: 'degraded',
        latencyMs,
        checkedAt,
        detail: `${name}健康检查未通过`,
      }
    }
    await response.body?.cancel().catch(() => {})
    return { status: 'ok', latencyMs, checkedAt }
  } catch {
    return { status: 'unavailable', checkedAt, detail: `无法连接${name}` }
  }
}

export function resetServiceProbeCache(): void {
  serviceProbeCache.clear()
  serviceProbeInFlight.clear()
}


const DAEMON_CACHE_MS = 5000
const DAEMON_LAG_WARNING_SECONDS = 300

export type OzoneDaemonHealth = {
  status: 'ok' | 'degraded' | 'unavailable'
  latencyMs?: number
  detail?: string
  lastEventAt?: string
  lastReportAt?: string
  lagSeconds?: number
}

let daemonCache: { key: string; at: number; health: OzoneDaemonHealth } | undefined
let daemonInFlight: { key: string; promise: Promise<OzoneDaemonHealth> } | undefined

export async function probeOzoneDaemon(ozone: XrpcClient): Promise<OzoneDaemonHealth> {
  const key = `${ozone.name}:${ozone.configured}`
  if (daemonCache && daemonCache.key === key && Date.now() - daemonCache.at < DAEMON_CACHE_MS) {
    return daemonCache.health
  }
  if (daemonInFlight?.key === key) return daemonInFlight.promise

  const promise = runDaemonProbe(ozone)
    .then((health) => {
      daemonCache = { key, at: Date.now(), health }
      return health
    })
    .finally(() => {
      if (daemonInFlight?.promise === promise) daemonInFlight = undefined
    })
  daemonInFlight = { key, promise }
  return promise
}

async function runDaemonProbe(ozone: XrpcClient): Promise<OzoneDaemonHealth> {
  if (!ozone.configured) {
    return { status: 'unavailable', detail: '未配置管理员凭据' }
  }
  const started = Date.now()
  let latestEventAt: string | undefined
  try {
    const result = await ozone.call<{ events?: Array<{ createdAt?: string }> }>(
      'tools.ozone.moderation.queryEvents',
      {
        params: {
          types: ['tools.ozone.moderation.defs#modEventReport'],
          sortDirection: 'desc',
          limit: 1,
        },
      },
    )
    latestEventAt = result.events?.[0]?.createdAt
    if (!latestEventAt) {
      return {
        status: 'ok',
        latencyMs: Date.now() - started,
        detail: '暂无举报事件',
      }
    }

    const latest = await ozone.call<{ report?: { createdAt?: string } }>(
      'tools.ozone.report.getLatestReport',
    )
    const lastReportAt = latest.report?.createdAt
    if (!lastReportAt) {
      return {
        status: 'degraded',
        latencyMs: Date.now() - started,
        lastEventAt: latestEventAt,
        detail: '举报事件尚未进入举报队列',
      }
    }

    const lagSeconds = Math.max(
      0,
      Math.round((Date.parse(latestEventAt) - Date.parse(lastReportAt)) / 1000),
    )
    if (!Number.isFinite(lagSeconds)) {
      return {
        status: 'degraded',
        latencyMs: Date.now() - started,
        lastEventAt: latestEventAt,
        lastReportAt,
        detail: '无法计算举报路由延迟',
      }
    }
    if (lagSeconds > DAEMON_LAG_WARNING_SECONDS) {
      return {
        status: 'degraded',
        latencyMs: Date.now() - started,
        lastEventAt: latestEventAt,
        lastReportAt,
        lagSeconds,
        detail: `举报路由已滞后 ${Math.round(lagSeconds / 60)} 分钟`,
      }
    }
    return {
      status: 'ok',
      latencyMs: Date.now() - started,
      lastEventAt: latestEventAt,
      lastReportAt,
      lagSeconds,
    }
  } catch (error) {
    if (error instanceof UpstreamFailure && error.kind === 'notfound') {
      if (latestEventAt) {
        return {
          status: 'degraded',
          latencyMs: Date.now() - started,
          lastEventAt: latestEventAt,
          detail: '举报事件尚未进入举报队列',
        }
      }
      return { status: 'ok', latencyMs: Date.now() - started, detail: '暂无举报事件' }
    }
    return {
      status: 'unavailable',
      latencyMs: Date.now() - started,
      detail: '无法读取举报路由状态',
    }
  }
}

export function resetOzoneDaemonProbeCache(): void {
  daemonCache = undefined
  daemonInFlight = undefined
}

const OZONE_PROBE_NSID = 'tools.ozone.report.getLiveStats'
const OZONE_PROBE_CACHE_MS = 5000

let ozoneProbeCache: { key: string; at: number; health: UpstreamHealth } | undefined
let ozoneProbeInFlight: { key: string; promise: Promise<UpstreamHealth> } | undefined

export async function probeOzone(ozone: XrpcClient): Promise<UpstreamHealth> {
  const key = `${ozone.name}:${ozone.configured}`
  const cached = ozoneProbeCache
  if (cached && cached.key === key && Date.now() - cached.at < OZONE_PROBE_CACHE_MS) {
    return cached.health
  }
  if (ozoneProbeInFlight?.key === key) return ozoneProbeInFlight.promise

  const promise = ozone
    .probe(OZONE_PROBE_NSID)
    .then((health) => {
      ozoneProbeCache = { key, at: Date.now(), health }
      return health
    })
    .finally(() => {
      if (ozoneProbeInFlight?.promise === promise) ozoneProbeInFlight = undefined
    })
  ozoneProbeInFlight = { key, promise }
  return promise
}

export function resetOzoneProbeCache(): void {
  ozoneProbeCache = undefined
  ozoneProbeInFlight = undefined
}

const LABELER_PROBE_CACHE_MS = 5000

export type LabelerHealth = {
  status: 'ok' | 'unavailable' | 'disabled'
  detail?: string
  checkedAt: string
}

type LabelerProbeDeps = {
  ozone: XrpcClient
  appview?: XrpcClient
  logger?: Logger
}

let labelerProbeCache: { key: string; at: number; health: LabelerHealth } | undefined
let labelerProbeInFlight: { key: string; promise: Promise<LabelerHealth> } | undefined

export async function probeLabeler(deps: LabelerProbeDeps): Promise<LabelerHealth> {
  const key = `${deps.ozone.name}:${deps.ozone.configured}:${deps.appview?.name ?? ''}`
  const cached = labelerProbeCache
  if (cached && cached.key === key && Date.now() - cached.at < LABELER_PROBE_CACHE_MS) {
    return cached.health
  }
  if (labelerProbeInFlight?.key === key) return labelerProbeInFlight.promise

  const promise = runLabelerProbe(deps)
    .then((health) => {
      labelerProbeCache = { key, at: Date.now(), health }
      return health
    })
    .finally(() => {
      if (labelerProbeInFlight?.promise === promise) labelerProbeInFlight = undefined
    })
  labelerProbeInFlight = { key, promise }
  return promise
}

async function runLabelerProbe(deps: LabelerProbeDeps): Promise<LabelerHealth> {
  const checkedAt = new Date().toISOString()
  if (!deps.ozone.configured) {
    return { status: 'disabled', detail: '未配置审核服务凭据', checkedAt }
  }
  if (!deps.appview) {
    return {
      status: 'unavailable',
      detail: '暂时无法读取标签器配置，请稍后重试。',
      checkedAt,
    }
  }
  try {
    const { labeler } = await getLabelerConfig({
      ozone: deps.ozone,
      appview: deps.appview,
      logger: deps.logger ?? silentLogger,
    })
    if (!labeler.available) {
      return {
        status: 'unavailable',
        detail: labeler.reason ?? '暂时无法读取标签器配置，请稍后重试。',
        checkedAt,
      }
    }
    return {
      status: 'ok',
      detail: labeler.handle ? `标签服务 ${labeler.handle}` : '标签服务可用',
      checkedAt,
    }
  } catch {
    return {
      status: 'unavailable',
      detail: '暂时无法读取标签器配置，请稍后重试。',
      checkedAt,
    }
  }
}

export function resetLabelerProbeCache(): void {
  labelerProbeCache = undefined
  labelerProbeInFlight = undefined
}

export async function getSystemStatus(deps: SystemStatusDeps): Promise<SystemStatusResult> {
  const [database, pds, ozoneHealth, appview, daemon, labeler] = await Promise.all([
    pingDb(deps.db, deps.config.readyDbTimeoutMs),
    probePds(deps.config),
    probeOzone(deps.ozone),
    probeServiceHealth('内容服务', deps.config.appviewUrl),
    probeOzoneDaemon(deps.ozone),
    probeLabeler({ ozone: deps.ozone, appview: deps.appview, logger: deps.logger }),
  ])
  const migrations = await migrationStatus(deps.db).catch(() => ({
    executed: [],
    pending: ['migration status unavailable'],
  }))
  const snapshot = deps.indexer.snapshot()

  return {
    version: deps.config.version,
    ...(deps.config.commit ? { commit: deps.config.commit } : {}),
    startedAt: new Date(deps.startedAt).toISOString() as SystemStatusResult['startedAt'],
    uptimeSeconds: Math.floor((Date.now() - deps.startedAt) / 1000),
    database: {
      name: '业务数据库',
      status: database.ok ? 'ok' : 'unavailable',
      ...(database.latencyMs !== undefined ? { latencyMs: database.latencyMs } : {}),
      checkedAt: new Date().toISOString() as never,
      ...(database.ok ? {} : { detail: '数据库连接失败' }),
    },
    migrations,
    indexer: toIndexerStatus(snapshot),
    pds: {
      name: '账号服务',
      status: pds.status,
      ...(pds.latencyMs !== undefined ? { latencyMs: pds.latencyMs } : {}),
      checkedAt: pds.checkedAt as never,
      ...(pds.detail ? { detail: pds.detail } : {}),
    },
    ozone: {
      name: '审核服务',
      status: ozoneHealth.status === 'ok' ? 'ok' : 'unavailable',
      ...(ozoneHealth.latencyMs !== undefined ? { latencyMs: ozoneHealth.latencyMs } : {}),
      checkedAt: new Date().toISOString() as never,
      ...(ozoneHealth.detail ? { detail: ozoneHealth.detail } : {}),
    },
    appview: {
      name: '内容服务',
      status: appview.status,
      ...(appview.latencyMs !== undefined ? { latencyMs: appview.latencyMs } : {}),
      checkedAt: appview.checkedAt as never,
      ...(appview.detail ? { detail: appview.detail } : {}),
    },
    ozoneDaemon: {
      name: '举报路由',
      status: daemon.status === 'degraded' ? 'degraded' : daemon.status === 'ok' ? 'ok' : 'unavailable',
      ...(daemon.latencyMs !== undefined ? { latencyMs: daemon.latencyMs } : {}),
      checkedAt: new Date().toISOString() as never,
      ...(daemon.detail
        ? { detail: daemon.detail }
        : daemon.lagSeconds !== undefined
          ? { detail: `最近举报进入队列延迟 ${daemon.lagSeconds} 秒` }
          : {}),
    },
    externalServices: [
      {
        key: 'image-search',
        name: '图片检索',
        status: deps.config.imageSearchUrl ? 'unknown' : 'disabled',
        ...(deps.config.imageSearchUrl
          ? { detail: '已配置地址，未执行连通性检查' }
          : { detail: '未配置图片检索服务地址' }),
        checkedAt: new Date().toISOString() as never,
      },
      {
        key: 'chat',
        name: '聊天审核',
        status: deps.config.chatModerationEnabled ? 'unknown' : 'disabled',
        ...(deps.config.chatModerationEnabled
          ? { detail: '已启用开关，需聊天服务部署后可用' }
          : { detail: '未部署聊天服务' }),
        checkedAt: new Date().toISOString() as never,
      },
      {
        key: 'email',
        name: '邮件通知',
        status: deps.config.pdsAdminPassword ? 'unknown' : 'disabled',
        ...(deps.config.pdsAdminPassword
          ? { detail: '发送能力取决于账号服务的邮件配置' }
          : { detail: '未配置账号服务管理凭据' }),
        checkedAt: new Date().toISOString() as never,
      },
      {
        key: 'labeler',
        name: '标签服务',
        status: labeler.status,
        ...(labeler.detail ? { detail: labeler.detail } : {}),
        checkedAt: labeler.checkedAt as never,
      },
    ],
  }
}
