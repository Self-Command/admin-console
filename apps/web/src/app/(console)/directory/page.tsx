'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ActivityIcon,
  BookmarkIcon,
  DownloadIcon,
  FingerprintIcon,
  FolderIcon,
  LoaderCircleIcon,
  SearchIcon,
  SearchXIcon,
  Trash2Icon,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/page-header'
import { EmptyState, ErrorState, LoadingState } from '@/components/data-state'
import { useAuth } from '@/components/auth/auth-provider'
import { SignatureSearchPanel } from '@/components/directory/signature-search-panel'
import { useWorkspace } from '@/components/layout/workspace-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { hasPermission } from '@/lib/access'
import {
  accountStatusLabels,
  accountStatusVariants,
  indexerHealth,
  type IndexerHealth,
} from '@/lib/accounts'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type {
  Account,
  AccountBatchExportFormat,
  AccountSort,
  AccountStatus,
  IndexerStatus,
  SortOrder,
} from '@/lib/data/types'
import { downloadTextFile, exportTimestamp } from '@/lib/download'
import { describeAdminError } from '@/lib/errors'
import { formatDateTime, truncateDid } from '@/lib/format'
import type { SavedView } from '@/lib/runtime/types'

type LoadStatus = 'loading' | 'ready' | 'error'

type DirectoryTab = 'directory' | 'signature'

type SortValue = `${AccountSort}:${SortOrder}`

const MAX_BATCH_EXPORT = 500
const MAX_SAVED_VIEWS = 10
const MAX_VIEW_NAME = 40

const SORT_OPTIONS: Array<{ value: SortValue; label: string }> = [
  { value: 'indexedAt:desc', label: '索引时间从新到旧' },
  { value: 'indexedAt:asc', label: '索引时间从旧到新' },
  { value: 'status:asc', label: '状态升序' },
  { value: 'status:desc', label: '状态降序' },
  { value: 'handle:asc', label: '句柄升序' },
  { value: 'handle:desc', label: '句柄降序' },
]

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

function describeView(view: SavedView): string {
  const parts = [
    view.search ? `关键词：${view.search}` : '全部关键词',
    view.status ? accountStatusLabels[view.status] : '全部状态',
  ]
  const option = SORT_OPTIONS.find(
    (item) => item.value === `${view.sort ?? 'indexedAt'}:${view.order ?? 'desc'}`,
  )
  if (option) parts.push(option.label)
  return parts.join(' · ')
}

export default function DirectoryPage() {
  const provider = useDataProvider()
  const { identity } = useAuth()
  const { pageSize, preferences, savePreferences, savingPreferences } = useWorkspace()

  const canSearchSignatures = hasPermission(identity, 'moderation.read')
  const [tab, setTab] = useState<DirectoryTab>('directory')
  const activeTab: DirectoryTab =
    tab === 'signature' && canSearchSignatures ? 'signature' : 'directory'

  const [accounts, setAccounts] = useState<Account[]>([])
  const [total, setTotal] = useState(0)
  const [indexer, setIndexer] = useState<IndexerStatus | null>(null)
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [listError, setListError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | AccountStatus>('all')
  const [sort, setSort] = useState<SortValue>('indexedAt:desc')
  const [page, setPage] = useState(1)
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined])
  const [nextCursor, setNextCursor] = useState<string | undefined>()

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState<AccountBatchExportFormat | null>(null)
  const [viewOpen, setViewOpen] = useState(false)
  const [viewName, setViewName] = useState('')
  const [viewError, setViewError] = useState<string | null>(null)

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
    const [sortField, sortOrder] = sort.split(':') as [AccountSort, SortOrder]
    setStatus('loading')
    setListError(null)

    provider
      .listAccounts({
        cursor,
        limit: pageSize,
        status: statusFilter === 'all' ? undefined : statusFilter,
        search: debouncedSearch.trim() || undefined,
        sort: sortField,
        order: sortOrder,
      })
      .then((result) => {
        if (!active) return
        setAccounts(result.accounts)
        setTotal(result.total)
        setIndexer(result.indexer)
        setNextCursor(result.cursor)
        setStatus('ready')
        const maxPage = Math.max(1, Math.ceil(result.total / pageSize))
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
  }, [provider, cursors, page, pageSize, statusFilter, sort, debouncedSearch, reloadToken])

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
    setSort('indexedAt:desc')
    resetPaging()
  }

  useEffect(() => {
    setSelected(new Set())
  }, [accounts])

  const savedViews = preferences.savedViews ?? []
  const selectedCount = selected.size
  const allSelected = accounts.length > 0 && accounts.every((item) => selected.has(item.did))
  const someSelected = !allSelected && accounts.some((item) => selected.has(item.did))

  function toggleRow(did: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(did)
      else next.delete(did)
      return next
    })
  }

  function togglePage(checked: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      for (const account of accounts) {
        if (checked) next.add(account.did)
        else next.delete(account.did)
      }
      return next
    })
  }

  async function exportSelected(format: AccountBatchExportFormat) {
    const dids = Array.from(selected)
    if (dids.length === 0) return
    if (dids.length > MAX_BATCH_EXPORT) {
      toast.error(`单次最多导出 ${MAX_BATCH_EXPORT} 个账号，请缩小选择范围后重试。`)
      return
    }
    setExporting(format)
    try {
      const result = await provider.batchExportAccounts(dids, format)
      downloadTextFile(
        `account-operations-${exportTimestamp()}.${format}`,
        result.content,
        format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8',
      )
      toast.success(`已导出 ${result.count} 个账号的运营记录。`)
    } catch (error) {
      toast.error(describeAdminError(error))
    } finally {
      setExporting(null)
    }
  }

  function applyView(view: SavedView) {
    const nextSearch = view.search ?? ''
    setSearch(nextSearch)
    setDebouncedSearch(nextSearch)
    setStatusFilter(view.status ?? 'all')
    setSort(`${view.sort ?? 'indexedAt'}:${view.order ?? 'desc'}` as SortValue)
    resetPaging()
    setViewOpen(false)
    toast.success(`已应用筛选视图「${view.name}」。`)
  }

  async function saveCurrentView() {
    const name = viewName.trim()
    if (!name) {
      setViewError('请填写视图名称。')
      return
    }
    if (name.length > MAX_VIEW_NAME) {
      setViewError(`视图名称最长 ${MAX_VIEW_NAME} 个字符。`)
      return
    }
    if (savedViews.length >= MAX_SAVED_VIEWS) {
      setViewError(`最多保存 ${MAX_SAVED_VIEWS} 个视图，请先删除不再使用的视图。`)
      return
    }
    if (savedViews.some((item) => item.name === name)) {
      setViewError('已存在同名视图，请使用其他名称。')
      return
    }
    const [sortField, sortOrder] = sort.split(':') as [AccountSort, SortOrder]
    const view: SavedView = {
      id: `view-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}),
      ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
      sort: sortField,
      order: sortOrder,
    }
    setViewError(null)
    const saved = await savePreferences({ savedViews: [...savedViews, view] })
    if (!saved) {
      setViewError('视图未能同步到账号，请稍后重试。')
      return
    }
    setViewName('')
    setViewOpen(false)
    toast.success(`已保存筛选视图「${name}」。`)
  }

  async function deleteView(view: SavedView) {
    const saved = await savePreferences({
      savedViews: savedViews.filter((item) => item.id !== view.id),
    })
    if (saved) toast.success(`已删除筛选视图「${view.name}」。`)
    else toast.error('视图删除未能同步到账号，请稍后重试。')
  }

  const health = indexerHealth(indexer)
  const pageStart = (page - 1) * pageSize
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const showInitialLoading = status === 'loading' && accounts.length === 0
  const hasFilters = search.trim() !== '' || statusFilter !== 'all'

  return (
    <div className="space-y-5">
      <PageHeader
        title="账号目录"
        description={
          activeTab === 'signature'
            ? '按威胁签名值检索匹配账号，结果由审核服务实时计算，只读。'
            : '来自账号服务的账号索引，只读；支持按句柄或账号标识前缀检索。'
        }
        actions={<Badge variant="outline">只读目录</Badge>}
      />

      <Tabs value={activeTab} onValueChange={(value) => setTab(value as DirectoryTab)}>
        <TabsList>
          <TabsTrigger value="directory">
            <FolderIcon />
            账号目录
          </TabsTrigger>
          {canSearchSignatures ? (
            <TabsTrigger value="signature">
              <FingerprintIcon />
              威胁签名检索
            </TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="directory" className="space-y-5">
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
                  placeholder="搜索句柄或账号标识前缀"
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
              <Select
                value={sort}
                onChange={(event) => {
                  setSort(event.target.value as SortValue)
                  resetPaging()
                }}
                className="sm:w-44"
                aria-label="排序方式"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setViewError(null)
                  setViewOpen(true)
                }}
              >
                <BookmarkIcon />
                筛选视图
                {savedViews.length > 0 ? (
                  <Badge variant="muted" className="ml-1">
                    {savedViews.length}
                  </Badge>
                ) : null}
              </Button>
              <p className="text-xs text-muted-foreground sm:ml-auto">共 {total} 条</p>
            </div>

            {selectedCount > 0 ? (
              <div
                className="flex flex-col gap-2 border-b bg-muted/40 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                aria-live="polite"
              >
                <p className="text-sm">
                  已选择 <span className="font-medium tabular-nums">{selectedCount}</span> 个账号
                  <span className="ml-2 text-xs text-muted-foreground">
                    单次最多导出 {MAX_BATCH_EXPORT} 个
                  </span>
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void exportSelected('json')}
                    disabled={exporting !== null}
                  >
                    {exporting === 'json' ? (
                      <LoaderCircleIcon className="animate-spin" />
                    ) : (
                      <DownloadIcon />
                    )}
                    导出 JSON
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void exportSelected('csv')}
                    disabled={exporting !== null}
                  >
                    {exporting === 'csv' ? (
                      <LoaderCircleIcon className="animate-spin" />
                    ) : (
                      <DownloadIcon />
                    )}
                    导出 CSV
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                    清除选择
                  </Button>
                </div>
              </div>
            ) : null}

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
                    <TableHead className="w-10">
                      <Checkbox
                        aria-label="选择当前页全部账号"
                        checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                        onCheckedChange={(checked) => togglePage(checked === true)}
                        disabled={accounts.length === 0}
                      />
                    </TableHead>
                    <TableHead>账号</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>最近事件</TableHead>
                    <TableHead>索引时间</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accounts.map((account) => (
                    <TableRow key={account.did} data-state={selected.has(account.did) ? 'selected' : undefined}>
                      <TableCell>
                        <Checkbox
                          aria-label={`选择 ${account.handle ?? account.did}`}
                          checked={selected.has(account.did)}
                          onCheckedChange={(checked) => toggleRow(account.did, checked === true)}
                        />
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/directory/${encodeURIComponent(account.did)}`}
                          className="group block min-w-0"
                        >
                          <p className="text-sm font-medium group-hover:underline">
                            {account.handle ?? '未解析句柄'}
                          </p>
                          <p
                            className="mt-0.5 font-mono text-xs text-muted-foreground"
                            title={account.did}
                          >
                            {truncateDid(account.did, 22, 8)}
                          </p>
                        </Link>
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
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/directory/${encodeURIComponent(account.did)}`}>详情</Link>
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

          <Dialog open={viewOpen} onOpenChange={setViewOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>筛选视图</DialogTitle>
                <DialogDescription>
                  保存常用的筛选与排序组合，仅对你本人生效，最多保存 {MAX_SAVED_VIEWS} 个。
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-2">
                {savedViews.length === 0 ? (
                  <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                    尚未保存视图。设置筛选与排序后，在下方命名并保存。
                  </p>
                ) : (
                  savedViews.map((view) => (
                    <div
                      key={view.id}
                      className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{view.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {describeView(view)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button variant="outline" size="sm" onClick={() => applyView(view)}>
                          应用
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`删除视图 ${view.name}`}
                          onClick={() => void deleteView(view)}
                          disabled={savingPreferences}
                        >
                          <Trash2Icon />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="space-y-2 border-t pt-4">
                <p className="text-xs text-muted-foreground">
                  当前筛选：
                  {debouncedSearch.trim() ? `关键词「${debouncedSearch.trim()}」` : '全部关键词'}
                  {' · '}
                  {statusFilter === 'all' ? '全部状态' : accountStatusLabels[statusFilter]}
                  {' · '}
                  {SORT_OPTIONS.find((option) => option.value === sort)?.label ?? '索引时间从新到旧'}
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={viewName}
                    onChange={(event) => {
                      setViewName(event.target.value)
                      setViewError(null)
                    }}
                    placeholder="视图名称，例如：待核实的停用账号"
                    maxLength={MAX_VIEW_NAME}
                    aria-label="视图名称"
                    disabled={savingPreferences}
                  />
                  <Button onClick={() => void saveCurrentView()} disabled={savingPreferences}>
                    {savingPreferences ? <LoaderCircleIcon className="animate-spin" /> : null}
                    保存当前筛选
                  </Button>
                </div>
                {viewError ? (
                  <p
                    role="alert"
                    className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
                  >
                    {viewError}
                  </p>
                ) : null}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setViewOpen(false)}>
                  关闭
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <p className="text-xs text-muted-foreground">
            账号目录由索引器写入，后台不提供修改入口；账号状态请在官方账号服务或审核后台处理。
          </p>
        </TabsContent>

        {canSearchSignatures ? (
          <TabsContent value="signature">
            <SignatureSearchPanel />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  )
}
