'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { ListChecksIcon, RotateCcwIcon, SearchIcon, ShieldAlertIcon } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { EmptyState, ErrorState, LoadingState } from '@/components/data-state'
import { useAuth } from '@/components/auth/auth-provider'
import { useWorkspace } from '@/components/layout/workspace-provider'
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
import { hasPermission } from '@/lib/access'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type {
  ModerationSubjectType,
  ReviewState,
  StatusView,
} from '@/lib/data/types'
import { describeAdminError } from '@/lib/errors'
import { formatTimestamp, truncateDid } from '@/lib/format'
import {
  reviewStateLabels,
  reviewStateVariants,
  subjectHref,
  subjectTypeLabels,
  truncateSubject,
} from '@/lib/moderation'

const DID_PATTERN = /^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

type Filters = {
  subject: string
  subjectType: '' | ModerationSubjectType
  reviewState: '' | ReviewState
  takendown: '' | 'true' | 'false'
  lastReviewedBy: string
  reportedAfter: string
  reportedBefore: string
  reviewedAfter: string
  reviewedBefore: string
}

const EMPTY_FILTERS: Filters = {
  subject: '',
  subjectType: '',
  reviewState: '',
  takendown: '',
  lastReviewedBy: '',
  reportedAfter: '',
  reportedBefore: '',
  reviewedAfter: '',
  reviewedBefore: '',
}

function dayStart(value: string): string | undefined {
  return value ? `${value}T00:00:00.000Z` : undefined
}

function dayEnd(value: string): string | undefined {
  return value ? `${value}T23:59:59.999Z` : undefined
}

export default function ModerationStatusPage() {
  const provider = useDataProvider()
  const { identity } = useAuth()
  const { pageSize, dateFormat } = useWorkspace()
  const canRead = hasPermission(identity, 'moderation.read')

  const initialSubject =
    typeof window === 'undefined'
      ? ''
      : (new URLSearchParams(window.location.search).get('subject') ?? '').trim()
  const initialSubjectValid =
    initialSubject.length > 0 &&
    (DID_PATTERN.test(initialSubject) || initialSubject.startsWith('at://'))

  const [form, setForm] = useState<Filters>(() => ({
    ...EMPTY_FILTERS,
    subject: initialSubject,
  }))
  const [applied, setApplied] = useState<Filters>(() =>
    initialSubjectValid ? { ...EMPTY_FILTERS, subject: initialSubject } : EMPTY_FILTERS,
  )
  const [subjectError, setSubjectError] = useState<string | null>(null)
  const [actorError, setActorError] = useState<string | null>(null)

  const [statuses, setStatuses] = useState<StatusView[]>([])
  const [status, setStatus] = useState<LoadStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const [page, setPage] = useState(1)
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined])
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [submitted, setSubmitted] = useState(initialSubjectValid)

  useEffect(() => {
    if (!canRead || !submitted) return
    let active = true
    const cursor = cursors[page - 1]
    setStatus('loading')
    setError(null)
    provider
      .queryStatuses({
        cursor,
        limit: pageSize,
        subject: applied.subject || undefined,
        subjectType: applied.subjectType || undefined,
        reviewState: applied.reviewState || undefined,
        takendown:
          applied.takendown === '' ? undefined : applied.takendown === 'true',
        lastReviewedBy: applied.lastReviewedBy || undefined,
        reportedAfter: dayStart(applied.reportedAfter),
        reportedBefore: dayEnd(applied.reportedBefore),
        reviewedAfter: dayStart(applied.reviewedAfter),
        reviewedBefore: dayEnd(applied.reviewedBefore),
      })
      .then((result) => {
        if (!active) return
        setStatuses(result.statuses)
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
  }, [provider, canRead, submitted, pageSize, cursors, page, applied, reloadToken])

  function update<K extends keyof Filters>(key: K, value: Filters[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const subject = form.subject.trim()
    const subjectInvalid =
      Boolean(subject) && !DID_PATTERN.test(subject) && !subject.startsWith('at://')
    const actor = form.lastReviewedBy.trim()
    const actorInvalid = Boolean(actor) && !DID_PATTERN.test(actor)
    setSubjectError(
      subjectInvalid ? '请输入账号标识或内容地址，例如 did:plc:… 或 at://…' : null,
    )
    setActorError(actorInvalid ? '请输入完整的账号标识，例如 did:plc:…' : null)
    if (subjectInvalid || actorInvalid) return
    setApplied({ ...form, subject, lastReviewedBy: actor })
    setSubmitted(true)
    setPage(1)
    setCursors([undefined])
  }

  function reset() {
    setForm(EMPTY_FILTERS)
    setApplied(EMPTY_FILTERS)
    setSubjectError(null)
    setActorError(null)
    setSubmitted(false)
    setStatuses([])
    setStatus('idle')
    setPage(1)
    setCursors([undefined])
    setNextCursor(undefined)
  }

  if (!canRead) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="处置状态"
          description="按对象、状态与时间检索当前处置状态。"
        />
        <Card className="py-0">
          <EmptyState
            icon={ShieldAlertIcon}
            title="没有查看处置状态的权限"
            message="如需查看处置状态，请联系管理员开通审核权限。"
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="处置状态"
        description="按对象、审核状态、处置状态与时间检索当前处置结果；状态由审核服务维护，只读不可直接修改。"
        actions={
          <Badge variant="outline" className="gap-1.5">
            <ListChecksIcon className="size-3.5" />
            状态快照
          </Badge>
        }
      />

      <Card className="gap-0 py-0">
        <form className="grid gap-3 border-b p-4 lg:grid-cols-4" onSubmit={submit}>
          <div className="space-y-1 lg:col-span-2">
            <label className="text-xs font-medium" htmlFor="status-subject">
              处置对象
            </label>
            <Input
              id="status-subject"
              value={form.subject}
              onChange={(event) => {
                update('subject', event.target.value)
                setSubjectError(null)
              }}
              placeholder="账号标识或内容地址"
              className="font-mono text-xs"
              aria-invalid={subjectError ? true : undefined}
            />
            {subjectError ? (
              <p className="text-[11px] text-destructive">{subjectError}</p>
            ) : null}
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium" htmlFor="status-subject-type">
              对象类型
            </label>
            <Select
              id="status-subject-type"
              value={form.subjectType}
              onChange={(event) =>
                update('subjectType', event.target.value as Filters['subjectType'])
              }
            >
              <option value="">全部类型</option>
              <option value="account">账号</option>
              <option value="record">内容</option>
              <option value="message">消息</option>
              <option value="conversation">会话</option>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium" htmlFor="status-review-state">
              审核状态
            </label>
            <Select
              id="status-review-state"
              value={form.reviewState}
              onChange={(event) =>
                update('reviewState', event.target.value as Filters['reviewState'])
              }
            >
              <option value="">全部状态</option>
              <option value="open">待处理</option>
              <option value="closed">已结案</option>
              <option value="escalated">已升级</option>
              <option value="none">未审核</option>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium" htmlFor="status-takendown">
              下架状态
            </label>
            <Select
              id="status-takendown"
              value={form.takendown}
              onChange={(event) =>
                update('takendown', event.target.value as Filters['takendown'])
              }
            >
              <option value="">不限</option>
              <option value="true">已下架</option>
              <option value="false">未下架</option>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium" htmlFor="status-reviewer">
              最近审核人
            </label>
            <Input
              id="status-reviewer"
              value={form.lastReviewedBy}
              onChange={(event) => {
                update('lastReviewedBy', event.target.value)
                setActorError(null)
              }}
              placeholder="账号标识"
              className="font-mono text-xs"
              aria-invalid={actorError ? true : undefined}
            />
            {actorError ? (
              <p className="text-[11px] text-destructive">{actorError}</p>
            ) : null}
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium" htmlFor="status-reported-after">
              举报起始日期
            </label>
            <Input
              id="status-reported-after"
              type="date"
              value={form.reportedAfter}
              onChange={(event) => update('reportedAfter', event.target.value)}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium" htmlFor="status-reported-before">
              举报截止日期
            </label>
            <Input
              id="status-reported-before"
              type="date"
              value={form.reportedBefore}
              onChange={(event) => update('reportedBefore', event.target.value)}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium" htmlFor="status-reviewed-after">
              审核起始日期
            </label>
            <Input
              id="status-reviewed-after"
              type="date"
              value={form.reviewedAfter}
              onChange={(event) => update('reviewedAfter', event.target.value)}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium" htmlFor="status-reviewed-before">
              审核截止日期
            </label>
            <Input
              id="status-reviewed-before"
              type="date"
              value={form.reviewedBefore}
              onChange={(event) => update('reviewedBefore', event.target.value)}
            />
          </div>

          <div className="flex items-end justify-end gap-2 lg:col-span-2">
            <Button type="button" variant="ghost" size="sm" onClick={reset}>
              <RotateCcwIcon />
              重置
            </Button>
            <Button type="submit" size="sm">
              <SearchIcon />
              查询
            </Button>
          </div>
        </form>

        {!submitted ? (
          <EmptyState
            icon={ListChecksIcon}
            title="设置条件后查询处置状态"
            message="可按对象、审核状态、下架状态、最近审核人与时间范围组合筛选。"
          />
        ) : status === 'error' ? (
          <ErrorState
            title="处置状态查询失败"
            message={error ?? '操作失败，请稍后重试。'}
            onRetry={() => setReloadToken((value) => value + 1)}
          />
        ) : status === 'loading' && statuses.length === 0 ? (
          <LoadingState label="正在查询处置状态…" />
        ) : statuses.length === 0 ? (
          <EmptyState
            icon={SearchIcon}
            title="没有匹配的处置状态"
            message="调整对象、状态或时间范围后重新查询。"
            action={
              <Button variant="outline" size="sm" onClick={reset}>
                清空筛选条件
              </Button>
            }
          />
        ) : (
          <Table aria-busy={status === 'loading'}>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">编号</TableHead>
                <TableHead>对象</TableHead>
                <TableHead className="w-28">审核状态</TableHead>
                <TableHead className="w-32">处置状态</TableHead>
                <TableHead className="w-20">优先级</TableHead>
                <TableHead className="w-40">最近举报</TableHead>
                <TableHead className="w-40">最近审核</TableHead>
                <TableHead>标签</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {statuses.map((entry) => {
                const href = subjectHref(entry.subject, entry.subjectType)
                return (
                  <TableRow key={entry.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">
                      #{entry.id}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {href ? (
                          <Link
                            href={href}
                            title={entry.subject}
                            className="block max-w-60 truncate font-mono text-xs text-primary hover:underline"
                          >
                            {truncateSubject(entry.subject)}
                          </Link>
                        ) : (
                          <span
                            title={entry.subject}
                            className="block max-w-60 truncate font-mono text-xs text-muted-foreground"
                          >
                            {truncateSubject(entry.subject)}
                          </span>
                        )}
                        {entry.subjectHandle ? (
                          <span className="text-[11px] text-muted-foreground">
                            {entry.subjectHandle}
                          </span>
                        ) : null}
                        {entry.subjectType ? (
                          <Badge variant="muted">
                            {subjectTypeLabels[entry.subjectType]}
                          </Badge>
                        ) : null}
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
                    <TableCell>
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
                )
              })}
            </TableBody>
          </Table>
        )}

        {submitted && statuses.length > 0 ? (
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
        ) : null}
      </Card>
    </div>
  )
}
