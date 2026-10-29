import { Kysely, PostgresDialect, sql } from 'kysely'
import pg from 'pg'
import type { Database } from './types.js'

const { Pool } = pg

export type DbOptions = {
  maxConnections?: number
  connectionTimeoutMs?: number
}

export function createDb(databaseUrl: string, options: DbOptions = {}): Kysely<Database> {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: options.maxConnections ?? 10,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5000,
  })
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  })
}

export async function pingDb(
  db: Kysely<Database>,
  timeoutMs: number,
): Promise<{ ok: boolean; latencyMs?: number }> {
  const started = Date.now()
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      sql`select 1`.execute(db),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('database ping timed out')), timeoutMs)
        timer.unref()
      }),
    ])
    return { ok: true, latencyMs: Date.now() - started }
  } catch {
    return { ok: false }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function closeDb(db: Kysely<Database>): Promise<void> {
  await db.destroy()
}
