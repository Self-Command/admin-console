'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { FlagIcon, RotateCcwIcon, SearchIcon } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { EmptyState, ErrorState, LoadingState } from '@/components/data-state'
import { FilterMacroBar } from '@/components/moderation/filter-macro-bar'
import { ReportDetailDialog } from '@/components/moderation/report-detail-dialog'
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
import { useAuth } from '@/components/auth/auth-provider'
import { useWorkspace } from '@/components/layout/workspace-provider'
import { hasPermission } from '@/lib/access'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type {
  ModerationSubjectType,
  QueueView,
  ReportStatus,
  ReportView,
  SortOrder,
} from '@/lib/data/types'
import { describeAdminError } from '@/lib/errors'
import { formatDateTime, truncateDid } from '@/lib/format'
import type { FilterMacroFilters } from '@/lib/runtime/types'
import {
  reportStatusLabels,
  reportStatusVariants,
  reportTypeLabel,
  subjectHref,
  subjectTypeLabels,
  truncateSubject,
} from '@/lib/moderation'

type LoadStatus = 'loading' | 'ready' | 'error'

const SUBJECT_TYPES: ModerationSubjectType[] = ['account', 'record', 'message', 'conversation']

export default function ReportsPage() {
  const provider = useDataProvider()
  const { pageSize } = useWorkspace()
  const { identity } = useAuth()
  const canRead = hasPermission(identity, 'moderation.read')

  const [reports, setReports] = useState<ReportView[]>([])
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const [queues, setQueues] = useState<QueueView[]>([])

  const [statusFilter, setStatusFilter] = useState<'all' | ReportStatus>('open')
  const [queueFilter, setQueueFilter] = useState('all')
  const [subjectTypeFilter, setSubjectTypeFilter] = useState<'all' | ModerationSubjectType>('all')
  const [subjectInput, setSubjectInput] = useState('')
  const [appliedSubject, setAppliedSubject] = useState<string | undefined>()
  const [subjectError, setSubjectError] = useState<string | null>(null)
  const [direction, setDirection] = useState<SortOrder>('desc')

  const [page, setPage] = useState(1)
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined])
  const [nextCursor, setNextCursor] = useState<string | undefined>()

  const [detailId, setDetailId] = useState<number | null>(null)

  useEffect(() => {
    if (!canRead) return
    let active = true
    provider
      .listQueues({ limit: 100 })
      .then((result) => {
        if (!active) return
        setQueues(result.queues)
      })
      .catch(() => {
        if (!active) return
        setQueues([])
      })
    return () => {
      active = false
    }
  }, [provider, canRead])

  useEffect(() => {
    if (!canRead) return
    let active = true
    const cursor = cursors[page - 1]
    setStatus('loading')
    setError(null)
    provider
      .listReports({
        cursor,
        limit: pageSize,
        status: statusFilter === 'all' ? undefined : statusFilter,
        queueId: queueFilter === 'all' ? undefined : Number(queueFilter),
        subjectType: subjectTypeFilter === 'all' ? undefined : subjectTypeFilter,
        subject: appliedSubject,
        sort: 'createdAt',
        direction,
      })
      .then((result) => {
        if (!active) return
        setReports(result.reports)
        setNextCursor(result.cursor)
        setStatus('ready')
      })
      .catch((cause: unknown) => {
        if (!active) return
        setError(describeAdminError(cause))
        setStatus('error')
      })
    return () => {
      active = false
    }
  }, [
    provider,
    canRead,
    pageSize,
    cursors,
    page,
    statusFilter,
    queueFilter,
    subjectTypeFilter,
    appliedSubject,
    direction,
    reloadToken,
  ])

  function resetPaging() {
    setPage(1)
    setCursors([undefined])
  }

  function applySubject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = subjectInput.trim()
    if (
      value &&
      !/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/.test(value) &&
      !value.startsWith('at://')
    ) {
      setSubjectError('请输入账号标识或内容地址，例如 did:plc:… 或 at://…')
      return
    }
    setSubjectError(null)
    setAppliedSubject(value || undefined)
    resetPaging()
  }

  function resetFilters() {
    setStatusFilter('open')
    setQueueFilter('all')
    setSubjectTypeFilter('all')
    setSubjectInput('')
    setAppliedSubject(undefined)
    setSubjectError(null)
    setDirection('desc')
    resetPaging()
  }

  function applyMacroFilters(filters: FilterMacroFilters) {
    setStatusFilter(filters.status ?? 'all')
    setQueueFilter(filters.queue ?? 'all')
    setSubjectTypeFilter(filters.subjectType ?? 'all')
    const subject = filters.subject?.trim() ?? ''
    setSubjectInput(subject)
    setAppliedSubject(subject || undefined)
    setSubjectError(null)
    setDirection(filters.direction ?? 'desc')
    resetPaging()
  }

  const currentFilters: FilterMacroFilters = {
    ...(statusFilter === 'all' ? {} : { status: statusFilter }),
    ...(queueFilter === 'all' ? {} : { queue: queueFilter }),
    ...(subjectTypeFilter === 'all' ? {} : { subjectType: subjectTypeFilter }),
    ...(appliedSubject ? { subject: appliedSubject } : {}),
    ...(direction === 'desc' ? {} : { direction }),
  }

  const hasFilters =
    statusFilter !== 'open' ||
    queueFilter !== 'all' ||
    subjectTypeFilter !== 'all' ||
    appliedSubject !== undefined ||
    direction !== 'desc'

  if (!canRead) {
    return (
      <div className="space-y-5">
        <PageHeader title="举报处理" description="查看并处理用户提交的举报。" />
        <Card className="py-0">
          <EmptyState
            icon={FlagIcon}
            title="没有查看举报的权限"
            message="如需处理举报，请联系管理员开通审核权限。"
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="举报处理"
        description="按状态、队列与对象筛选举报；高风险处置会自动转为审批请求。"
        actions={
          <Badge variant="outline" className="gap-1.5">
            <FlagIcon className="size-3.5" />
            审核服务
          </Badge>
        }
      />

      <Card className="gap-0 py-0">
        <FilterMacroBar scope="reports" current={currentFilters} onApply={applyMacroFilters} />
        <div className="flex flex-col gap-3 border-b p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-start">
            <Select
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value as 'all' | ReportStatus)
                resetPaging()
              }}
              className="lg:w-32"
              aria-label="按举报状态过滤"
            >
              <option value="all">全部状态</option>
              {(Object.keys(reportStatusLabels) as ReportStatus[]).map((item) => (
                <option key={item} value={item}>
                  {reportStatusLabels[item]}
                </option>
              ))}
            </Select>

            <Select
              value={queueFilter}
              onChange={(event) => {
                setQueueFilter(event.target.value)
                resetPaging()
              }}
              className="lg:w-40"
              aria-label="按举报队列过滤"
            >
              <option value="all">全部队列</option>
              {queues.map((queue) => (
                <option key={queue.id} value={queue.id}>
                  {queue.name}
                </option>
              ))}
            </Select>

            <Select
              value={subjectTypeFilter}
              onChange={(event) => {
                setSubjectTypeFilter(event.target.value as 'all' | ModerationSubjectType)
                resetPaging()
              }}
              className="lg:w-32"
              aria-label="按对象类型过滤"
            >
              <option value="all">全部对象</option>
              {SUBJECT_TYPES.map((item) => (
                <option key={item} value={item}>
                  {subjectTypeLabels[item]}
                </option>
              ))}
            </Select>

            <div className="space-y-1">
              <form className="flex items-center gap-1.5" onSubmit={applySubject}>
                <Input
                  value={subjectInput}
                  onChange={(event) => {
                    setSubjectInput(event.target.value)
                    setSubjectError(null)
                  }}
                  placeholder="举报对象"
                  className="font-mono text-xs lg:w-56"
                  aria-label="按举报对象过滤"
                  aria-invalid={subjectError ? true : undefined}
                />
                <Button type="submit" variant="secondary" size="sm" className="h-9">
                  应用
                </Button>
              </form>
              <p
                className={
                  subjectError
                    ? 'text-[11px] text-destructive'
                    : 'text-[11px] text-muted-foreground'
                }
              >
                {subjectError ?? '账号标识或内容地址精确匹配'}
              </p>
            </div>

            <Select
              value={direction}
              onChange={(event) => {
                setDirection(event.target.value as SortOrder)
                resetPaging()
              }}
              className="lg:w-32"
              aria-label="排序方式"
            >
              <option value="desc">最近举报在前</option>
              <option value="asc">最早举报在前</option>
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
            </div>
          </div>
        </div>

        {status === 'error' ? (
          <ErrorState
            title="举报列表加载失败"
            message={error ?? '操作失败，请稍后重试。'}
            onRetry={() => setReloadToken((value) => value + 1)}
          />
        ) : status === 'loading' && reports.length === 0 ? (
          <LoadingState label="正在加载举报…" />
        ) : reports.length === 0 ? (
          <EmptyState
            icon={SearchIcon}
            title="没有匹配的举报"
            message="当前筛选条件下没有举报。可以切换状态或清空过滤条件后再试。"
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
                <TableHead className="w-16">编号</TableHead>
                <TableHead className="w-24">状态</TableHead>
                <TableHead>举报对象</TableHead>
                <TableHead className="w-32">举报类型</TableHead>
                <TableHead className="w-24">队列</TableHead>
                <TableHead className="w-40">举报时间</TableHead>
                <TableHead className="w-32">处理人</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reports.map((report) => {
                const href = subjectHref(report.subject, report.subjectType)
                return (
                  <TableRow key={report.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">
                      #{report.id}
                    </TableCell>
                    <TableCell>
                      <Badge variant={reportStatusVariants[report.status]}>
                        {reportStatusLabels[report.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {href ? (
                          <Link
                            href={href}
                            title={report.subject}
                            className="block max-w-56 truncate font-mono text-xs text-primary hover:underline"
                          >
                            {truncateSubject(report.subject)}
                          </Link>
                        ) : (
                          <span
                            title={report.subject}
                            className="block max-w-56 truncate font-mono text-xs text-muted-foreground"
                          >
                            {truncateSubject(report.subject)}
                          </span>
                        )}
                        {report.subjectHandle ? (
                          <span className="text-[11px] text-muted-foreground">
                            {report.subjectHandle}
                          </span>
                        ) : null}
                        {report.subjectType ? (
                          <Badge variant="muted">{subjectTypeLabels[report.subjectType]}</Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">{reportTypeLabel(report.reportType)}</TableCell>
                    <TableCell className="text-xs tabular-nums">
                      {report.queueId !== undefined ? `#${report.queueId}` : '—'}
                    </TableCell>
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
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDetailId(report.id)}
                      >
                        处理
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
            当前第 {page} 页，本页 {reports.length} 条
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

      <ReportDetailDialog
        reportId={detailId}
        onClose={() => setDetailId(null)}
        onChanged={() => setReloadToken((value) => value + 1)}
      />
    </div>
  )
}
