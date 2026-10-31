type Metrics = {
  requestsTotal: number
  xrpcRequestsTotal: number
  auditFailuresTotal: number
  statusClasses: Record<string, number>
  upstream: Record<string, UpstreamCounters>
}

type UpstreamCounters = {
  requests: number
  failures: number
  buckets: number[]
  sumSeconds: number
}

const UPSTREAM_BUCKETS = [0.01, 0.05, 0.1, 0.5, 1, 5]

export const metrics: Metrics = {
  requestsTotal: 0,
  xrpcRequestsTotal: 0,
  auditFailuresTotal: 0,
  statusClasses: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 },
  upstream: {},
}

export function recordAuditFailure(): void {
  metrics.auditFailuresTotal += 1
}

export function recordUpstream(service: string, durationMs: number, ok: boolean): void {
  const current =
    metrics.upstream[service] ??
    (metrics.upstream[service] = {
      requests: 0,
      failures: 0,
      buckets: UPSTREAM_BUCKETS.map(() => 0),
      sumSeconds: 0,
    })
  const seconds = durationMs / 1000
  current.requests += 1
  if (!ok) current.failures += 1
  current.sumSeconds += seconds
  for (let index = 0; index < UPSTREAM_BUCKETS.length; index += 1) {
    if (seconds <= UPSTREAM_BUCKETS[index]!) current.buckets[index]! += 1
  }
}

export function resetUpstreamMetrics(): void {
  metrics.upstream = {}
}

export function recordRequest(status: number, xrpc: boolean): void {
  metrics.requestsTotal += 1
  if (xrpc) metrics.xrpcRequestsTotal += 1
  const bucket = `${Math.trunc(status / 100)}xx`
  const current = metrics.statusClasses[bucket]
  if (current !== undefined) metrics.statusClasses[bucket] = current + 1
}

export type MetricsSnapshot = {
  startedAt: number
  version: string
  indexerConnected: boolean
  indexerPaused: boolean
  indexerEnabled: boolean
}

export function renderMetrics(snapshot: MetricsSnapshot): string {
  const lines: string[] = []
  const counter = (name: string, help: string, value: number, extra = '') => {
    lines.push(`# HELP ${name} ${help}`)
    lines.push(`# TYPE ${name} counter`)
    lines.push(`${name}${extra} ${value}`)
  }
  const gauge = (name: string, help: string, value: number) => {
    lines.push(`# HELP ${name} ${help}`)
    lines.push(`# TYPE ${name} gauge`)
    lines.push(`${name} ${value}`)
  }

  gauge(
    'admin_api_uptime_seconds',
    'Seconds since the admin API process started.',
    Math.floor((Date.now() - snapshot.startedAt) / 1000),
  )
  lines.push('# HELP admin_api_info Build information.')
  lines.push('# TYPE admin_api_info gauge')
  lines.push(`admin_api_info{version="${snapshot.version}"} 1`)
  counter('admin_api_requests_total', 'Total HTTP requests handled.', metrics.requestsTotal)
  counter(
    'admin_api_xrpc_requests_total',
    'Total XRPC requests handled.',
    metrics.xrpcRequestsTotal,
  )
  counter(
    'admin_api_audit_failures_total',
    'Audit writes that failed and were logged instead of raised.',
    metrics.auditFailuresTotal,
  )
  for (const [bucket, value] of Object.entries(metrics.statusClasses)) {
    counter(
      'admin_api_responses_total',
      'HTTP responses by status class.',
      value,
      `{class="${bucket}"}`,
    )
  }
  gauge('admin_api_indexer_enabled', 'Whether the account indexer is enabled.', snapshot.indexerEnabled ? 1 : 0)
  gauge('admin_api_indexer_connected', 'Whether the indexer is connected to the firehose.', snapshot.indexerConnected ? 1 : 0)
  gauge('admin_api_indexer_paused', 'Whether the indexer is paused by an administrator.', snapshot.indexerPaused ? 1 : 0)
  for (const [service, counters] of Object.entries(metrics.upstream)) {
    counter(
      'admin_api_upstream_requests_total',
      'Upstream XRPC requests by service.',
      counters.requests,
      `{service="${service}"}`,
    )
    counter(
      'admin_api_upstream_failures_total',
      'Failed upstream XRPC requests by service.',
      counters.failures,
      `{service="${service}"}`,
    )
    lines.push('# HELP admin_api_upstream_duration_seconds Upstream request duration.')
    lines.push('# TYPE admin_api_upstream_duration_seconds histogram')
    for (let index = 0; index < UPSTREAM_BUCKETS.length; index += 1) {
      lines.push(
        `admin_api_upstream_duration_seconds_bucket{service="${service}",le="${UPSTREAM_BUCKETS[index]}"} ${counters.buckets[index]}`,
      )
    }
    lines.push(
      `admin_api_upstream_duration_seconds_bucket{service="${service}",le="+Inf"} ${counters.requests}`,
    )
    lines.push(
      `admin_api_upstream_duration_seconds_sum{service="${service}"} ${counters.sumSeconds}`,
    )
    lines.push(
      `admin_api_upstream_duration_seconds_count{service="${service}"} ${counters.requests}`,
    )
  }
  return `${lines.join('\n')}\n`
}
