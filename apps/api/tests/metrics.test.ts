import { afterEach, describe, expect, it } from 'vitest'
import { recordUpstream, renderMetrics, resetUpstreamMetrics } from '../src/metrics.js'

const snapshot = {
  startedAt: Date.now(),
  version: '0.0.0-test',
  indexerConnected: true,
  indexerPaused: false,
  indexerEnabled: true,
}

afterEach(() => {
  resetUpstreamMetrics()
})

describe('upstream metrics', () => {
  it('renders per-service counters and duration histogram buckets', () => {
    recordUpstream('Ozone', 500, true)
    recordUpstream('Ozone', 2000, false)

    const text = renderMetrics(snapshot)

    expect(text).toContain('admin_api_upstream_requests_total{service="Ozone"} 2')
    expect(text).toContain('admin_api_upstream_failures_total{service="Ozone"} 1')
    expect(text).toContain('admin_api_upstream_duration_seconds_bucket{service="Ozone",le="0.5"} 1')
    expect(text).toContain('admin_api_upstream_duration_seconds_bucket{service="Ozone",le="1"} 1')
    expect(text).toContain('admin_api_upstream_duration_seconds_bucket{service="Ozone",le="5"} 2')
    expect(text).toContain('admin_api_upstream_duration_seconds_bucket{service="Ozone",le="+Inf"} 2')
    expect(text).toContain('admin_api_upstream_duration_seconds_sum{service="Ozone"} 2.5')
    expect(text).toContain('admin_api_upstream_duration_seconds_count{service="Ozone"} 2')
    expect(text).not.toContain('service="PDS"')
  })

  it('keeps services independent and resets cleanly', () => {
    recordUpstream('PDS', 10, true)
    recordUpstream('Ozone', 20, true)
    expect(renderMetrics(snapshot)).toContain('admin_api_upstream_requests_total{service="PDS"} 1')

    resetUpstreamMetrics()
    const text = renderMetrics(snapshot)
    expect(text).not.toContain('admin_api_upstream_requests_total')
    expect(text).toContain('admin_api_info{version="0.0.0-test"} 1')
  })
})
