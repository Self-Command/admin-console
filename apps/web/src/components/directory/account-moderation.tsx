'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import {
  ActivityIcon,
  FlagIcon,
  HistoryIcon,
  ListChecksIcon,
  RefreshCwIcon,
} from 'lucide-react'
import { EmptyState, ErrorState, LoadingState } from '@/components/data-state'
import { useWorkspace } from '@/components/layout/workspace-provider'
import { ReportDetailDialog } from '@/components/moderation/report-detail-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type {
  AccountModerationResult,
  EventView,
  ReportView,
  StatusView,
} from '@/lib/data/types'
import { AdminApiError } from '@/lib/api/admin-client'
import { describeAdminError } from '@/lib/errors'
import { formatDateTime, formatNumber, formatTimestamp, truncateDid } from '@/lib/format'
import {
  eventTypeLabel,
  reportStatusLabels,
  reportStatusVariants,
  reportTypeLabel,
  reviewStateLabels,
  reviewStateVariants,
  subjectTypeLabels,
} from '@/lib/moderation'

type PanelState = 'loading' | 'ready' | 'error'

const REVIEW_STATE_LABELS: Record<string, string> = {
  reviewed: '已审核',
  escalated: '已升级',
  pending: '待审核',
  dismissed: '已驳回',
}

function reviewStateLabel(value?: string): string | null {
  if (!value) return null
  return REVIEW_STATE_LABELS[value] ?? '已标记审核状态'
}

function useAccountModeration(did: string, reloadToken: number) {
  const provider = useDataProvider()
  const [state, setState] = useState<PanelState>('loading')
  const [result, setResult] = useState<AccountModerationResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setState('loading')
    setError(null)
    provider
      .getAccountModeration(did)
      .then((value) => {
        if (!active) return
        setResult(value)
        setState('ready')
      })
      .catch((cause: unknown) => {
        if (!active) return
        setError(describeAdminError(cause))
        setState('error')
      })
    return () => {
      active = false
    }
  }, [provider, did, reloadToken])

  return { state, result, error }
}

export function AccountModerationOverviewCard({ did }: { did: string }) {
  const [reloadToken, setReloadToken] = useState(0)
  const { state, result, error } = useAccountModeration(did, reloadToken)
  const overview = result?.overview
  const reviewState = reviewStateLabel(overview?.reviewState)

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <ActivityIcon className="size-4 text-muted-foreground" />
            审核概览
          </CardTitle>
          <CardDescription>来自审核后台的账号状态与近期处置摘要。</CardDescription>
        </div>
        {state === 'ready' ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setReloadToken((value) => value + 1)}
          >
            <RefreshCwIcon className="size-3.5" />
            刷新
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {state === 'loading' ? (
          <p className="text-sm text-muted-foreground">正在读取审核概览…</p>
        ) : state === 'error' ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-destructive">
              {error ?? '审核概览加载失败，请稍后重试。'}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReloadToken((value) => value + 1)}
            >
              重试
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={overview?.takendown ? 'destructive' : 'success'}>
                {overview?.takendown ? '账号已下架' : '账号未下架'}
              </Badge>
              <Badge variant={overview?.muted ? 'warning' : 'outline'}>
                {overview?.muted ? '账号已禁言' : '账号未禁言'}
              </Badge>
              {reviewState ? <Badge variant="secondary">{reviewState}</Badge> : null}
              {(overview?.labels ?? []).map((label) => (
                <Badge key={label} variant="muted">
                  {label}
                </Badge>
              ))}
            </div>

            <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">处置记录数</dt>
                <dd className="mt-1 tabular-nums">
                  {overview?.eventCount !== undefined
                    ? formatNumber(overview.eventCount)
                    : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">待处理举报</dt>
                <dd className="mt-1 tabular-nums">
                  {overview?.openReportCount !== undefined
                    ? formatNumber(overview.openReportCount)
                    : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">最近审核时间</dt>
                <dd className="mt-1 text-xs">{formatDateTime(overview?.lastReviewedAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">最近被举报时间</dt>
                <dd className="mt-1 text-xs">{formatDateTime(overview?.lastReportedAt)}</dd>
              </div>
            </dl>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function PanelShell({
  icon,
  title,
  description,
  href,
  linkLabel,
  children,
}: {
  icon: ReactNode
  title: string
  description: string
  href: string
  linkLabel: string
  children: ReactNode
}) {
  return (
    <Card className="py-0">
      <CardHeader className="flex-row items-start justify-between gap-4 px-4 pt-4 pb-2">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-sm">
            {icon}
            {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href={href}>{linkLabel}</Link>
        </Button>
      </CardHeader>
      <CardContent className="px-0 pb-0">{children}</CardContent>
    </Card>
  )
}

export function AccountEventsPanel({ did }: { did: string }) {
  const provider = useDataProvider()
  const [state, setState] = useState<PanelState>('loading')
  const [events, setEvents] = useState<EventView[]>([])
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let active = true
    setState('loading')
    setError(null)
    provider
      .listEvents({ did, limit: 20 })
      .then((value) => {
        if (!active) return
        setEvents(value.events)
        setState('ready')
      })
      .catch((cause: unknown) => {
        if (!active) return
        setError(describeAdminError(cause))
        setState('error')
      })
    return () => {
      active = false
    }
  }, [provider, did, reloadToken])

  return (
    <PanelShell
      icon={<HistoryIcon className="size-4 text-muted-foreground" />}
      title="处置记录"
      description="该账号最近 20 条审核处置与事件。"
      href={`/moderation/events?subject=${encodeURIComponent(did)}`}
      linkLabel="查看全部"
    >
      {state === 'loading' ? (
        <LoadingState label="正在加载处置记录…" />
      ) : state === 'error' ? (
        <ErrorState
          title="处置记录加载失败"
          message={error ?? '操作失败，请稍后重试。'}
          onRetry={() => setReloadToken((value) => value + 1)}
        />
      ) : events.length === 0 ? (
        <EmptyState
          icon={HistoryIcon}
          title="暂无处置记录"
          message="该账号还没有审核处置记录。产生处置后会自动记录在这里。"
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">类型</TableHead>
              <TableHead className="w-40">时间</TableHead>
              <TableHead className="w-32">操作人</TableHead>
              <TableHead>备注</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event) => (
              <TableRow key={event.id}>
                <TableCell className="pl-4 text-xs">
                  <span className="font-medium">{eventTypeLabel(event.eventType)}</span>
                </TableCell>
                <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                  {formatDateTime(event.createdAt)}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {event.creatorHandle ?? truncateDid(event.createdBy)}
                </TableCell>
                <TableCell className="max-w-64 truncate text-xs text-muted-foreground">
                  {event.comment ?? '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </PanelShell>
  )
}

export function AccountReportsPanel({ did }: { did: string }) {
  const provider = useDataProvider()
  const [state, setState] = useState<PanelState>('loading')
  const [reports, setReports] = useState<ReportView[]>([])
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [detailId, setDetailId] = useState<number | null>(null)

  useEffect(() => {
    let active = true
    setState('loading')
    setError(null)
    provider
      .listReports({ did, limit: 20, sort: 'createdAt', direction: 'desc' })
      .then((value) => {
        if (!active) return
        setReports(value.reports)
        setState('ready')
      })
      .catch((cause: unknown) => {
        if (!active) return
        setError(describeAdminError(cause))
        setState('error')
      })
    return () => {
      active = false
    }
  }, [provider, did, reloadToken])

  return (
    <PanelShell
      icon={<FlagIcon className="size-4 text-muted-foreground" />}
      title="举报记录"
      description="该账号最近 20 条举报及处理状态。"
      href={`/moderation/reports?subject=${encodeURIComponent(did)}`}
      linkLabel="查看全部"
    >
      {state === 'loading' ? (
        <LoadingState label="正在加载举报记录…" />
      ) : state === 'error' ? (
        <ErrorState
          title="举报记录加载失败"
          message={error ?? '操作失败，请稍后重试。'}
          onRetry={() => setReloadToken((value) => value + 1)}
        />
      ) : reports.length === 0 ? (
        <EmptyState
          icon={FlagIcon}
          title="暂无举报记录"
          message="该账号还没有被举报的记录。收到举报后会显示在这里。"
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16 pl-4">编号</TableHead>
              <TableHead className="w-24">状态</TableHead>
              <TableHead className="w-32">举报类型</TableHead>
              <TableHead className="w-40">举报时间</TableHead>
              <TableHead className="w-32">处理人</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reports.map((report) => (
              <TableRow key={report.id}>
                <TableCell className="pl-4 font-mono text-xs text-muted-foreground tabular-nums">
                  #{report.id}
                </TableCell>
                <TableCell>
                  <Badge variant={reportStatusVariants[report.status]}>
                    {reportStatusLabels[report.status]}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs">{reportTypeLabel(report.reportType)}</TableCell>
                <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                  {formatDateTime(report.createdAt)}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {report.assignedTo ? (
                    <span title={report.assignedTo}>{truncateDid(report.assignedTo)}</span>
                  ) : (
                    '未分配'
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => setDetailId(report.id)}>
                    处理
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <ReportDetailDialog
        reportId={detailId}
        onClose={() => setDetailId(null)}
        onChanged={() => setReloadToken((value) => value + 1)}
      />
    </PanelShell>
  )
}

type StatusPanelState = PanelState | 'forbidden'

export function AccountStatusPanel({ did }: { did: string }) {
  const provider = useDataProvider()
  const { pageSize, dateFormat } = useWorkspace()
  const [state, setState] = useState<StatusPanelState>('loading')
  const [statuses, setStatuses] = useState<StatusView[]>([])
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [page, setPage] = useState(1)
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined])
  const [nextCursor, setNextCursor] = useState<string | undefined>()

  useEffect(() => {
    let active = true
    const cursor = cursors[page - 1]
    setState('loading')
    setError(null)
    provider
      .queryStatuses({ subject: did, limit: pageSize, cursor })
      .then((value) => {
        if (!active) return
        setStatuses(value.statuses)
        setNextCursor(value.cursor)
        setState('ready')
      })
      .catch((cause: unknown) => {
        if (!active) return
        if (
          cause instanceof AdminApiError &&
          (cause.kind === 'forbidden' || cause.kind === 'unauthorized')
        ) {
          setState('forbidden')
          return
        }
        setError(describeAdminError(cause))
        setState('error')
      })
    return () => {
      active = false
    }
  }, [provider, did, pageSize, cursors, page, reloadToken])

  return (
    <PanelShell
      icon={<ListChecksIcon className="size-4 text-muted-foreground" />}
      title="处置对象"
      description="该账号在审核服务中的处置状态快照，包含审核状态、下架与禁言情况。"
      href={`/moderation/status?subject=${encodeURIComponent(did)}`}
      linkLabel="在处置状态中查看"
    >
      {state === 'loading' && statuses.length === 0 ? (
        <LoadingState label="正在加载处置状态…" />
      ) : state === 'forbidden' ? (
        <EmptyState
          icon={ListChecksIcon}
          title="没有查看处置状态的权限"
          message="如需查看该账号的处置状态，请联系管理员开通审核权限。"
        />
      ) : state === 'error' ? (
        <ErrorState
          title="处置状态加载失败"
          message={error ?? '操作失败，请稍后重试。'}
          onRetry={() => setReloadToken((value) => value + 1)}
        />
      ) : statuses.length === 0 ? (
        <EmptyState
          icon={ListChecksIcon}
          title="暂无处置状态"
          message="该账号在审核服务中还没有处置状态记录。产生举报或处置后会显示在这里。"
        />
      ) : (
        <>
          <Table aria-busy={state === 'loading'}>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">对象</TableHead>
                <TableHead className="w-24">审核状态</TableHead>
                <TableHead className="w-32">处置状态</TableHead>
                <TableHead className="w-20">优先级</TableHead>
                <TableHead className="w-40">最近举报</TableHead>
                <TableHead className="w-40">最近审核</TableHead>
                <TableHead className="pr-4">标签</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {statuses.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="pl-4">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {entry.subjectType ? (
                        <Badge variant="muted">
                          {subjectTypeLabels[entry.subjectType]}
                        </Badge>
                      ) : null}
                      <span
                        title={entry.subject}
                        className="block max-w-48 truncate font-mono text-xs text-muted-foreground"
                      >
                        {entry.subjectHandle ?? entry.subject}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={reviewStateVariants[entry.reviewState]}>
                      {reviewStateLabels[entry.reviewState]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {entry.takendown ? <Badge variant="destructive">已下架</Badge> : null}
                      {entry.muted ? <Badge variant="warning">禁言中</Badge> : null}
                      {!entry.takendown && !entry.muted ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs tabular-nums">
                    {entry.priorityScore ?? '—'}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                    {formatTimestamp(entry.lastReportedAt, dateFormat)}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                    <span>{formatTimestamp(entry.lastReviewedAt, dateFormat)}</span>
                    {entry.lastReviewedBy ? (
                      <span
                        className="block font-mono text-[11px]"
                        title={entry.lastReviewedBy}
                      >
                        {truncateDid(entry.lastReviewedBy)}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="pr-4">
                    {entry.tags && entry.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {entry.tags.map((tag) => (
                          <Badge key={tag} variant="secondary">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex flex-col gap-2 border-t px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>
              当前第 {page} 页，本页 {statuses.length} 条
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2"
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                disabled={page <= 1 || state === 'loading'}
              >
                上一页
              </Button>
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
                disabled={!nextCursor || state === 'loading'}
              >
                下一页
              </Button>
            </div>
          </div>
        </>
      )}
    </PanelShell>
  )
}
