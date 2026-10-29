import { describe, expect, it } from 'vitest'
import { INDEXER_STALE_MS, indexerHealth } from '@/lib/accounts'
import type { IndexerStatus } from '@/lib/data/types'

const now = new Date('2026-10-29T08:00:00.000Z').getTime()

function status(overrides: Partial<IndexerStatus> = {}): IndexerStatus {
  return { backfillComplete: true, lastIndexedAt: '2026-10-29T07:59:00.000Z', ...overrides }
}

describe('indexer health', () => {
  it('reports unknown before any snapshot arrives', () => {
    expect(indexerHealth(null, now)).toBe('unknown')
  })

  it('reports backfilling until the initial sync completes', () => {
    expect(indexerHealth(status({ backfillComplete: false }), now)).toBe('backfilling')
  })

  it('treats missing or old timestamps as a stale index', () => {
    expect(indexerHealth(status({ lastIndexedAt: undefined }), now)).toBe('stale')
    expect(indexerHealth(status({ lastIndexedAt: 'not-a-date' }), now)).toBe('stale')
    expect(
      indexerHealth(status({ lastIndexedAt: new Date(now - INDEXER_STALE_MS - 1).toISOString() }), now),
    ).toBe('stale')
  })

  it('reports healthy within the freshness window', () => {
    expect(indexerHealth(status(), now)).toBe('healthy')
  })
})
