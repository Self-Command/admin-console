import type {
  AccountUpsert,
  AccountView,
  ApplyBatchInput,
  CursorState,
  DirectoryPage,
  DirectoryStore,
} from '../../src/directory/store.js'

type StoredAccount = {
  did: string
  handle?: string
  status?: string
  active?: boolean
  lastEventAt?: Date
}

export class MemoryDirectoryStore implements DirectoryStore {
  readonly batches: ApplyBatchInput[] = []
  readonly cursors = new Map<string, CursorState>()
  readonly accounts = new Map<string, StoredAccount>()
  failApplyTimes = 0

  async getCursor(stream: string): Promise<CursorState | null> {
    return this.cursors.get(stream) ?? null
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
  }

  async markBackfillComplete(stream: string): Promise<void> {
    const previous = this.cursors.get(stream)
    this.cursors.set(stream, {
      cursor: previous?.cursor ?? null,
      backfillComplete: true,
    })
  }

  async listAccounts(): Promise<DirectoryPage> {
    throw new Error('listAccounts is not used by the indexer tests')
  }

  async getAccount(): Promise<AccountView | null> {
    throw new Error('getAccount is not used by the indexer tests')
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
