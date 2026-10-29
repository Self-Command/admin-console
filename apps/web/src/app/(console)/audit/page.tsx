'use client'

import { useEffect, useState, type FormEvent } from 'react'
import {
  InfoIcon,
  RotateCcwIcon,
  SearchIcon,
  ShieldAlertIcon,
} from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { EmptyState, ErrorState, LoadingState } from '@/components/data-state'
import { useAuth } from '@/components/auth/auth-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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
import { auditActionLabel, auditActionOptions, auditResultLabels } from '@/lib/audit'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type { AuditEvent, AuditResult } from '@/lib/data/types'
import { describeAdminError } from '@/lib/errors'
import { formatDateTime, truncateDid } from '@/lib/format'

const PAGE_SIZE = 10
const DID_PATTERN = /^did:(plc|web):[A-Za-z0-9._:%-]+$/

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

function ResultBadge({ result }: { result: AuditResult }) {
  return <Badge variant={resultVariants[result]}>{auditResultLabels[result]}</Badge>
}

export default function AuditPage() {
  const provider = useDataProvider()
  const { preview } = useAuth()

  const [events, setEvents] = useState<AuditEvent[]>([])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [listError, setListError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const [actorInput, setActorInput] = useState('')
  const [appliedActor, setAppliedActor] = useState<string | undefined>()
  const [actorError, setActorError] = useState<string | null>(null)
  const [actionFilter, setActionFilter] = useState('all')
  const [resultFilter, setResultFilter] = useState<'all' | AuditResult>('all')
  const [timeRange, setTimeRange] = useState<TimeRange>('all')
  const [since, setSince] = useState<string | undefined>()

  const [page, setPage] = useState(1)
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined])
  const [nextCursor, setNextCursor] = useState<string | undefined>()

  useEffect(() => {
    let active = true
    const cursor = cursors[page - 1]
    setStatus('loading')
    setListError(null)

    provider
      .listAudit({
        cursor,
        limit: PAGE_SIZE,
        actor: appliedActor,
        action: actionFilter === 'all' ? undefined : actionFilter,
        result: resultFilter === 'all' ? undefined : resultFilter,
        since,
      })
      .then((result) => {
        if (!active) return
        setEvents(result.events)
        setTotal(result.total)
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
  }, [provider, cursors, page, appliedActor, actionFilter, resultFilter, since, reloadToken])

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
      setActorError('请输入完整 DID，例如 did:plc:… 或 did:web:…')
      return
    }
    setActorError(null)
    setAppliedActor(value || undefined)
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
    setActionFilter('all')
    setResultFilter('all')
    setTimeRange('all')
    setSince(undefined)
    resetPaging()
  }

  const pageStart = (page - 1) * PAGE_SIZE
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const showInitialLoading = status === 'loading' && events.length === 0
  const hasFilters =
    actorInput.trim() !== '' ||
    appliedActor !== undefined ||
    actionFilter !== 'all' ||
    resultFilter !== 'all' ||
    timeRange !== 'all'

  return (
    <div className="space-y-5">
      <PageHeader
        title="审计日志"
        description="角色变更与越权访问的服务端审计记录，只读且不可修改。"
        actions={
          <Badge variant="outline" className="gap-1.5">
            <ShieldAlertIcon className="size-3.5" />
            仅管理员可见
          </Badge>
        }
      />

      {preview ? (
        <div className="flex items-start gap-2 rounded-lg border border-dashed bg-muted/40 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          <InfoIcon className="mt-0.5 size-4 shrink-0" />
          界面预览：审计记录来自本地夹具。使用 PDS 账号登录后由 admin-api 按服务端角色校验并返回真实审计数据。
        </div>
      ) : null}

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
                  placeholder="操作者 DID（完整）"
                  className="font-mono text-xs lg:w-60"
                  aria-label="按操作者 DID 过滤"
                  aria-invalid={actorError ? true : undefined}
                />
                <Button type="submit" variant="secondary" size="sm" className="h-9">
                  应用
                </Button>
              </form>
              <p className={actorError ? 'text-[11px] text-destructive' : 'text-[11px] text-muted-foreground'}>
                {actorError ?? '按完整 DID 精确匹配，回车或“应用”生效'}
              </p>
            </div>

            <Select
              value={actionFilter}
              onChange={(event) => {
                setActionFilter(event.target.value)
                resetPaging()
              }}
              className="lg:w-52"
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

            <div className="flex items-center gap-2 lg:ml-auto">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={resetFilters}
                disabled={!hasFilters}
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
            message="调整时间范围、操作者、动作或结果后再试。"
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
                <TableHead>操作者</TableHead>
                <TableHead className="w-20">结果</TableHead>
                <TableHead>对象与详情</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
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
                  <TableCell>
                    <span
                      title={event.actor}
                      className="block max-w-44 truncate font-mono text-xs text-muted-foreground"
                    >
                      {truncateDid(event.actor)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <ResultBadge result={event.result} />
                  </TableCell>
                  <TableCell>
                    {event.target ? (
                      <span
                        title={event.target}
                        className="block max-w-64 truncate font-mono text-xs text-muted-foreground"
                      >
                        {truncateDid(event.target)}
                      </span>
                    ) : null}
                    <span className="block text-xs text-muted-foreground">
                      {event.detail ?? '—'}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <div className="flex flex-col gap-2 border-t px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            共 {total} 条记录
            {total > 0 ? `，第 ${pageStart + 1}–${pageStart + events.length} 条` : ''}
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
    </div>
  )
}
