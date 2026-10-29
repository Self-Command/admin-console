import { describe, expect, it, vi } from 'vitest'
import type { IndexerConfig } from '../src/config.js'
import type { FirehoseEvent } from '../src/directory/events.js'
import { DirectoryIndexer } from '../src/directory/indexer.js'
import type { PdsClient, RepoPage } from '../src/directory/pds.js'
import type { FirehoseSource } from '../src/directory/source.js'
import { FIREHOSE_STREAM } from '../src/directory/store.js'
import { silentLogger } from '../src/logger.js'
import { MemoryDirectoryStore } from './helpers/memory-store.js'

const ALICE = 'did:plc:alice'
const BOB = 'did:plc:bob'

const INDEXER_CONFIG: IndexerConfig = {
  enabled: true,
  backfillPageSize: 2,
  backfillMaxMs: 60_000,
  resolveHandles: true,
  handleConcurrency: 2,
  flushIntervalMs: 10_000,
  flushBatchSize: 50,
  reconnectMaxSeconds: 1,
  maxFrameBytes: 1024 * 1024,
  maxBufferedBytes: 4 * 1024 * 1024,
}

const unusedSource: FirehoseSource = {
  async run() {
    throw new Error('the firehose source is not used in this test')
  },
}

function fakePds(
  pages: Record<string, RepoPage>,
  handles: Record<string, string> = {},
): PdsClient {
  return {
    async listRepos({ cursor }) {
      return pages[cursor ?? 'start'] ?? { repos: [] }
    },
    async resolveHandle(did) {
      return handles[did] ?? null
    },
  }
}

function createIndexer(
  store: MemoryDirectoryStore,
  pds: PdsClient,
  config: IndexerConfig = INDEXER_CONFIG,
): DirectoryIndexer {
  return new DirectoryIndexer({
    store,
    pds,
    source: unusedSource,
    logger: silentLogger,
    config,
  })
}

describe('directory backfill', () => {
  it('walks every listRepos page, resolves handles and marks the backfill complete', async () => {
    const store = new MemoryDirectoryStore()
    const pds = fakePds(
      {
        start: {
          cursor: 'page-2',
          repos: [
            { did: ALICE, active: true, status: 'active' },
            { did: BOB, active: false, status: 'deactivated' },
          ],
        },
        'page-2': {
          repos: [{ did: 'did:plc:carol', active: true, status: 'active' }],
        },
      },
      { [ALICE]: 'alice.test', 'did:plc:carol': 'carol.test' },
    )
    const indexer = createIndexer(store, pds)

    await indexer.backfill(new AbortController().signal)

    expect(indexer.snapshot().backfillComplete).toBe(true)
    expect(store.accounts.get(ALICE)).toMatchObject({
      handle: 'alice.test',
      status: 'active',
      active: true,
    })
    expect(store.accounts.get(BOB)).toMatchObject({ status: 'deactivated', active: false })
    expect(store.accounts.get(BOB)?.handle).toBeUndefined()
    expect(store.accounts.get('did:plc:carol')?.handle).toBe('carol.test')
    expect(store.cursors.get(FIREHOSE_STREAM)?.backfillComplete).toBe(true)
    expect(store.batches).toHaveLength(2)
  })

  it('stops when the PDS repeats its cursor', async () => {
    const store = new MemoryDirectoryStore()
    const pds = fakePds({
      start: { cursor: 'same', repos: [{ did: ALICE, active: true, status: 'active' }] },
      same: { cursor: 'same', repos: [{ did: BOB, active: true, status: 'active' }] },
    })
    const indexer = createIndexer(store, pds)

    await indexer.backfill(new AbortController().signal)

    expect(store.batches).toHaveLength(2)
    expect(indexer.snapshot().backfillComplete).toBe(true)
  })
})

describe('firehose event application', () => {
  it('merges identity and account events and advances the persisted cursor', async () => {
    const store = new MemoryDirectoryStore()
    const indexer = createIndexer(store, fakePds({}))

    indexer.applyEvent({
      type: 'identity',
      did: ALICE,
      handle: 'alice.test',
      seq: 10,
      time: new Date('2026-10-28T10:00:00.000Z'),
    })
    indexer.applyEvent({
      type: 'account',
      did: ALICE,
      active: false,
      status: 'suspended',
      seq: 11,
      time: new Date('2026-10-28T10:00:01.000Z'),
    })
    indexer.applyEvent({
      type: 'identity',
      did: BOB,
      handle: 'bob.test',
      seq: 9,
      time: new Date('2026-10-28T10:00:02.000Z'),
    })
    await indexer.flush()

    expect(store.accounts.get(ALICE)).toMatchObject({
      handle: 'alice.test',
      status: 'suspended',
      active: false,
    })
    expect(store.accounts.has(BOB)).toBe(false)
    expect(store.batches).toHaveLength(1)
    expect(indexer.snapshot().cursor).toBe(11)
  })

  it('keeps rows and the cursor when the database write fails, then retries', async () => {
    const store = new MemoryDirectoryStore()
    const indexer = createIndexer(store, fakePds({}))
    store.failApplyTimes = 1

    indexer.applyEvent({
      type: 'identity',
      did: ALICE,
      handle: 'alice.test',
      seq: 5,
      time: new Date('2026-10-28T10:00:00.000Z'),
    })
    await expect(indexer.flush()).rejects.toThrow('simulated database failure')

    expect(indexer.snapshot().cursor).toBeNull()
    expect(store.batches).toHaveLength(0)

    await indexer.flush()

    expect(store.batches).toHaveLength(1)
    expect(store.batches[0]?.cursor).toBe(5)
    expect(store.accounts.get(ALICE)?.handle).toBe('alice.test')
    expect(indexer.snapshot().cursor).toBe(5)
  })

  it('resumes from the persisted cursor after a restart', async () => {
    const store = new MemoryDirectoryStore()
    store.cursors.set(FIREHOSE_STREAM, { cursor: 20, backfillComplete: true })
    const replayed: FirehoseEvent[] = [
      {
        type: 'identity',
        did: ALICE,
        handle: 'alice.test',
        seq: 20,
        time: new Date('2026-10-28T10:00:00.000Z'),
      },
      {
        type: 'identity',
        did: BOB,
        handle: 'bob.test',
        seq: 21,
        time: new Date('2026-10-28T10:00:01.000Z'),
      },
    ]
    const source: FirehoseSource = {
      async run(options) {
        options.onConnect()
        for (const event of replayed) await options.onEvent(event)
        await new Promise((resolve) => setTimeout(resolve, 30))
      },
    }
    const indexer = new DirectoryIndexer({
      store,
      pds: fakePds({}),
      source,
      logger: silentLogger,
      config: { ...INDEXER_CONFIG, flushIntervalMs: 10 },
    })

    const running = indexer.start()
    await vi.waitFor(() => expect(store.batches.length).toBeGreaterThan(0))
    await indexer.stop()
    await running

    expect(store.batches).toHaveLength(1)
    expect(store.batches[0]?.cursor).toBe(21)
    expect(store.accounts.has(ALICE)).toBe(false)
    expect(store.accounts.get(BOB)?.handle).toBe('bob.test')
  })
})

describe('indexer status', () => {
  it('reports a disabled indexer as initialized', () => {
    const indexer = createIndexer(
      new MemoryDirectoryStore(),
      fakePds({}),
      { ...INDEXER_CONFIG, enabled: false },
    )

    expect(indexer.snapshot()).toMatchObject({
      enabled: false,
      initialized: true,
      backfillComplete: false,
      connected: false,
      cursor: null,
    })
  })
})
