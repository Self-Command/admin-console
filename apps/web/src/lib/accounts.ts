import type { AccountStatus, IndexerStatus } from '@/lib/data/types'

export const accountStatusLabels: Record<AccountStatus, string> = {
  active: '正常',
  deactivated: '已停用',
  suspended: '已暂停',
  takendown: '已下架',
  deleted: '已删除',
  unknown: '未知',
}

export type AccountStatusVariant =
  | 'success'
  | 'warning'
  | 'destructive'
  | 'secondary'
  | 'outline'

export const accountStatusVariants: Record<AccountStatus, AccountStatusVariant> = {
  active: 'success',
  suspended: 'warning',
  takendown: 'destructive',
  deactivated: 'secondary',
  deleted: 'outline',
  unknown: 'outline',
}

export type IndexerHealth = 'unknown' | 'backfilling' | 'stale' | 'healthy'

export const INDEXER_STALE_MS = 5 * 60 * 1000

export function indexerHealth(
  status: IndexerStatus | null,
  now: number = Date.now(),
): IndexerHealth {
  if (!status) return 'unknown'
  if (!status.backfillComplete) return 'backfilling'
  if (!status.lastIndexedAt) return 'stale'
  const indexedAt = new Date(status.lastIndexedAt).getTime()
  if (Number.isNaN(indexedAt)) return 'stale'
  return now - indexedAt > INDEXER_STALE_MS ? 'stale' : 'healthy'
}
