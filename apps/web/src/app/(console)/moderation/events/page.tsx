'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { HistoryIcon, LayersIcon, RotateCcwIcon, SearchIcon } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { EmptyState, ErrorState, LoadingState } from '@/components/data-state'
import { FilterMacroBar } from '@/components/moderation/filter-macro-bar'
import {
  ModerationActionDialog,
  type ModerationActionRequest,
} from '@/components/moderation/moderation-action-dialog'
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
import { useAuth } from '@/components/auth/auth-provider'
import { useWorkspace } from '@/components/layout/workspace-provider'
import { hasPermission } from '@/lib/access'
import { moderationActionLabels } from '@/lib/approvals'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type { EventBatchSummary, EventView, ModerationAction, SortOrder } from '@/lib/data/types'
import { describeAdminError } from '@/lib/errors'
import { formatDateTime, truncateDid } from '@/lib/format'
import type { FilterMacroFilters } from '@/lib/runtime/types'
import {
  eventTypeLabel,
  eventTypeOptions,
  moderationActionOptions,
  subjectHref,
  subjectTypeLabels,
  truncateSubject,
} from '@/lib/moderation'

const DID_PATTERN = /^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/

type LoadStatus = 'loading' | 'ready' | 'error'

function prettyJson(value: unknown): string {
  if (value === undefined || value === null) return '—'
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export default function ModerationEventsPage() {
  const provider = useDataProvider()
  const { pageSize } = useWorkspace()
  const { identity } = useAuth()
  const canRead = hasPermission(identity, 'moderation.read')
  const canWrite = hasPermission(identity, 'moderation.write')

  const [events, setEvents] = useState<EventView[]>([])
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const initialSubject =
    typeof window === 'undefined'
      ? ''
      : (new URLSearchParams(window.location.search).get('subject') ?? '').trim()
  const initialBatchId =
    typeof window === 'undefined'
      ? ''
      : (new URLSearchParams(window.location.search).get('batchId') ?? '').trim()

  const [subjectInput, setSubjectInput] = useState(initialSubject)
  const [appliedSubject, setAppliedSubject] = useState<string | undefined>(
    initialSubject || undefined,
  )
  const [subjectError, setSubjectError] = useState<string | null>(null)
  const [actorInput, setActorInput] = useState('')
  const [appliedActor, setAppliedActor] = useState<string | undefined>()
  const [actorError, setActorError] = useState<string | null>(null)
  const [commentInput, setCommentInput] = useState('')
  const [appliedComment, setAppliedComment] = useState<string | undefined>()
  const [batchInput, setBatchInput] = useState(initialBatchId)
  const [appliedBatch, setAppliedBatch] = useState<string | undefined>(
    initialBatchId || undefined,
  )
  const [batchSummary, setBatchSummary] = useState<EventBatchSummary | null>(null)
  const [batchState, setBatchState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [batchError, setBatchError] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState('all')
  const [commentFilter, setCommentFilter] = useState<'all' | 'with' | 'without'>('all')
  const [direction, setDirection] = useState<SortOrder>('desc')

  const [page, setPage] = useState(1)
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined])
  const [nextCursor, setNextCursor] = useState<string | undefined>()

  const [detailEvent, setDetailEvent] = useState<EventView | null>(null)
  const [detailState, setDetailState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [detailRaw, setDetailRaw] = useState<unknown>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [moderationAction, setModerationAction] = useState<ModerationAction>('takedown')
  const [moderationRequest, setModerationRequest] =
    useState<ModerationActionRequest | null>(null)

  useEffect(() => {
    if (!canRead) return
    let active = true
    const cursor = cursors[page - 1]
    setStatus('loading')
    setError(null)
    provider
      .listEvents({
        cursor,
        limit: pageSize,
        subject: appliedSubject,
        createdBy: appliedActor,
        comment: appliedComment,
        types: typeFilter === 'all' ? undefined : [typeFilter],
        hasComment: commentFilter === 'all' ? undefined : commentFilter === 'with',
        direction,
        batchId: appliedBatch,
      })
      .then((result) => {
        if (!active) return
        setEvents(result.events)
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
    appliedSubject,
    appliedActor,
    appliedComment,
    typeFilter,
    commentFilter,
    direction,
    appliedBatch,
    reloadToken,
  ])

  useEffect(() => {
    if (!appliedBatch) {
      setBatchSummary(null)
      setBatchState('idle')
      setBatchError(null)
      return
    }
    let active = true
    setBatchState('loading')
    setBatchError(null)
    provider
      .getEventBatch(appliedBatch)
      .then((result) => {
        if (!active) return
        setBatchSummary(result)
        setBatchState('ready')
      })
      .catch((cause: unknown) => {
        if (!active) return
        setBatchError(describeAdminError(cause))
        setBatchState('error')
      })
    return () => {
      active = false
    }
  }, [provider, appliedBatch])

  useEffect(() => {
    if (!detailEvent) return
    let active = true
    setDetailState('loading')
    setDetailRaw(null)
    setDetailError(null)
    provider
      .getEvent(detailEvent.id)
      .then((result) => {
        if (!active) return
        setDetailRaw(result.event)
        setDetailState('ready')
      })
      .catch((cause: unknown) => {
        if (!active) return
        setDetailError(describeAdminError(cause))
        setDetailState('error')
      })
    return () => {
      active = false
    }
  }, [provider, detailEvent])

  function resetPaging() {
    setPage(1)
    setCursors([undefined])
  }

  function applySubject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = subjectInput.trim()
    if (value && !DID_PATTERN.test(value) && !value.startsWith('at://')) {
      setSubjectError('请输入账号标识或内容地址，例如 did:plc:… 或 at://…')
      return
    }
    setSubjectError(null)
    setAppliedSubject(value || undefined)
    resetPaging()
  }

  function applyActor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = actorInput.trim()
    if (value && !DID_PATTERN.test(value)) {
      setActorError('请输入完整的账号标识，例如 did:plc:…')
      return
    }
    setActorError(null)
    setAppliedActor(value || undefined)
    resetPaging()
  }

  function applyComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAppliedComment(commentInput.trim() || undefined)
    resetPaging()
  }

  function applyBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAppliedBatch(batchInput.trim() || undefined)
    resetPaging()
  }

  function resetFilters() {
    setSubjectInput('')
    setAppliedSubject(undefined)
    setSubjectError(null)
    setActorInput('')
    setAppliedActor(undefined)
    setActorError(null)
    setCommentInput('')
    setAppliedComment(undefined)
    setBatchInput('')
    setAppliedBatch(undefined)
    setTypeFilter('all')
    setCommentFilter('all')
    setDirection('desc')
    resetPaging()
  }

  function applyMacroFilters(filters: FilterMacroFilters) {
    const subject = filters.subject?.trim() ?? ''
    setSubjectInput(subject)
    setAppliedSubject(subject || undefined)
    setSubjectError(null)
    const actor = filters.actor?.trim() ?? ''
    setActorInput(actor)
    setAppliedActor(actor || undefined)
    setActorError(null)
    const comment = filters.keyword ?? ''
    setCommentInput(comment)
    setAppliedComment(comment || undefined)
    const batch = filters.batchId ?? ''
    setBatchInput(batch)
    setAppliedBatch(batch || undefined)
    setTypeFilter(filters.types?.[0] ?? 'all')
    setCommentFilter(
      filters.hasComment === undefined ? 'all' : filters.hasComment ? 'with' : 'without',
    )
    setDirection(filters.direction ?? 'desc')
    resetPaging()
  }

  const currentFilters: FilterMacroFilters = {
    ...(appliedSubject ? { subject: appliedSubject } : {}),
    ...(appliedActor ? { actor: appliedActor } : {}),
    ...(appliedComment ? { keyword: appliedComment } : {}),
    ...(appliedBatch ? { batchId: appliedBatch } : {}),
    ...(typeFilter === 'all' ? {} : { types: [typeFilter] }),
    ...(commentFilter === 'all' ? {} : { hasComment: commentFilter === 'with' }),
    ...(direction === 'desc' ? {} : { direction }),
  }

  const hasFilters =
    appliedSubject !== undefined ||
    appliedActor !== undefined ||
    appliedComment !== undefined ||
    appliedBatch !== undefined ||
    typeFilter !== 'all' ||
    commentFilter !== 'all' ||
    direction !== 'desc'

  if (!canRead) {
    return (
      <div className="space-y-5">
        <PageHeader title="处置记录" description="审核动作与处置结果的时间线。" />
        <Card className="py-0">
          <EmptyState
            icon={HistoryIcon}
            title="没有查看处置记录的权限"
            message="如需查看审核处置记录，请联系管理员开通审核权限。"
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="处置记录"
        description="审核动作、操作人和处置说明的完整时间线，记录只读不可修改。"
        actions={
          <Badge variant="outline" className="gap-1.5">
            <HistoryIcon className="size-3.5" />
            服务端记录
          </Badge>
        }
      />

      <Card className="gap-0 py-0">
        <FilterMacroBar
          scope="events"
          current={currentFilters}
          onApply={applyMacroFilters}
          autoApply={!initialSubject && !initialBatchId}
        />
        <div className="flex flex-col gap-3 border-b p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-start">
            <div className="space-y-1">
              <form className="flex items-center gap-1.5" onSubmit={applySubject}>
                <Input
                  value={subjectInput}
                  onChange={(event) => {
                    setSubjectInput(event.target.value)
                    setSubjectError(null)
                  }}
                  placeholder="处置对象"
                  className="font-mono text-xs lg:w-56"
                  aria-label="按处置对象过滤"
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

            <div className="space-y-1">
              <form className="flex items-center gap-1.5" onSubmit={applyActor}>
                <Input
                  value={actorInput}
                  onChange={(event) => {
                    setActorInput(event.target.value)
                    setActorError(null)
                  }}
                  placeholder="操作人账号标识"
                  className="font-mono text-xs lg:w-52"
                  aria-label="按操作人过滤"
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
                {actorError ?? '按完整账号标识精确匹配'}
              </p>
            </div>

            <form className="flex items-center gap-1.5 self-start" onSubmit={applyComment}>
              <Input
                value={commentInput}
                onChange={(event) => setCommentInput(event.target.value)}
                placeholder="处置说明关键词"
                className="text-xs lg:w-44"
                aria-label="按处置说明过滤"
              />
              <Button type="submit" variant="secondary" size="sm" className="h-9">
                应用
              </Button>
            </form>

            <form className="flex items-center gap-1.5 self-start" onSubmit={applyBatch}>
              <Input
                value={batchInput}
                onChange={(event) => setBatchInput(event.target.value)}
                placeholder="批次编号"
                className="font-mono text-xs lg:w-44"
                aria-label="按批次过滤"
              />
              <Button type="submit" variant="secondary" size="sm" className="h-9">
                应用
              </Button>
            </form>

            <Select
              value={typeFilter}
              onChange={(event) => {
                setTypeFilter(event.target.value)
                resetPaging()
              }}
              className="lg:w-40"
              aria-label="按事件类型过滤"
            >
              <option value="all">全部事件类型</option>
              {eventTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>

            <Select
              value={commentFilter}
              onChange={(event) => {
                setCommentFilter(event.target.value as 'all' | 'with' | 'without')
                resetPaging()
              }}
              className="lg:w-32"
              aria-label="按是否有说明过滤"
            >
              <option value="all">说明不限</option>
              <option value="with">含处置说明</option>
              <option value="without">无处置说明</option>
            </Select>

            <Select
              value={direction}
              onChange={(event) => {
                setDirection(event.target.value as SortOrder)
                resetPaging()
              }}
              className="lg:w-32"
              aria-label="排序方式"
            >
              <option value="desc">最近在前</option>
              <option value="asc">最早在前</option>
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

        {appliedBatch ? (
          <div className="border-b bg-muted/30 px-4 py-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <LayersIcon className="size-3.5 text-muted-foreground" />
              <span className="font-medium">批次 {appliedBatch}</span>
              {batchState === 'loading' ? (
                <span className="text-muted-foreground">正在读取批次摘要…</span>
              ) : batchState === 'error' ? (
                <span role="alert" className="text-destructive">
                  {batchError ?? '批次摘要加载失败，请稍后重试。'}
                </span>
              ) : batchSummary ? (
                <>
                  <span className="text-muted-foreground">
                    共 {batchSummary.scannedEvents} 条事件
                    {batchSummary.truncated ? '（已截断，仅统计前 500 条）' : ''}
                  </span>
                  {batchSummary.typeCounts.map((entry) => (
                    <Badge key={entry.eventType} variant="outline">
                      {eventTypeLabel(entry.eventType)} × {entry.count}
                    </Badge>
                  ))}
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        {status === 'error' ? (
          <ErrorState
            title="处置记录加载失败"
            message={error ?? '操作失败，请稍后重试。'}
            onRetry={() => setReloadToken((value) => value + 1)}
          />
        ) : status === 'loading' && events.length === 0 ? (
          <LoadingState label="正在加载处置记录…" />
        ) : events.length === 0 ? (
          <EmptyState
            icon={SearchIcon}
            title="没有匹配的处置记录"
            message="调整对象、操作人、事件类型或说明关键词后再试。"
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
                <TableHead className="w-20">编号</TableHead>
                <TableHead className="w-36">事件</TableHead>
                <TableHead>对象</TableHead>
                <TableHead>操作人</TableHead>
                <TableHead className="w-40">时间</TableHead>
                <TableHead>处置说明</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => {
                const href = subjectHref(event.subject, event.subjectType)
                return (
                  <TableRow key={event.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">
                      <Link
                        href={`/moderation/events/${event.id}`}
                        className="text-primary hover:underline"
                        title="打开处置记录详情页"
                      >
                        #{event.id}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span className="block text-sm">{eventTypeLabel(event.eventType)}</span>
                      <span className="block font-mono text-[11px] text-muted-foreground">
                        {event.eventType}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {href ? (
                          <Link
                            href={href}
                            title={event.subject}
                            className="block max-w-56 truncate font-mono text-xs text-primary hover:underline"
                          >
                            {truncateSubject(event.subject)}
                          </Link>
                        ) : (
                          <span
                            title={event.subject}
                            className="block max-w-56 truncate font-mono text-xs text-muted-foreground"
                          >
                            {truncateSubject(event.subject)}
                          </span>
                        )}
                        {event.subjectHandle ? (
                          <span className="text-[11px] text-muted-foreground">
                            {event.subjectHandle}
                          </span>
                        ) : null}
                        {event.subjectType ? (
                          <Badge variant="muted">{subjectTypeLabels[event.subjectType]}</Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      <span title={event.createdBy}>{truncateDid(event.createdBy)}</span>
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                      {formatDateTime(event.createdAt)}
                    </TableCell>
                    <TableCell className="max-w-64 truncate text-xs text-muted-foreground">
                      {event.comment ?? '—'}
                    </TableCell>
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
            当前第 {page} 页，本页 {events.length} 条
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

      <Dialog
        open={detailEvent !== null && moderationRequest === null}
        onOpenChange={(open) => {
          if (!open) setDetailEvent(null)
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>处置记录详情</DialogTitle>
            <DialogDescription>
              原始记录来自审核服务，字段只读；如需对该对象继续处置，可在下方直接发起。
            </DialogDescription>
          </DialogHeader>
          {detailEvent ? (
            <div className="max-h-[65vh] space-y-4 overflow-auto pr-1 text-sm">
              <dl className="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">事件</dt>
                  <dd className="mt-1 text-sm">{eventTypeLabel(detailEvent.eventType)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">时间</dt>
                  <dd className="mt-1 text-xs">{formatDateTime(detailEvent.createdAt)}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">对象</dt>
                  <dd className="mt-1 font-mono text-xs break-all">{detailEvent.subject}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">操作人</dt>
                  <dd className="mt-1 font-mono text-xs break-all">{detailEvent.createdBy}</dd>
                </div>
                {detailEvent.comment ? (
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-muted-foreground">处置说明</dt>
                    <dd className="mt-1 text-xs leading-relaxed">{detailEvent.comment}</dd>
                  </div>
                ) : null}
                {detailEvent.labels && detailEvent.labels.length > 0 ? (
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-muted-foreground">标签</dt>
                    <dd className="mt-1 flex flex-wrap gap-1.5">
                      {detailEvent.labels.map((label) => (
                        <Badge key={label} variant="secondary">
                          {label}
                        </Badge>
                      ))}
                    </dd>
                  </div>
                ) : null}
                {detailEvent.durationInHours !== undefined ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">处置时长</dt>
                    <dd className="mt-1 text-xs">{detailEvent.durationInHours} 小时</dd>
                  </div>
                ) : null}
                {detailEvent.reportId !== undefined ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">关联举报</dt>
                    <dd className="mt-1 text-xs">#{detailEvent.reportId}</dd>
                  </div>
                ) : null}
              </dl>

              <div>
                <p className="mb-1 text-xs text-muted-foreground">原始记录</p>
                {detailState === 'loading' ? (
                  <p className="text-xs text-muted-foreground">正在读取原始记录…</p>
                ) : detailState === 'error' ? (
                  <p role="alert" className="text-xs text-destructive">
                    {detailError ?? '原始记录加载失败，请稍后重试。'}
                  </p>
                ) : (
                  <pre className="max-h-52 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
                    {prettyJson(detailRaw)}
                  </pre>
                )}
              </div>

              {canWrite ? (
                <div className="space-y-2 rounded-lg border p-3">
                  <p className="text-sm font-medium">对对象执行处置</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={moderationAction}
                      onChange={(event) =>
                        setModerationAction(event.target.value as ModerationAction)
                      }
                      className="w-44"
                      aria-label="选择处置动作"
                    >
                      {moderationActionOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setModerationRequest({
                          subjects: [detailEvent.subject],
                          action: moderationAction,
                          ...(detailEvent.subjectType
                            ? { subjectType: detailEvent.subjectType }
                            : {}),
                          ...(detailEvent.reportId !== undefined
                            ? { reportId: detailEvent.reportId }
                            : {}),
                        })
                      }
                    >
                      执行{moderationActionLabels[moderationAction]}
                    </Button>
                  </div>
                </div>
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

      <ModerationActionDialog
        request={moderationRequest}
        onClose={() => setModerationRequest(null)}
        onCompleted={() => setReloadToken((value) => value + 1)}
      />
    </div>
  )
}
