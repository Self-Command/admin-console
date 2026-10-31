import type {
  AccountUpsert,
  AccountView,
  ApplyBatchInput,
  CursorState,
  DirectoryPage,
  DirectoryStore,
  IndexerState,
} from '../../src/directory/store.js'

type StoredAccount = {
  did: string
  handle?: string
  status?: string
  active?: boolean
  lastEventAt?: Date
}

type StoredIndexerState = {
  paused: boolean
  pausedBy: string | null
  pausedAt: Date | null
  lastIndexedAt: Date | null
  lastEventAt: Date | null
  connected: boolean
}

export class MemoryDirectoryStore implements DirectoryStore {
  readonly batches: ApplyBatchInput[] = []
  readonly cursors = new Map<string, CursorState>()
  readonly accounts = new Map<string, StoredAccount>()
  readonly syncPaused = new Set<string>()
  failApplyTimes = 0
  private readonly indexerStates = new Map<string, StoredIndexerState>()

  async getCursor(stream: string): Promise<CursorState | null> {
    return this.cursors.get(stream) ?? null
  }

  async getIndexerState(stream: string): Promise<IndexerState | null> {
    const cursor = this.cursors.get(stream)
    const extra = this.indexerStates.get(stream)
    if (!cursor && !extra) return null
    return {
      cursor: cursor?.cursor ?? null,
      backfillComplete: cursor?.backfillComplete ?? false,
      paused: extra?.paused ?? false,
      pausedBy: extra?.pausedBy ?? null,
      pausedAt: extra?.pausedAt ?? null,
      lastIndexedAt: extra?.lastIndexedAt ?? null,
      lastEventAt: extra?.lastEventAt ?? null,
      connected: extra?.connected ?? false,
    }
  }

  async applyBatch(input: ApplyBatchInput): Promise<void> {
    if (this.failApplyTimes > 0) {
      this.failApplyTimes -= 1
      throw new Error('simulated database failure')
    }

    this.batches.push({ ...input, rows: input.rows.map((row) => ({ ...row })) })
    for (const row of input.rows) this.merge(row)

    const previous = this.cursors.get(input.stream)
    const cursor =
      input.cursor === null
        ? (previous?.cursor ?? null)
        : Math.max(previous?.cursor ?? 0, input.cursor)
    this.cursors.set(input.stream, {
      cursor,
      backfillComplete:
        (previous?.backfillComplete ?? false) || (input.backfillComplete ?? false),
    })

    const state = this.state(input.stream)
    state.lastIndexedAt = new Date()
    const maxEventAt = input.rows.reduce<Date | null>((latest, row) => {
      if (!row.lastEventAt) return latest
      return !latest || row.lastEventAt > latest ? row.lastEventAt : latest
    }, null)
    if (maxEventAt && (!state.lastEventAt || maxEventAt > state.lastEventAt)) {
      state.lastEventAt = maxEventAt
    }
  }

  async markBackfillComplete(stream: string): Promise<void> {
    const previous = this.cursors.get(stream)
    this.cursors.set(stream, {
      cursor: previous?.cursor ?? null,
      backfillComplete: true,
    })
  }

  async setPaused(stream: string, paused: boolean, actor: string | null): Promise<void> {
    const state = this.state(stream)
    state.paused = paused
    state.pausedBy = paused ? actor : null
    state.pausedAt = paused ? new Date() : null
  }

  async setConnected(stream: string, connected: boolean): Promise<void> {
    this.state(stream).connected = connected
  }

  async countAccounts(): Promise<number> {
    return this.accounts.size
  }

  async listAccounts(): Promise<DirectoryPage> {
    throw new Error('listAccounts is not used by the indexer tests')
  }

  async getAccount(): Promise<AccountView | null> {
    throw new Error('getAccount is not used by the indexer tests')
  }

  async listSyncPaused(dids: readonly string[]): Promise<Set<string>> {
    return new Set(dids.filter((did) => this.syncPaused.has(did)))
  }

  private state(stream: string): StoredIndexerState {
    let state = this.indexerStates.get(stream)
    if (!state) {
      state = {
        paused: false,
        pausedBy: null,
        pausedAt: null,
        lastIndexedAt: null,
        lastEventAt: null,
        connected: false,
      }
      this.indexerStates.set(stream, state)
    }
    return state
  }

  private merge(row: AccountUpsert): void {
    const current = this.accounts.get(row.did) ?? { did: row.did }
    if (row.handle) current.handle = row.handle
    if (row.status !== undefined) current.status = row.status
    if (typeof row.active === 'boolean') current.active = row.active
    if (row.lastEventAt) {
      current.lastEventAt =
        current.lastEventAt && current.lastEventAt > row.lastEventAt
          ? current.lastEventAt
          : row.lastEventAt
    }
    this.accounts.set(row.did, current)
  }
}
