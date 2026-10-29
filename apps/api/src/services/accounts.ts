import { com } from '@admin/lexicons'
import { LexServerError } from '@atproto/lex-server'
import type { AccountStatus } from '../db/types.js'
import type { IndexerSnapshot } from '../directory/indexer.js'
import type { DirectoryStore } from '../directory/store.js'
import { decodeCursor } from '../pagination.js'

export type IndexerStatusView = com.selfcommand.admin.defs.IndexerStatus

export type AccountListView = com.selfcommand.admin.defs.Account

export type AccountListResult = com.selfcommand.admin.account.list.$OutputBody

export type AccountGetResult = com.selfcommand.admin.account.get.$OutputBody

const ACCOUNT_STATUSES: readonly AccountStatus[] = [
  'active',
  'deactivated',
  'suspended',
  'takendown',
  'deleted',
  'unknown',
]

function parseAccountStatus(value: string): AccountStatus | null {
  return (ACCOUNT_STATUSES as readonly string[]).includes(value)
    ? (value as AccountStatus)
    : null
}

export function toIndexerStatus(snapshot: IndexerSnapshot): IndexerStatusView {
  return {
    backfillComplete: snapshot.backfillComplete,
    ...(snapshot.lastEventAt
      ? { lastEventAt: snapshot.lastEventAt.toISOString() as IndexerStatusView['lastEventAt'] }
      : {}),
    ...(snapshot.lastIndexedAt
      ? {
          lastIndexedAt: snapshot.lastIndexedAt.toISOString() as IndexerStatusView['lastIndexedAt'],
        }
      : {}),
    ...(snapshot.cursor !== null ? { cursor: String(snapshot.cursor) } : {}),
  }
}

export async function listAccounts(
  store: DirectoryStore,
  params: {
    cursor?: string
    limit: number
    search?: string
    status?: string
  },
  snapshot: IndexerSnapshot,
): Promise<AccountListResult> {
  if (params.cursor !== undefined && !decodeCursor(params.cursor)) {
    throw new LexServerError(400, {
      error: 'InvalidRequest',
      message: 'invalid cursor',
    })
  }
  const status = params.status === undefined ? undefined : parseAccountStatus(params.status)
  if (params.status !== undefined && !status) {
    throw new LexServerError(400, {
      error: 'InvalidRequest',
      message: 'status is not a known account status',
    })
  }
  const page = await store.listAccounts({
    cursor: params.cursor,
    limit: params.limit,
    search: params.search,
    status: status ?? undefined,
  })
  return { ...page, indexer: toIndexerStatus(snapshot) }
}

export async function getAccount(
  store: DirectoryStore,
  did: string,
  snapshot: IndexerSnapshot,
): Promise<AccountGetResult> {
  const account = await store.getAccount(did)
  if (!account) {
    throw new LexServerError(404, {
      error: 'AccountNotFound',
      message: 'The DID is not present in the indexed directory',
    })
  }
  return { account, indexer: toIndexerStatus(snapshot) }
}
