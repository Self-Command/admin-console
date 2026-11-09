'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import {
  Columns3Icon,
  DownloadIcon,
  InfoIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
  SearchIcon,
  ShieldAlertIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/page-header'
import { EmptyState, ErrorState, LoadingState } from '@/components/data-state'
import { useWorkspace } from '@/components/layout/workspace-provider'
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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
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
import { AdminApiError } from '@/lib/api/admin-client'
import { auditActionLabel, auditActionOptions, auditResultLabels } from '@/lib/audit'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type { AuditEvent, AuditResult, AuditSort, SortOrder } from '@/lib/data/types'
import { downloadTextFile } from '@/lib/download'
import { describeAdminError } from '@/lib/errors'
import { formatDateTime, truncateDid } from '@/lib/format'

const DID_PATTERN = /^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/
const COLUMN_STORAGE_KEY = 'selfcommand.admin.audit.columns'

type TimeRange = 'all' | '24h' | '7d' | '30d'

const timeRangeLabels: Record<TimeRange, string> = {
  all: '全部时间',
  '24h': '最近 24 小时',
  '7d': '最近 7 天',
  '30d': '最近 30 天',
}

const rangeMs: Record<Exclude<TimeRange, 'all'>, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
}

const resultVariants: Record<AuditResult, 'success' | 'warning' | 'destructive'> = {
  success: 'success',
  denied: 'warning',
  error: 'destructive',
}

type LoadStatus = 'loading' | 'ready' | 'error'
type SortValue = `${AuditSort}:${SortOrder}`

const SORT_OPTIONS: Array<{ value: SortValue; label: string }> = [
  { value: 'createdAt:desc', label: '最近记录在前' },
  { value: 'createdAt:asc', label: '最早记录在前' },
  { value: 'actor:asc', label: '操作者升序' },
  { value: 'actor:desc', label: '操作者降序' },
  { value: 'action:asc', label: '动作升序' },
  { value: 'action:desc', label: '动作降序' },
  { value: 'result:asc', label: '结果升序' },
  { value: 'result:desc', label: '结果降序' },
]

type ColumnKey = 'actor' | 'result' | 'target' | 'detail'

const COLUMN_LABELS: Record<ColumnKey, string> = {
  actor: '操作者',
  result: '结果',
  target: '对象',
  detail: '详情',
}

const DEFAULT_COLUMNS: Record<ColumnKey, boolean> = {
  actor: true,
  result: true,
  target: true,
  detail: true,
}

function readColumns(): Record<ColumnKey, boolean> {
  try {
    const raw = window.localStorage.getItem(COLUMN_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_COLUMNS }
    const value = JSON.parse(raw) as Record<string, unknown>
    return {
      actor: typeof value.actor === 'boolean' ? value.actor : DEFAULT_COLUMNS.actor,
      result: typeof value.result === 'boolean' ? value.result : DEFAULT_COLUMNS.result,
      target: typeof value.target === 'boolean' ? value.target : DEFAULT_COLUMNS.target,
      detail: typeof value.detail === 'boolean' ? value.detail : DEFAULT_COLUMNS.detail,
    }
  } catch {
    return { ...DEFAULT_COLUMNS }
  }
}

function ResultBadge({ result }: { result: AuditResult }) {
  return <Badge variant={resultVariants[result]}>{auditResultLabels[result]}</Badge>
}

function targetHref(event: AuditEvent): string | null {
  if (!event.target || !DID_PATTERN.test(event.target)) return null
  if (event.targetType !== 'role' && event.targetType !== 'account') return null
  return `/directory/${encodeURIComponent(event.target)}`
}

function prettyJson(value: unknown): string {
  if (value === undefined || value === null) return '—'
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export default function AuditPage() {
  const provider = useDataProvider()
  const { features, pageSize } = useWorkspace()

  const [events, setEvents] = useState<AuditEvent[]>([])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [listError, setListError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const [actorInput, setActorInput] = useState('')
  const [appliedActor, setAppliedActor] = useState<string | undefined>()
  const [actorError, setActorError] = useState<string | null>(null)
  const [targetInput, setTargetInput] = useState('')
  const [appliedTarget, setAppliedTarget] = useState<string | undefined>()
  const [targetError, setTargetError] = useState<string | null>(null)
  const [actionFilter, setActionFilter] = useState('all')
  const [resultFilter, setResultFilter] = useState<'all' | AuditResult>('all')
  const [timeRange, setTimeRange] = useState<TimeRange>('all')
  const [since, setSince] = useState<string | undefined>()
  const [sort, setSort] = useState<SortValue>('createdAt:desc')

  const [page, setPage] = useState(1)
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined])
  const [nextCursor, setNextCursor] = useState<string | undefined>()

  const [columns, setColumns] = useState<Record<ColumnKey, boolean>>(() =>
    typeof window === 'undefined' ? { ...DEFAULT_COLUMNS } : readColumns(),
  )
  const [detailEvent, setDetailEvent] = useState<AuditEvent | null>(null)
  const [exporting, setExporting] = useState<'csv' | 'json' | null>(null)

  useEffect(() => {
    try {
      window.localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(columns))
    } catch {
      // Column preferences are a convenience; the table still works without storage.
    }
  }, [columns])

  useEffect(() => {
    let active = true
    const cursor = cursors[page - 1]
    const [sortField, sortOrder] = sort.split(':') as [AuditSort, SortOrder]
    setStatus('loading')
    setListError(null)

    provider
      .listAudit({
        cursor,
        limit: pageSize,
        actor: appliedActor,
        target: appliedTarget,
        action: actionFilter === 'all' ? undefined : actionFilter,
        result: resultFilter === 'all' ? undefined : resultFilter,
        since,
        sort: sortField,
        order: sortOrder,
      })
      .then((result) => {
        if (!active) return
        setEvents(result.events)
        setTotal(result.total)
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
  }, [
    provider,
    cursors,
    page,
    pageSize,
    appliedActor,
    appliedTarget,
    actionFilter,
    resultFilter,
    since,
    sort,
    reloadToken,
  ])

  function reload() {
    setReloadToken((value) => value + 1)
  }

  function resetPaging() {
    setPage(1)
    setCursors([undefined])
  }

  function applyActor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = actorInput.trim()
    if (value && !DID_PATTERN.test(value)) {
      setActorError('请输入完整的账号标识，例如 did:plc:… 或 did:web:…')
      return
    }
    setActorError(null)
    setAppliedActor(value || undefined)
    resetPaging()
  }

  function applyTarget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = targetInput.trim()
    setAppliedTarget(value || undefined)
    setTargetError(null)
    resetPaging()
  }

  function changeTimeRange(range: TimeRange) {
    setTimeRange(range)
    setSince(
      range === 'all' ? undefined : new Date(Date.now() - rangeMs[range]).toISOString(),
    )
    resetPaging()
  }

  function resetFilters() {
    setActorInput('')
    setAppliedActor(undefined)
    setActorError(null)
    setTargetInput('')
    setAppliedTarget(undefined)
    setTargetError(null)
    setActionFilter('all')
    setResultFilter('all')
    setTimeRange('all')
    setSince(undefined)
    setSort('createdAt:desc')
    resetPaging()
  }

  async function handleExport(format: 'csv' | 'json') {
    setExporting(format)
    try {
      const result = await provider.exportAudit({
        format,
        actor: appliedActor,
        target: appliedTarget,
        action: actionFilter === 'all' ? undefined : actionFilter,
        result: resultFilter === 'all' ? undefined : resultFilter,
        since,
      })
      downloadTextFile(result.filename, result.content, result.contentType)
      toast.success(`已导出 ${result.rows} 条审计记录`)
    } catch (error) {
      if (error instanceof AdminApiError && error.code === 'ExportTooLarge') {
        toast.error('导出记录超过上限，请缩小时间范围或增加过滤条件后重试。')
      } else {
        toast.error(describeAdminError(error))
      }
    } finally {
      setExporting(null)
    }
  }

  const pageStart = (page - 1) * pageSize
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const showInitialLoading = status === 'loading' && events.length === 0
  const hasFilters =
    actorInput.trim() !== '' ||
    appliedActor !== undefined ||
    targetInput.trim() !== '' ||
    appliedTarget !== undefined ||
    actionFilter !== 'all' ||
    resultFilter !== 'all' ||
    timeRange !== 'all'

  return (
    <div className="space-y-5">
      <PageHeader
        title="审计日志"
        description="角色变更与越权访问的服务端审计记录，只读且不可修改。"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {features.auditExport ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={exporting !== null}>
                    {exporting ? <LoaderCircleIcon className="animate-spin" /> : <DownloadIcon />}
                    导出
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => void handleExport('csv')}>
                    导出 CSV（表格）
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void handleExport('json')}>
                    导出 JSON（原始记录）
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" aria-label="列显示">
                  <Columns3Icon />
                  列显示
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>显示列</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {(Object.keys(COLUMN_LABELS) as ColumnKey[]).map((key) => (
                  <DropdownMenuCheckboxItem
                    key={key}
                    checked={columns[key]}
                    onCheckedChange={(checked) =>
                      setColumns((current) => ({ ...current, [key]: checked === true }))
                    }
                  >
                    {COLUMN_LABELS[key]}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Badge variant="outline" className="gap-1.5">
              <ShieldAlertIcon className="size-3.5" />
              仅管理员可见
            </Badge>
          </div>
        }
      />

      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-3 border-b p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-start">
            <Select
              value={timeRange}
              onChange={(event) => changeTimeRange(event.target.value as TimeRange)}
              className="lg:w-36"
              aria-label="按时间范围过滤"
            >
              {(Object.keys(timeRangeLabels) as TimeRange[]).map((range) => (
                <option key={range} value={range}>
                  {timeRangeLabels[range]}
                </option>
              ))}
            </Select>

            <div className="space-y-1">
              <form className="flex items-center gap-1.5" onSubmit={applyActor}>
                <Input
                  value={actorInput}
                  onChange={(event) => {
                    setActorInput(event.target.value)
                    setActorError(null)
                  }}
                  placeholder="操作者账号标识"
                  className="font-mono text-xs lg:w-56"
                  aria-label="按操作者账号标识过滤"
                  aria-invalid={actorError ? true : undefined}
                />
                <Button type="submit" variant="secondary" size="sm" className="h-9">
                  应用
                </Button>
              </form>
              <p
                className={
                  actorError
                    ? 'text-[11px] text-destructive'
                    : 'text-[11px] text-muted-foreground'
                }
              >
                {actorError ?? '按完整账号标识精确匹配，回车或“应用”生效'}
              </p>
            </div>

            <div className="space-y-1">
              <form className="flex items-center gap-1.5" onSubmit={applyTarget}>
                <Input
                  value={targetInput}
                  onChange={(event) => {
                    setTargetInput(event.target.value)
                    setTargetError(null)
                  }}
                  placeholder="对象标识或批次号"
                  className="font-mono text-xs lg:w-52"
                  aria-label="按对象标识过滤"
                />
                <Button type="submit" variant="secondary" size="sm" className="h-9">
                  应用
                </Button>
              </form>
              <p className="text-[11px] text-muted-foreground">
                {targetError ?? '按完整对象标识精确匹配'}
              </p>
            </div>

            <Select
              value={actionFilter}
              onChange={(event) => {
                setActionFilter(event.target.value)
                resetPaging()
              }}
              className="lg:w-48"
              aria-label="按动作过滤"
            >
              <option value="all">全部动作</option>
              {auditActionOptions.map((action) => (
                <option key={action} value={action}>
                  {auditActionLabel(action)}
                </option>
              ))}
            </Select>

            <Select
              value={resultFilter}
              onChange={(event) => {
                setResultFilter(event.target.value as 'all' | AuditResult)
                resetPaging()
              }}
              className="lg:w-28"
              aria-label="按结果过滤"
            >
              <option value="all">全部结果</option>
              {(Object.keys(auditResultLabels) as AuditResult[]).map((result) => (
                <option key={result} value={result}>
                  {auditResultLabels[result]}
                </option>
              ))}
            </Select>

            <Select
              value={sort}
              onChange={(event) => {
                setSort(event.target.value as SortValue)
                resetPaging()
              }}
              className="lg:w-40"
              aria-label="排序方式"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>

            <div className="flex items-center gap-2 lg:ml-auto">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={resetFilters}
                disabled={!hasFilters && sort === 'createdAt:desc'}
              >
                <RotateCcwIcon className="size-3.5" />
                重置
              </Button>
              <p className="text-xs text-muted-foreground">共 {total} 条</p>
            </div>
          </div>
        </div>

        {status === 'error' ? (
          <ErrorState
            title="审计日志加载失败"
            message={listError ?? '操作失败，请稍后重试。'}
            onRetry={reload}
          />
        ) : showInitialLoading ? (
          <LoadingState label="正在加载审计记录…" />
        ) : events.length === 0 ? (
          <EmptyState
            icon={SearchIcon}
            title="没有匹配的审计记录"
            message="调整时间范围、操作者、对象、动作或结果后再试。"
            action={
              hasFilters ? (
                <Button variant="outline" size="sm" onClick={resetFilters}>
                  清空过滤条件
                </Button>
              ) : null
            }
          />
        ) : (
          <Table aria-busy={status === 'loading'}>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">时间</TableHead>
                <TableHead>动作</TableHead>
                {columns.actor ? <TableHead>操作者</TableHead> : null}
                {columns.result ? <TableHead className="w-20">结果</TableHead> : null}
                {columns.target ? <TableHead>对象</TableHead> : null}
                {columns.detail ? <TableHead>详情</TableHead> : null}
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => {
                const href = targetHref(event)
                return (
                  <TableRow key={event.id}>
                    <TableCell className="font-mono text-xs whitespace-nowrap text-muted-foreground">
                      {formatDateTime(event.createdAt)}
                    </TableCell>
                    <TableCell>
                      <span className="block text-sm">{auditActionLabel(event.action)}</span>
                      <span className="block font-mono text-[11px] text-muted-foreground">
                        {event.action}
                      </span>
                    </TableCell>
                    {columns.actor ? (
                      <TableCell>
                        <span
                          title={event.actor}
                          className="block max-w-44 truncate font-mono text-xs text-muted-foreground"
                        >
                          {truncateDid(event.actor)}
                        </span>
                      </TableCell>
                    ) : null}
                    {columns.result ? (
                      <TableCell>
                        <ResultBadge result={event.result} />
                      </TableCell>
                    ) : null}
                    {columns.target ? (
                      <TableCell>
                        {event.target ? (
                          href ? (
                            <Link
                              href={href}
                              className="block max-w-52 truncate font-mono text-xs text-primary hover:underline"
                              title={event.target}
                            >
                              {truncateDid(event.target)}
                            </Link>
                          ) : (
                            <span
                              title={event.target}
                              className="block max-w-52 truncate font-mono text-xs text-muted-foreground"
                            >
                              {truncateDid(event.target)}
                            </span>
                          )
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    ) : null}
                    {columns.detail ? (
                      <TableCell className="max-w-64 truncate text-xs text-muted-foreground">
                        {event.detail ?? '—'}
                      </TableCell>
                    ) : null}
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setDetailEvent(event)}>
                        详情
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}

        <div className="flex flex-col gap-2 border-t px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            共 {total} 条记录
            {total > 0 ? `，第 ${pageStart + 1}–${pageStart + events.length} 条` : ''}
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

      <Dialog
        open={detailEvent !== null}
        onOpenChange={(open) => {
          if (!open) setDetailEvent(null)
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>审计记录详情</DialogTitle>
            <DialogDescription>
              服务端记录不可修改；请求标识可用于与服务日志核对。
            </DialogDescription>
          </DialogHeader>
          {detailEvent ? (
            <div className="max-h-[65vh] space-y-4 overflow-auto pr-1 text-sm">
              <dl className="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">时间</dt>
                  <dd className="mt-1 text-xs">{formatDateTime(detailEvent.createdAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">结果</dt>
                  <dd className="mt-1">
                    <ResultBadge result={detailEvent.result} />
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">动作</dt>
                  <dd className="mt-1">
                    {auditActionLabel(detailEvent.action)}
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      {detailEvent.action}
                    </span>
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">操作者</dt>
                  <dd className="mt-1 font-mono text-xs break-all">{detailEvent.actor}</dd>
                </div>
                {detailEvent.targetType || detailEvent.target ? (
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-muted-foreground">对象</dt>
                    <dd className="mt-1 font-mono text-xs break-all">
                      {detailEvent.targetType ? `${detailEvent.targetType} · ` : ''}
                      {detailEvent.target ?? '—'}
                    </dd>
                  </div>
                ) : null}
                <div>
                  <dt className="text-xs text-muted-foreground">请求标识</dt>
                  <dd className="mt-1 font-mono text-xs break-all">
                    {detailEvent.requestId ?? '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">来源地址</dt>
                  <dd className="mt-1 font-mono text-xs break-all">
                    {detailEvent.actorIp ?? '—'}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">客户端</dt>
                  <dd className="mt-1 font-mono text-xs break-all">
                    {detailEvent.userAgent ?? '—'}
                  </dd>
                </div>
                {detailEvent.detail ? (
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-muted-foreground">说明</dt>
                    <dd className="mt-1 text-xs">{detailEvent.detail}</dd>
                  </div>
                ) : null}
              </dl>

              <div className="grid gap-3">
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">变更前</p>
                  <pre className="max-h-40 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
                    {prettyJson(detailEvent.before)}
                  </pre>
                </div>
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">变更后</p>
                  <pre className="max-h-40 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
                    {prettyJson(detailEvent.after)}
                  </pre>
                </div>
              </div>

              {targetHref(detailEvent) ? (
                <Button variant="outline" size="sm" asChild>
                  <Link href={targetHref(detailEvent) ?? '/directory'}>查看对象详情</Link>
                </Button>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailEvent(null)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
        审计记录由服务端写入，保留策略以部署配置为准；导出前请确认筛选范围。
      </p>
    </div>
  )
}
