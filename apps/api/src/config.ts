import { isIP } from 'node:net'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type DidConfig = {
  allowedMethods: string[]
  allowHttp: boolean
  allowPrivateHosts: string[]
  fetchTimeoutMs: number
  fetchMaxBytes: number
}

export type IndexerConfig = {
  enabled: boolean
  backfillPageSize: number
  backfillMaxMs: number
  resolveHandles: boolean
  handleConcurrency: number
  flushIntervalMs: number
  flushBatchSize: number
  reconnectMaxSeconds: number
  maxFrameBytes: number
  maxBufferedBytes: number
}

export type Config = {
  host: string
  port: number
  serviceDid: string
  databaseUrl: string
  logLevel: LogLevel
  pdsUrl: string
  pdsTimeoutMs: number
  pdsMaxBytes: number
  pdsAdminPassword?: string
  ozoneUrl: string
  ozoneAdminPassword?: string
  ozoneDid?: string
  ozoneModeratorHandle?: string
  ozoneModeratorPassword?: string
  ozoneTimeoutMs: number
  ozoneMaxBytes: number
  appviewUrl: string
  appviewTimeoutMs: number
  appviewMaxBytes: number
  imageSearchUrl?: string
  imageSearchToken?: string
  chatModerationEnabled: boolean
  plcUrl: string
  did: DidConfig
  bootstrapAdminDid?: string
  readyDbTimeoutMs: number
  corsOrigins: string[]
  version: string
  commit?: string
  metricsToken?: string
  trustProxy: boolean
  allowedIps: string[]
  approvalTtlHours: number
  reportTimezone: string
  indexer: IndexerConfig
}

type Env = Record<string, string | undefined>

class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

function readString(env: Env, name: string, fallback?: string): string {
  const value = env[name]?.trim()
  if (value) return value
  if (fallback !== undefined) return fallback
  throw new ConfigError(`${name} is required`)
}

function readOptionalString(env: Env, name: string): string | undefined {
  const value = env[name]?.trim()
  return value || undefined
}

function readInt(
  env: Env,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name]?.trim()
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${name} must be an integer between ${min} and ${max}`)
  }
  return value
}

function readBool(env: Env, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase()
  if (!raw) return fallback
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true
  if (['0', 'false', 'no', 'off'].includes(raw)) return false
  throw new ConfigError(`${name} must be a boolean`)
}

function readList(env: Env, name: string, fallback: string[]): string[] {
  const raw = env[name]?.trim()
  if (!raw) return fallback
  return raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

function readIpList(env: Env, name: string): string[] {
  const raw = env[name]?.trim()
  if (!raw) return []
  const entries = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  if (entries.length > 100) {
    throw new ConfigError(`${name} must list at most 100 entries`)
  }
  for (const entry of entries) {
    const [address, prefix, extra] = entry.split('/')
    if (extra !== undefined || !address || isIP(address) === 0) {
      throw new ConfigError(`${name} contains an invalid address: ${entry}`)
    }
    if (prefix !== undefined) {
      const bits = Number(prefix)
      const max = isIP(address) === 4 ? 32 : 128
      if (!Number.isInteger(bits) || bits < 0 || bits > max) {
        throw new ConfigError(`${name} contains an invalid prefix: ${entry}`)
      }
    }
  }
  return entries
}

function readTimezone(env: Env, name: string, fallback: string): string {
  const value = readString(env, name, fallback)
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
  } catch {
    throw new ConfigError(`${name} must be a valid IANA time zone`)
  }
  return value
}

function readUrl(env: Env, name: string, fallback: string): string {
  const raw = readString(env, name, fallback)
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ConfigError(`${name} must be an absolute URL`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ConfigError(`${name} must use http or https`)
  }
  return url.origin
}

function readOptionalUrl(env: Env, name: string): string | undefined {
  const raw = env[name]?.trim()
  if (!raw) return undefined
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ConfigError(`${name} must be an absolute URL`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ConfigError(`${name} must use http or https`)
  }
  return url.href
}

function readServiceDid(env: Env): string {
  const did = readString(env, 'ADMIN_API_SERVICE_DID', 'did:web:localhost%3A2587')
  if (!/^did:[a-z0-9]+:[^\s/]+$/i.test(did)) {
    throw new ConfigError('ADMIN_API_SERVICE_DID must be a DID (did:method:id)')
  }
  return did
}

/**
 * Loads configuration from environment variables. Throws a ConfigError that
 * names the offending variable; never includes values, since some hold secrets.
 */
export function loadConfig(env: Env = process.env): Config {
  const production = env.NODE_ENV === 'production'
  const serviceDid = readServiceDid(env)
  const allowHttp = readBool(env, 'ADMIN_API_DID_ALLOW_HTTP', !production)
  const didMethods = readList(env, 'ADMIN_API_DID_METHODS', ['plc', 'web'])
  if (didMethods.length === 0) {
    throw new ConfigError('ADMIN_API_DID_METHODS must list at least one method')
  }

  const logLevel = readString(env, 'ADMIN_API_LOG_LEVEL', 'info')
  if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) {
    throw new ConfigError('ADMIN_API_LOG_LEVEL must be debug, info, warn or error')
  }

  const ozoneDid = readOptionalString(env, 'ADMIN_API_OZONE_DID')
  const ozoneModeratorHandle = readOptionalString(
    env,
    'ADMIN_API_OZONE_MODERATOR_HANDLE',
  )
  const ozoneModeratorPassword = readOptionalString(
    env,
    'ADMIN_API_OZONE_MODERATOR_PASSWORD',
  )
  if (ozoneDid && !/^did:[a-z0-9]+:[^\s/]+$/i.test(ozoneDid)) {
    throw new ConfigError('ADMIN_API_OZONE_DID must be a DID (did:method:id)')
  }
  const moderatorValues = [
    ozoneDid,
    ozoneModeratorHandle,
    ozoneModeratorPassword,
  ]
  if (
    moderatorValues.some((value) => value !== undefined) &&
    !moderatorValues.every((value) => value !== undefined)
  ) {
    throw new ConfigError(
      'ADMIN_API_OZONE_DID, ADMIN_API_OZONE_MODERATOR_HANDLE and ADMIN_API_OZONE_MODERATOR_PASSWORD must be set together',
    )
  }

  return {
    host: readString(env, 'ADMIN_API_HOST', '0.0.0.0'),
    port: readInt(env, 'ADMIN_API_PORT', 2587, 1, 65535),
    serviceDid,
    databaseUrl: readString(env, 'ADMIN_API_DATABASE_URL'),
    logLevel: logLevel as LogLevel,
    pdsUrl: readUrl(env, 'ADMIN_API_PDS_URL', 'http://localhost:2583'),
    pdsTimeoutMs: readInt(env, 'ADMIN_API_PDS_TIMEOUT_MS', 10000, 500, 120000),
    pdsMaxBytes: readInt(
      env,
      'ADMIN_API_PDS_MAX_BYTES',
      8 * 1024 * 1024,
      1024,
      64 * 1024 * 1024,
    ),
    pdsAdminPassword: readOptionalString(env, 'ADMIN_API_PDS_ADMIN_PASSWORD'),
    ozoneUrl: readUrl(env, 'ADMIN_API_OZONE_URL', 'http://localhost:2586'),
    ozoneAdminPassword: readOptionalString(env, 'ADMIN_API_OZONE_ADMIN_PASSWORD'),
    ozoneDid,
    ozoneModeratorHandle,
    ozoneModeratorPassword,
    ozoneTimeoutMs: readInt(env, 'ADMIN_API_OZONE_TIMEOUT_MS', 10000, 500, 60000),
    ozoneMaxBytes: readInt(
      env,
      'ADMIN_API_OZONE_MAX_BYTES',
      8 * 1024 * 1024,
      64 * 1024,
      32 * 1024 * 1024,
    ),
    appviewUrl: readUrl(env, 'ADMIN_API_APPVIEW_URL', 'http://localhost:2584'),
    appviewTimeoutMs: readInt(env, 'ADMIN_API_APPVIEW_TIMEOUT_MS', 8000, 500, 30000),
    appviewMaxBytes: readInt(
      env,
      'ADMIN_API_APPVIEW_MAX_BYTES',
      8 * 1024 * 1024,
      64 * 1024,
      32 * 1024 * 1024,
    ),
    imageSearchUrl: readOptionalUrl(env, 'ADMIN_API_IMAGE_SEARCH_URL'),
    imageSearchToken: readOptionalString(env, 'ADMIN_API_IMAGE_SEARCH_TOKEN'),
    chatModerationEnabled: readBool(env, 'ADMIN_API_CHAT_MODERATION_ENABLED', false),
    plcUrl: readUrl(env, 'ADMIN_API_PLC_URL', 'http://localhost:2582'),
    did: {
      allowedMethods: didMethods,
      allowHttp,
      allowPrivateHosts: readList(env, 'ADMIN_API_DID_PRIVATE_HOSTS', [
        'localhost',
        '127.0.0.1',
        '[::1]',
        '::1',
      ]),
      fetchTimeoutMs: readInt(env, 'ADMIN_API_DID_FETCH_TIMEOUT_MS', 5000, 500, 30000),
      fetchMaxBytes: readInt(
        env,
        'ADMIN_API_DID_FETCH_MAX_BYTES',
        256 * 1024,
        1024,
        4 * 1024 * 1024,
      ),
    },
    bootstrapAdminDid: readOptionalString(env, 'ADMIN_API_BOOTSTRAP_ADMIN_DID'),
    readyDbTimeoutMs: readInt(env, 'ADMIN_API_READY_DB_TIMEOUT_MS', 2000, 100, 30000),
    corsOrigins: readList(env, 'ADMIN_API_CORS_ORIGINS', []),
    version: readString(env, 'ADMIN_API_VERSION', '0.1.0'),
    commit: readOptionalString(env, 'ADMIN_API_COMMIT'),
    metricsToken: readOptionalString(env, 'ADMIN_API_METRICS_TOKEN'),
    trustProxy: readBool(env, 'ADMIN_API_TRUST_PROXY', false),
    allowedIps: readIpList(env, 'ADMIN_API_ALLOWED_IPS'),
    approvalTtlHours: readInt(env, 'ADMIN_API_APPROVAL_TTL_HOURS', 24, 1, 168),
    reportTimezone: readTimezone(env, 'ADMIN_API_REPORT_TIMEZONE', 'Asia/Shanghai'),
    indexer: {
      enabled: readBool(env, 'ADMIN_API_INDEXER_ENABLED', true),
      backfillPageSize: readInt(env, 'ADMIN_API_INDEXER_BACKFILL_PAGE_SIZE', 1000, 1, 1000),
      backfillMaxMs: readInt(
        env,
        'ADMIN_API_INDEXER_BACKFILL_MAX_MS',
        10 * 60 * 1000,
        1000,
        24 * 60 * 60 * 1000,
      ),
      resolveHandles: readBool(env, 'ADMIN_API_INDEXER_RESOLVE_HANDLES', true),
      handleConcurrency: readInt(env, 'ADMIN_API_INDEXER_HANDLE_CONCURRENCY', 6, 1, 32),
      flushIntervalMs: readInt(env, 'ADMIN_API_INDEXER_FLUSH_INTERVAL_MS', 500, 50, 10000),
      flushBatchSize: readInt(env, 'ADMIN_API_INDEXER_FLUSH_BATCH_SIZE', 200, 1, 5000),
      reconnectMaxSeconds: readInt(env, 'ADMIN_API_INDEXER_RECONNECT_MAX_SECONDS', 60, 1, 3600),
      maxFrameBytes: readInt(
        env,
        'ADMIN_API_INDEXER_MAX_FRAME_BYTES',
        1024 * 1024,
        1024,
        16 * 1024 * 1024,
      ),
      maxBufferedBytes: readInt(
        env,
        'ADMIN_API_INDEXER_MAX_BUFFERED_BYTES',
        4 * 1024 * 1024,
        1024,
        64 * 1024 * 1024,
      ),
    },
  }
}

export { ConfigError }
