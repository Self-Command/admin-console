import { com } from '@admin/lexicons'
import type { Kysely } from 'kysely'
import { insertAuditSafely, type RequestMeta } from '../audit.js'
import type { Database } from '../db/types.js'
import type { DirectoryIndexer } from '../directory/indexer.js'
import type { DirectoryStore } from '../directory/store.js'
import type { Logger } from '../logger.js'
import { toIndexerStatus } from './accounts.js'

export type IndexerStatusResult = com.selfcommand.admin.indexer.status.$OutputBody
export type IndexerPauseResult = com.selfcommand.admin.indexer.pause.$OutputBody
export type IndexerResumeResult = com.selfcommand.admin.indexer.resume.$OutputBody

export type IndexerAdminDeps = {
  db: Kysely<Database>
  logger: Logger
  store: DirectoryStore
  indexer: DirectoryIndexer
}

export async function getIndexerStatus(
  deps: IndexerAdminDeps,
): Promise<IndexerStatusResult> {
  return {
    status: toIndexerStatus(deps.indexer.snapshot()),
    accounts: await deps.store.countAccounts(),
  }
}

export async function pauseIndexer(
  deps: IndexerAdminDeps & { actor: string; meta: RequestMeta },
  reason?: string,
): Promise<IndexerPauseResult> {
  const action = 'com.selfcommand.admin.indexer.pause'
  const snapshot = await deps.indexer.pause(deps.actor)
  await insertAuditSafely(deps.db, deps.logger, {
    actor: deps.actor,
    action,
    targetType: 'indexer',
    target: '账号目录',
    result: 'success',
    detail: reason?.trim() ? `暂停账号索引器：${reason.trim()}` : '暂停账号索引器',
    ...deps.meta,
  })
  return { status: toIndexerStatus(snapshot) }
}

export async function resumeIndexer(
  deps: IndexerAdminDeps & { actor: string; meta: RequestMeta },
): Promise<IndexerResumeResult> {
  const action = 'com.selfcommand.admin.indexer.resume'
  const snapshot = await deps.indexer.resume()
  await insertAuditSafely(deps.db, deps.logger, {
    actor: deps.actor,
    action,
    targetType: 'indexer',
    target: '账号目录',
    result: 'success',
    detail: '恢复账号索引器',
    ...deps.meta,
  })
  return { status: toIndexerStatus(snapshot) }
}
