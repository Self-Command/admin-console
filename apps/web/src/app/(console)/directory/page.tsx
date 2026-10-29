'use client'

import { useEffect, useState } from 'react'
import {
  ActivityIcon,
  InfoIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  SearchIcon,
  SearchXIcon,
} from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { EmptyState, ErrorState, LoadingState } from '@/components/data-state'
import { useAuth } from '@/components/auth/auth-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  accountStatusLabels,
  accountStatusVariants,
  indexerHealth,
  type IndexerHealth,
} from '@/lib/accounts'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type { Account, AccountStatus, IndexerStatus } from '@/lib/data/types'
import { describeAdminError } from '@/lib/errors'
import { formatDateTime, truncateDid } from '@/lib/format'

const PAGE_SIZE = 10

type LoadStatus = 'loading' | 'ready' | 'error'
type DetailStatus = 'loading' | 'ready' | 'error'

const healthStyles: Record<IndexerHealth, string> = {
  healthy: 'bg-success/10 text-success',
  backfilling: 'bg-warning/15 text-warning-foreground',
  stale: 'bg-warning/15 text-warning-foreground',
  unknown: 'bg-muted text-muted-foreground',
}

const healthVariants: Record<IndexerHealth, 'success' | 'warning' | 'outline'> = {
  healthy: 'success',
  backfilling: 'warning',
  stale: 'warning',
  unknown: 'outline',
}

const healthTitles: Record<IndexerHealth, string> = {
  healthy: '索引器运行正常',
  backfilling: '索引回填进行中',
  stale: '索引可能已中断',
  unknown: '索引器状态未知',
}

function healthDetail(status: IndexerStatus | null, health: IndexerHealth): string {
  if (!status) return '正在读取索引器状态…'
  if (health === 'healthy') {
    return `回填完成 · 游标 ${status.cursor ?? '—'} · 最近索引 ${formatDateTime(status.lastIndexedAt)}`
  }
  if (health === 'backfilling') {
    return `初始回填尚未完成，目录数据可能不完整；当前游标 ${status.cursor ?? '—'}。`
  }
  if (health === 'stale') {
    return `目录为最后同步快照（${formatDateTime(status.lastIndexedAt)}），只读查询仍可用，索引恢复后自动继续。`
  }
  return '尚未取得索引器状态，账号目录可能为空。'
}

export default function DirectoryPage() {
  const provider = useDataProvider()
  const { preview } = useAuth()

  const [accounts, setAccounts] = useState<Account[]>([])
  const [total, setTotal] = useState(0)
  const [indexer, setIndexer] = useState<IndexerStatus | null>(null)
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [listError, setListError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | AccountStatus>('all')
  const [page, setPage] = useState(1)
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined])
  const [nextCursor, setNextCursor] = useState<string | undefined>()

  const [detailDid, setDetailDid] = useState<string | null>(null)
  const [detail, setDetail] = useState<Account | null>(null)
  const [detailIndexer, setDetailIndexer] = useState<IndexerStatus | null>(null)
  const [detailStatus, setDetailStatus] = useState<DetailStatus>('loading')
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailReloadToken, setDetailReloadToken] = useState(0)

  useEffect(() => {
    if (search === debouncedSearch) return
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
      setCursors([undefined])
    }, 300)
    return () => window.clearTimeout(timer)
  }, [search, debouncedSearch])

  useEffect(() => {
    let active = true
    const cursor = cursors[page - 1]
    setStatus('loading')
    setListError(null)

    provider
      .listAccounts({
        cursor,
        limit: PAGE_SIZE,
        status: statusFilter === 'all' ? undefined : statusFilter,
        search: debouncedSearch.trim() || undefined,
      })
      .then((result) => {
        if (!active) return
        setAccounts(result.accounts)
        setTotal(result.total)
        setIndexer(result.indexer)
        setNextCursor(result.cursor)
        setStatus('ready')
        const maxPage = Math.max(1, Math.ceil(result.total / PAGE_SIZE))
        if (page > maxPage) {
          setPage(maxPage)
          setCursors((current) => current.slice(0, maxPage))
        }
      })
      .catch((error: unknown) => {
        if (!active) return
        setListError(describeAdminError(error))
        setStatus('error')
      })

    return () => {
      active = false
    }
  }, [provider, cursors, page, statusFilter, debouncedSearch, reloadToken])

  useEffect(() => {
    if (!detailDid) return
    let active = true
    setDetailStatus('loading')
    setDetailError(null)
    setDetail(null)

    provider
      .getAccount(detailDid)
      .then((result) => {
        if (!active) return
        setDetail(result.account)
        setDetailIndexer(result.indexer)
        setDetailStatus('ready')
      })
      .catch((error: unknown) => {
        if (!active) return
        setDetailError(describeAdminError(error))
        setDetailStatus('error')
      })

    return () => {
      active = false
    }
  }, [provider, detailDid, detailReloadToken])

  function reload() {
    setReloadToken((value) => value + 1)
  }

  function resetPaging() {
    setPage(1)
    setCursors([undefined])
  }

  function clearFilters() {
    setSearch('')
    setDebouncedSearch('')
    setStatusFilter('all')
    resetPaging()
  }

  const health = indexerHealth(indexer)
  const pageStart = (page - 1) * PAGE_SIZE
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const showInitialLoading = status === 'loading' && accounts.length === 0
  const hasFilters = search.trim() !== '' || statusFilter !== 'all'

  return (
    <div className="space-y-5">
      <PageHeader
        title="账号目录"
        description="来自 PDS 的账号索引，只读；支持按句柄或 DID 前缀检索。"
        actions={<Badge variant="outline">只读目录</Badge>}
      />

      {preview ? (
        <div className="flex items-start gap-2 rounded-lg border border-dashed bg-muted/40 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          <InfoIcon className="mt-0.5 size-4 shrink-0" />
          界面预览：账号目录来自本地夹具。使用 PDS 账号登录后由 admin-api 返回索引器快照。
        </div>
      ) : null}

      <div
        className="flex flex-col gap-3 rounded-xl border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        aria-live="polite"
      >
        <div className="flex items-start gap-3">
          <span
            className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${healthStyles[health]}`}
          >
            <ActivityIcon className="size-4" />
          </span>
          <div>
            <p className="text-sm font-medium">{healthTitles[health]}</p>
            <p className="text-xs text-muted-foreground">{healthDetail(indexer, health)}</p>
          </div>
        </div>
        <Badge variant={healthVariants[health]} className="w-fit">
          {health === 'healthy'
            ? '订阅中'
            : health === 'backfilling'
              ? '回填中'
              : health === 'stale'
                ? '延迟'
                : '未知'}
        </Badge>
      </div>

      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-sm">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索句柄或 DID 前缀"
              className="pl-9"
              aria-label="搜索账号"
            />
          </div>
          <Select
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value as 'all' | AccountStatus)
              resetPaging()
            }}
            className="sm:w-36"
            aria-label="按状态筛选"
          >
            <option value="all">全部状态</option>
            {(Object.keys(accountStatusLabels) as AccountStatus[]).map((item) => (
              <option key={item} value={item}>
                {accountStatusLabels[item]}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground sm:ml-auto">共 {total} 条</p>
        </div>

        {status === 'error' ? (
          <ErrorState
            title="账号目录加载失败"
            message={listError ?? '操作失败，请稍后重试。'}
            onRetry={reload}
          />
        ) : showInitialLoading ? (
          <LoadingState label="正在加载账号目录…" />
        ) : accounts.length === 0 ? (
          <EmptyState
            icon={SearchXIcon}
            title="没有匹配的账号"
            message="目录只包含索引器已同步的数据；调整关键词或状态后再试。"
            action={
              hasFilters ? (
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  清空筛选
                </Button>
              ) : null
            }
          />
        ) : (
          <Table aria-busy={status === 'loading'}>
            <TableHeader>
              <TableRow>
                <TableHead>账号</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>最近事件</TableHead>
                <TableHead>索引时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((account) => (
                <TableRow key={account.did}>
                  <TableCell>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{account.handle ?? '未解析句柄'}</p>
                      <p
                        className="mt-0.5 font-mono text-xs text-muted-foreground"
                        title={account.did}
                      >
                        {truncateDid(account.did, 22, 8)}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={accountStatusVariants[account.status]}>
                      {accountStatusLabels[account.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDateTime(account.lastEventAt)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDateTime(account.indexedAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setDetailIndexer(null)
                        setDetailDid(account.did)
                      }}
                    >
                      详情
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <div className="flex flex-col gap-2 border-t px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            共 {total} 条
            {total > 0 ? `，第 ${pageStart + 1}–${pageStart + accounts.length} 条` : ''}
            {preview ? ' · 预览数据' : ''}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2"
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              disabled={page <= 1 || status === 'loading'}
            >
              上一页
            </Button>
            <span className="px-2 font-mono tabular-nums">
              {page} / {pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2"
              onClick={() => {
                if (!nextCursor) return
                setCursors((current) => {
                  const next = [...current]
                  next[page] = nextCursor
                  return next
                })
                setPage((value) => value + 1)
              }}
              disabled={!nextCursor || status === 'loading'}
            >
              下一页
            </Button>
          </div>
        </div>
      </Card>

      <p className="text-xs text-muted-foreground">
        账号目录由索引器写入，后台不提供修改入口；账号状态请在官方 PDS/Ozone 侧处理。
      </p>

      <Dialog
        open={detailDid !== null}
        onOpenChange={(open) => {
          if (!open) setDetailDid(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>账号详情</DialogTitle>
            <DialogDescription>只读视图，数据来自账号目录索引。</DialogDescription>
          </DialogHeader>

          {detailStatus === 'loading' ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <LoaderCircleIcon className="size-4 animate-spin" />
              正在加载账号详情…
            </div>
          ) : detailStatus === 'error' ? (
            <div className="space-y-3 py-2 text-center">
              <p role="alert" className="text-xs text-destructive">
                {detailError}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDetailReloadToken((value) => value + 1)}
              >
                <RefreshCwIcon className="size-3.5" />
                重试
              </Button>
            </div>
          ) : detail ? (
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">句柄</p>
                <p className="mt-1">{detail.handle ?? '未解析'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">DID</p>
                <p className="mt-1 font-mono text-xs break-all">{detail.did}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground">状态</p>
                  <p className="mt-1">
                    <Badge variant={accountStatusVariants[detail.status]}>
                      {accountStatusLabels[detail.status]}
                    </Badge>
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">最近事件</p>
                  <p className="mt-1 text-xs">{formatDateTime(detail.lastEventAt)}</p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground">索引时间</p>
                  <p className="mt-1 text-xs">{formatDateTime(detail.indexedAt)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">索引游标</p>
                  <p className="mt-1 font-mono text-xs">{detailIndexer?.cursor ?? '—'}</p>
                </div>
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailDid(null)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
