import { com } from '@admin/lexicons'
import { sql, type Kysely } from 'kysely'
import type { AccountStatus, Database } from '../db/types.js'
import { decodeCursor, encodeCursor } from '../pagination.js'

export const FIREHOSE_STREAM = 'com.atproto.sync.subscribeRepos'

export type AccountUpsert = {
  did: string
  handle?: string | null
  status?: AccountStatus
  active?: boolean | null
  lastEventAt?: Date | null
}

export type AccountView = com.selfcommand.admin.defs.Account

export type AccountSort = 'did' | 'handle' | 'status' | 'indexedAt'

export type DirectoryListParams = {
  cursor?: string
  limit: number
  search?: string
  status?: AccountStatus
  sort?: AccountSort
  order?: 'asc' | 'desc'
}

export type DirectoryPage = {
  cursor?: string
  total: number
  accounts: AccountView[]
}

export type CursorState = {
  cursor: number | null
  backfillComplete: boolean
}

export type IndexerState = {
  cursor: number | null
  backfillComplete: boolean
  paused: boolean
  pausedBy: string | null
  pausedAt: Date | null
  lastIndexedAt: Date | null
  lastEventAt: Date | null
  connected: boolean
}

type AccountCursor = { v: string; did: string; s: AccountSort; o: 'asc' | 'desc' }

export type ApplyBatchInput = {
  rows: AccountUpsert[]
  stream: string
  cursor: number | null
  backfillComplete?: boolean
}

export interface DirectoryStore {
  getCursor(stream: string): Promise<CursorState | null>
  getIndexerState(stream: string): Promise<IndexerState | null>
  applyBatch(input: ApplyBatchInput): Promise<void>
  markBackfillComplete(stream: string): Promise<void>
  setPaused(stream: string, paused: boolean, actor: string | null): Promise<void>
  setConnected(stream: string, connected: boolean): Promise<void>
  countAccounts(): Promise<number>
  listAccounts(params: DirectoryListParams): Promise<DirectoryPage>
  getAccount(did: string): Promise<AccountView | null>
  listSyncPaused(dids: readonly string[]): Promise<Set<string>>
}

function toView(row: {
  did: string
  handle: string | null
  status: string
  last_event_at: Date | null
  indexed_at: Date
}): AccountView {
  return {
    did: row.did as AccountView['did'],
    ...(row.handle ? { handle: row.handle as AccountView['handle'] } : {}),
    status: row.status as AccountStatus,
    ...(row.last_event_at
      ? { lastEventAt: row.last_event_at.toISOString() as AccountView['lastEventAt'] }
      : {}),
    indexedAt: row.indexed_at.toISOString() as AccountView['indexedAt'],
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`)
}

export class KyselyDirectoryStore implements DirectoryStore {
  constructor(private readonly db: Kysely<Database>) {}

  async getCursor(stream: string): Promise<CursorState | null> {
    const row = await this.db
      .selectFrom('admin.indexer_cursor')
      .select(['cursor', 'backfill_complete'])
      .where('stream', '=', stream)
      .executeTakeFirst()
    if (!row) return null
    const cursor = row.cursor === null ? null : Number(row.cursor)
    return {
      cursor: cursor !== null && Number.isSafeInteger(cursor) ? cursor : null,
      backfillComplete: row.backfill_complete,
    }
  }

  async getIndexerState(stream: string): Promise<IndexerState | null> {
    const row = await this.db
      .selectFrom('admin.indexer_cursor')
      .selectAll()
      .where('stream', '=', stream)
      .executeTakeFirst()
    if (!row) return null
    const cursor = row.cursor === null ? null : Number(row.cursor)
    return {
      cursor: cursor !== null && Number.isSafeInteger(cursor) ? cursor : null,
      backfillComplete: row.backfill_complete,
      paused: row.paused,
      pausedBy: row.paused_by,
      pausedAt: row.paused_at,
      lastIndexedAt: row.last_indexed_at,
      lastEventAt: row.last_event_at,
      connected: row.connected,
    }
  }

  async setPaused(stream: string, paused: boolean, actor: string | null): Promise<void> {
    await this.db
      .insertInto('admin.indexer_cursor')
      .values({
        stream,
        cursor: null,
        paused,
        paused_by: paused ? actor : null,
        paused_at: paused ? new Date() : null,
      })
      .onConflict((oc) =>
        oc.column('stream').doUpdateSet({
          paused,
          paused_by: paused ? actor : null,
          paused_at: paused ? sql`now()` : null,
          updated_at: sql`now()`,
        }),
      )
      .execute()
  }

  async setConnected(stream: string, connected: boolean): Promise<void> {
    await this.db
      .insertInto('admin.indexer_cursor')
      .values({ stream, cursor: null, connected })
      .onConflict((oc) =>
        oc.column('stream').doUpdateSet({
          connected,
          updated_at: sql`now()`,
        }),
      )
      .execute()
  }

  async countAccounts(): Promise<number> {
    const row = await this.db
      .selectFrom('admin.account_directory')
      .select(sql<number>`count(*)::int`.as('count'))
      .executeTakeFirstOrThrow()
    return row.count
  }

  async applyBatch(input: ApplyBatchInput): Promise<void> {
    const statusRows = input.rows.filter((row) => row.status !== undefined)
    const handleRows = input.rows.filter((row) => row.status === undefined)
    const maxEventAt = input.rows.reduce<Date | null>((latest, row) => {
      if (!row.lastEventAt) return latest
      return !latest || row.lastEventAt > latest ? row.lastEventAt : latest
    }, null)

    await this.db.transaction().execute(async (trx) => {
      if (handleRows.length > 0) {
        await trx
          .insertInto('admin.account_directory')
          .values(
            handleRows.map((row) => ({
              did: row.did,
              handle: row.handle ?? null,
              last_event_at: row.lastEventAt ?? null,
              first_seen_at: new Date(),
            })),
          )
          .onConflict((oc) =>
            oc.column('did').doUpdateSet({
              handle: sql`coalesce(excluded.handle, admin.account_directory.handle)`,
              last_event_at: sql`greatest(admin.account_directory.last_event_at, excluded.last_event_at)`,
              indexed_at: sql`now()`,
            }),
          )
          .execute()
      }

      if (statusRows.length > 0) {
        await trx
          .insertInto('admin.account_directory')
          .values(
            statusRows.map((row) => ({
              did: row.did,
              handle: row.handle ?? null,
              status: row.status ?? 'unknown',
              active: row.active ?? null,
              last_event_at: row.lastEventAt ?? null,
              first_seen_at: new Date(),
            })),
          )
          .onConflict((oc) =>
            oc.column('did').doUpdateSet({
              handle: sql`coalesce(excluded.handle, admin.account_directory.handle)`,
              status: sql`excluded.status`,
              active: sql`coalesce(excluded.active, admin.account_directory.active)`,
              last_event_at: sql`greatest(admin.account_directory.last_event_at, excluded.last_event_at)`,
              indexed_at: sql`now()`,
            }),
          )
          .execute()
      }

      await trx
        .insertInto('admin.indexer_cursor')
        .values({
          stream: input.stream,
          cursor: input.cursor === null ? null : String(input.cursor),
          backfill_complete: input.backfillComplete ?? false,
          last_indexed_at: new Date(),
          last_event_at: maxEventAt,
        })
        .onConflict((oc) =>
          oc.column('stream').doUpdateSet({
            cursor: sql`case
              when excluded.cursor is null then admin.indexer_cursor.cursor
              when admin.indexer_cursor.cursor is null then excluded.cursor
              else greatest(admin.indexer_cursor.cursor, excluded.cursor)
            end`,
            backfill_complete: sql`admin.indexer_cursor.backfill_complete or excluded.backfill_complete`,
            last_indexed_at: sql`now()`,
            last_event_at: sql`greatest(admin.indexer_cursor.last_event_at, excluded.last_event_at)`,
            updated_at: sql`now()`,
          }),
        )
        .execute()
    })
  }

  async markBackfillComplete(stream: string): Promise<void> {
    await this.db
      .insertInto('admin.indexer_cursor')
      .values({ stream, cursor: null, backfill_complete: true })
      .onConflict((oc) =>
        oc.column('stream').doUpdateSet({
          backfill_complete: sql`true`,
          updated_at: sql`now()`,
        }),
      )
      .execute()
  }

  async listAccounts(params: DirectoryListParams): Promise<DirectoryPage> {
    const sort = params.sort ?? 'did'
    const order = params.order ?? 'asc'
    let cursor: AccountCursor | undefined
    if (params.cursor !== undefined) {
      const decoded = decodeCursor(params.cursor)
      if (!decoded) throw new Error('invalid cursor')
      const parsed = JSON.parse(decoded) as AccountCursor
      if (
        typeof parsed.v !== 'string' ||
        typeof parsed.did !== 'string' ||
        typeof parsed.s !== 'string' ||
        (parsed.o !== 'asc' && parsed.o !== 'desc')
      ) {
        throw new Error('invalid cursor')
      }
      if (parsed.s !== sort || parsed.o !== order) throw new Error('cursor sort mismatch')
      cursor = parsed
    }
    const search = params.search?.trim()

    const column =
      sort === 'handle'
        ? sql`coalesce(a.handle, '')`
        : sort === 'status'
          ? sql`a.status`
          : sort === 'indexedAt'
            ? sql`a.indexed_at`
            : sql`a.did`
    const op = order === 'asc' ? sql`>` : sql`<`

    const build = (withCursor: boolean) => {
      let query = this.db.selectFrom('admin.account_directory as a')
      if (params.status) query = query.where('a.status', '=', params.status)
      if (search) {
        const prefix = `${escapeLike(search)}%`
        const contains = `%${escapeLike(search)}%`
        query = query.where(
          sql<boolean>`(a.did like ${prefix} or a.handle ilike ${contains})`,
        )
      }
      if (withCursor && cursor) {
        const value = sort === 'indexedAt' ? sql`${cursor.v}::timestamptz` : sql`${cursor.v}`
        query = query.where(sql<boolean>`(${column}, a.did) ${op} (${value}, ${cursor.did})`)
      }
      return query
    }

    const rows = await build(true)
      .selectAll()
      .orderBy(column, order)
      .orderBy('a.did', order)
      .limit(params.limit)
      .execute()

    const totalRow = await build(false)
      .select(sql<number>`count(*)::int`.as('count'))
      .executeTakeFirstOrThrow()

    const last = rows.at(-1)
    const cursorValue = last
      ? sort === 'handle'
        ? (last.handle ?? '')
        : sort === 'status'
          ? last.status
          : sort === 'indexedAt'
            ? last.indexed_at.toISOString()
            : last.did
      : ''
    return {
      total: totalRow.count,
      accounts: rows.map(toView),
      ...(rows.length === params.limit && last
        ? {
            cursor: encodeCursor(
              JSON.stringify({ v: cursorValue, did: last.did, s: sort, o: order } satisfies AccountCursor),
            ),
          }
        : {}),
    }
  }

  async getAccount(did: string): Promise<AccountView | null> {
    const row = await this.db
      .selectFrom('admin.account_directory')
      .selectAll()
      .where('did', '=', did)
      .executeTakeFirst()
    return row ? toView(row) : null
  }

  async listSyncPaused(dids: readonly string[]): Promise<Set<string>> {
    if (dids.length === 0) return new Set()
    const rows = await this.db
      .selectFrom('admin.account_operation')
      .select('did')
      .where('did', 'in', [...dids])
      .where('sync_paused', '=', true)
      .execute()
    return new Set(rows.map((row) => row.did))
  }
}
