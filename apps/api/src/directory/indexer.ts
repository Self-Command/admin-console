import type { IndexerConfig } from '../config.js'
import type { Logger } from '../logger.js'
import type { FirehoseEvent } from './events.js'
import type { PdsClient } from './pds.js'
import type { FirehoseSource } from './source.js'
import {
  FIREHOSE_STREAM,
  type AccountUpsert,
  type DirectoryStore,
} from './store.js'

export type IndexerSnapshot = {
  enabled: boolean
  initialized: boolean
  backfillComplete: boolean
  connected: boolean
  lastEventAt: Date | null
  lastIndexedAt: Date | null
  cursor: number | null
}

export type IndexerDeps = {
  store: DirectoryStore
  pds: PdsClient
  source: FirehoseSource
  logger: Logger
  config: IndexerConfig
}

function laterOf(a: Date | null | undefined, b: Date): Date {
  return a && a.getTime() > b.getTime() ? a : b
}

function mergeOlder(target: AccountUpsert, older: AccountUpsert): void {
  if (target.handle === undefined && older.handle !== undefined) target.handle = older.handle
  if (target.status === undefined && older.status !== undefined) target.status = older.status
  if (target.active === undefined && older.active !== undefined) target.active = older.active
  if (older.lastEventAt) target.lastEventAt = laterOf(target.lastEventAt, older.lastEventAt)
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const current = index++
      const item = items[current]
      if (item === undefined) return
      await worker(item)
    }
  })
  await Promise.all(workers)
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(done, ms)
    timer.unref()
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

export class DirectoryIndexer {
  private readonly store: DirectoryStore
  private readonly pds: PdsClient
  private readonly source: FirehoseSource
  private readonly logger: Logger
  private readonly config: IndexerConfig

  private abort = new AbortController()
  private cursor: number | null = null
  private queuedCursor: number | null = null
  private backfillComplete = false
  private initialized = false
  private connected = false
  private lastEventAt: Date | null = null
  private lastIndexedAt: Date | null = null
  private pending = new Map<string, AccountUpsert>()
  private flushTimer: NodeJS.Timeout | null = null
  private flushing: Promise<void> | null = null
  private running: Promise<void> | null = null

  constructor(deps: IndexerDeps) {
    this.store = deps.store
    this.pds = deps.pds
    this.source = deps.source
    this.logger = deps.logger
    this.config = deps.config
  }

  snapshot(): IndexerSnapshot {
    return {
      enabled: this.config.enabled,
      initialized: this.config.enabled ? this.initialized : true,
      backfillComplete: this.backfillComplete,
      connected: this.connected,
      lastEventAt: this.lastEventAt,
      lastIndexedAt: this.lastIndexedAt,
      cursor: this.cursor,
    }
  }

  start(): Promise<void> {
    if (this.running) return this.running
    this.running = this.runLoop().finally(() => {
      this.running = null
    })
    return this.running
  }

  async stop(): Promise<void> {
    this.abort.abort()
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    await this.flush().catch((error: unknown) => {
      this.logger.warn('indexer flush on shutdown failed', { error })
    })
    await this.running?.catch(() => {})
    this.connected = false
  }

  private async runLoop(): Promise<void> {
    if (!this.config.enabled) return
    const signal = this.abort.signal
    let attempt = 0

    while (!signal.aborted) {
      try {
        await this.runOnce(signal)
        attempt = 0
      } catch (error) {
        if (signal.aborted) return
        this.connected = false
        attempt += 1
        const backoffSeconds = Math.min(2 ** Math.min(attempt, 6), 60)
        this.logger.error('indexer run failed', {
          error,
          retryInSeconds: backoffSeconds,
        })
        await sleep(backoffSeconds * 1000, signal)
        continue
      }

      if (!signal.aborted) {
        await sleep(1000, signal)
      }
    }
  }

  private async runOnce(signal: AbortSignal): Promise<void> {
    const state = await this.store.getCursor(FIREHOSE_STREAM)
    this.cursor = state?.cursor ?? null
    this.backfillComplete = state?.backfillComplete ?? false
    this.initialized = true

    if (!this.backfillComplete) {
      await this.backfill(signal)
    }

    await this.source.run({
      getCursor: () => this.queuedCursor ?? this.cursor,
      signal,
      onConnect: () => {
        this.connected = true
        this.logger.info('firehose connected', { cursor: this.cursor })
      },
      onDisconnect: (error) => {
        if (this.connected) {
          this.connected = false
          this.logger.warn('firehose disconnected', { error })
        }
      },
      onEvent: (event) => this.applyEvent(event),
      onOversizedFrame: () => {
        this.logger.debug('firehose frame skipped', {})
      },
    })
  }

  async backfill(signal: AbortSignal): Promise<void> {
    const startedAt = Date.now()
    let cursor: string | undefined
    let pages = 0
    let repos = 0

    for (;;) {
      if (signal.aborted) return
      if (Date.now() - startedAt > this.config.backfillMaxMs) {
        this.logger.warn('backfill deadline reached', { pages, repos })
        return
      }

      const page = await this.pds.listRepos({
        cursor,
        limit: this.config.backfillPageSize,
      })
      if (signal.aborted) return

      const rows: AccountUpsert[] = page.repos.map((repo) => ({
        did: repo.did,
        status: repo.status,
        active: repo.active,
        lastEventAt: null,
      }))

      if (this.config.resolveHandles && rows.length > 0) {
        await mapWithConcurrency(rows, this.config.handleConcurrency, async (row) => {
          if (signal.aborted) return
          row.handle = await this.pds.resolveHandle(row.did)
        })
      }

      if (rows.length > 0) {
        await this.store.applyBatch({
          rows,
          stream: FIREHOSE_STREAM,
          cursor: null,
          backfillComplete: false,
        })
      }
      repos += rows.length
      pages += 1

      if (!page.cursor || page.cursor === cursor || page.repos.length === 0) break
      cursor = page.cursor
    }

    this.backfillComplete = true
    await this.store.markBackfillComplete(FIREHOSE_STREAM)
    this.logger.info('account directory backfill complete', { pages, repos })
  }

  applyEvent(event: FirehoseEvent): void {
    const lastSeq = this.queuedCursor ?? this.cursor
    if (lastSeq !== null && event.seq <= lastSeq) return

    this.queuedCursor = event.seq
    const existing = this.pending.get(event.did) ?? { did: event.did }
    if (event.type === 'identity') {
      if (event.handle) existing.handle = event.handle
    } else {
      existing.status = event.status
      existing.active = event.active
    }
    existing.lastEventAt = laterOf(existing.lastEventAt, event.time)
    this.pending.set(event.did, existing)
    this.lastEventAt = laterOf(this.lastEventAt, event.time)
    this.scheduleFlush()
  }

  private scheduleFlush(): void {
    if (this.pending.size >= this.config.flushBatchSize) {
      void this.flush().catch((error: unknown) => {
        this.logger.warn('indexer flush failed', { error })
      })
      return
    }
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      void this.flush().catch((error: unknown) => {
        this.logger.warn('indexer flush failed', { error })
      })
    }, this.config.flushIntervalMs)
    this.flushTimer.unref()
  }

  async flush(): Promise<void> {
    if (this.flushing) return this.flushing
    this.flushing = this.doFlush().finally(() => {
      this.flushing = null
    })
    return this.flushing
  }

  private async doFlush(): Promise<void> {
    if (this.pending.size === 0) return
    const rows = [...this.pending.values()]
    const cursor = this.queuedCursor
    this.pending = new Map()
    this.queuedCursor = null

    try {
      await this.store.applyBatch({
        rows,
        stream: FIREHOSE_STREAM,
        cursor,
        backfillComplete: this.backfillComplete,
      })
      if (cursor !== null) {
        this.cursor = Math.max(this.cursor ?? 0, cursor)
      }
      this.lastIndexedAt = new Date()
    } catch (error) {
      for (const row of rows) {
        const current = this.pending.get(row.did)
        if (current) mergeOlder(current, row)
        else this.pending.set(row.did, row)
      }
      if (cursor !== null) {
        this.queuedCursor = Math.max(this.queuedCursor ?? 0, cursor)
      }
      this.scheduleFlush()
      throw error
    }
  }
}
