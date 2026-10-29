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

export type DirectoryListParams = {
  cursor?: string
  limit: number
  search?: string
  status?: AccountStatus
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

export type ApplyBatchInput = {
  rows: AccountUpsert[]
  stream: string
  cursor: number | null
  backfillComplete?: boolean
}

export interface DirectoryStore {
  getCursor(stream: string): Promise<CursorState | null>
  applyBatch(input: ApplyBatchInput): Promise<void>
  markBackfillComplete(stream: string): Promise<void>
  listAccounts(params: DirectoryListParams): Promise<DirectoryPage>
  getAccount(did: string): Promise<AccountView | null>
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

  async applyBatch(input: ApplyBatchInput): Promise<void> {
    const statusRows = input.rows.filter((row) => row.status !== undefined)
    const handleRows = input.rows.filter((row) => row.status === undefined)

    await this.db.transaction().execute(async (trx) => {
      if (handleRows.length > 0) {
        await trx
          .insertInto('admin.account_directory')
          .values(
            handleRows.map((row) => ({
              did: row.did,
              handle: row.handle ?? null,
              last_event_at: row.lastEventAt ?? null,
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
        })
        .onConflict((oc) =>
          oc.column('stream').doUpdateSet({
            cursor: sql`case
              when excluded.cursor is null then admin.indexer_cursor.cursor
              when admin.indexer_cursor.cursor is null then excluded.cursor
              else greatest(admin.indexer_cursor.cursor, excluded.cursor)
            end`,
            backfill_complete: sql`admin.indexer_cursor.backfill_complete or excluded.backfill_complete`,
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
    const cursor = params.cursor === undefined ? undefined : decodeCursor(params.cursor)
    if (params.cursor !== undefined && !cursor) {
      throw new Error('invalid cursor')
    }
    const search = params.search?.trim()

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
      if (withCursor && cursor) query = query.where('a.did', '>', cursor)
      return query
    }

    const rows = await build(true)
      .selectAll()
      .orderBy('a.did', 'asc')
      .limit(params.limit)
      .execute()

    const totalRow = await build(false)
      .select(sql<number>`count(*)::int`.as('count'))
      .executeTakeFirstOrThrow()

    const last = rows.at(-1)
    return {
      total: totalRow.count,
      accounts: rows.map(toView),
      ...(rows.length === params.limit && last
        ? { cursor: encodeCursor(last.did) }
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
}
