'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeftIcon, HistoryIcon, Link2Icon, ShieldAlertIcon } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { EmptyState, ErrorState, LoadingState } from '@/components/data-state'
import { useAuth } from '@/components/auth/auth-provider'
import { useWorkspace } from '@/components/layout/workspace-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { hasPermission } from '@/lib/access'
import { AdminApiError } from '@/lib/api/admin-client'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type { EventBatchSummary } from '@/lib/data/types'
import { describeAdminError } from '@/lib/errors'
import { formatTimestamp, truncateDid } from '@/lib/format'
import {
  eventTypeLabel,
  isReversibleEvent,
  subjectHref,
  subjectTypeLabels,
  truncateSubject,
} from '@/lib/moderation'

type LoadState = 'loading' | 'ready' | 'not-found' | 'forbidden' | 'error'
type BatchState = 'idle' | 'loading' | 'ready' | 'error'

function pick(record: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
  if (!record) return undefined
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

type EventSummary = {
  eventType?: string
  subject?: string
  subjectType?: string
  createdBy?: string
  creatorHandle?: string
  subjectHandle?: string
  createdAt?: string
  comment?: string
  batchId?: string
  approvalId?: string
  durationInHours?: number
  labels: string[]
}

function summarize(raw: unknown): EventSummary {
  const event = asRecord(raw) ?? {}
  const body = asRecord(event.event) ?? {}
  const subjectRecord = asRecord(event.subject)
  const subject =
    (typeof event.subject === 'string' ? event.subject : undefined) ??
    pick(subjectRecord, 'subject', 'did', 'uri', 'messageId', 'convoId')
  const eventType =
    pick(body, '$type')?.split('#').at(-1) ?? pick(event, 'eventType')
  const labels = Array.isArray(event.labels)
    ? event.labels
        .map((entry) => (typeof entry === 'string' ? entry : pick(asRecord(entry), 'val')))
        .filter((entry): entry is string => Boolean(entry))
    : []
  const duration = body.durationInHours ?? event.durationInHours
  return {
    eventType,
    subject,
    subjectType: pick(subjectRecord, 'type'),
    createdBy: pick(event, 'createdBy'),
    creatorHandle: pick(event, 'creatorHandle'),
    subjectHandle: pick(event, 'subjectHandle'),
    createdAt: pick(event, 'createdAt'),
    comment: pick(body, 'comment') ?? pick(event, 'comment'),
    batchId: pick(body, 'batchId') ?? pick(event, 'batchId'),
    approvalId: pick(body, 'approvalId') ?? pick(event, 'approvalId'),
    durationInHours: typeof duration === 'number' ? duration : undefined,
    labels,
  }
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export default function ModerationEventDetailPage() {
  const params = useParams<{ id: string }>()
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id
  const id = Number.parseInt(rawId ?? '', 10)
  const validId = Number.isInteger(id) && id > 0

  const provider = useDataProvider()
  const { identity } = useAuth()
  const { dateFormat } = useWorkspace()
  const canRead = hasPermission(identity, 'moderation.read')

  const [state, setState] = useState<LoadState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [raw, setRaw] = useState<unknown>(null)
  const [batchState, setBatchState] = useState<BatchState>('idle')
  const [batch, setBatch] = useState<EventBatchSummary | null>(null)
  const [batchError, setBatchError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!canRead || !validId) return
    let active = true
    setState('loading')
    setError(null)
    provider
      .getEvent(id)
      .then((result) => {
        if (!active) return
        setRaw(result.event)
        setState('ready')
      })
      .catch((cause: unknown) => {
        if (!active) return
        if (cause instanceof AdminApiError) {
          if (cause.kind === 'not_found') {
            setState('not-found')
            return
          }
          if (cause.kind === 'forbidden') {
            setState('forbidden')
            return
          }
        }
        setError(describeAdminError(cause))
        setState('error')
      })
    return () => {
      active = false
    }
  }, [provider, canRead, validId, id, reloadToken])

  const summary = state === 'ready' ? summarize(raw) : undefined
  const batchId = summary?.batchId

  useEffect(() => {
    if (!batchId) {
      setBatchState('idle')
      setBatch(null)
      return
    }
    let active = true
    setBatchState('loading')
    setBatchError(null)
    provider
      .getEventBatch(batchId)
      .then((result) => {
        if (!active) return
        setBatch(result)
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
  }, [provider, batchId])

  const subjectHrefValue =
    summary?.subject
      ? subjectHref(
          summary.subject,
          summary.subjectType === 'account' ||
            summary.subjectType === 'record' ||
            summary.subjectType === 'message' ||
            summary.subjectType === 'conversation'
            ? summary.subjectType
            : undefined,
        )
      : null

  if (!canRead) {
    return (
      <div className="space-y-5">
        <PageHeader title="处置记录详情" description="审核动作与处置结果的原始记录。" />
        <Card className="py-0">
          <EmptyState
            icon={ShieldAlertIcon}
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
        title="处置记录详情"
        description="展示单条审核动作的对象、操作人、可逆性与所属批次；原始字段来自审核服务，只读不可修改。"
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/moderation/events">
              <ArrowLeftIcon />
              返回处置记录
            </Link>
          </Button>
        }
      />

      {!validId ? (
        <Card className="py-0">
          <EmptyState
            icon={HistoryIcon}
            title="处置记录编号无效"
            message="请从处置记录列表打开具体记录。"
            action={
              <Button variant="outline" size="sm" asChild>
                <Link href="/moderation/events">返回处置记录</Link>
              </Button>
            }
          />
        </Card>
      ) : state === 'not-found' ? (
        <Card className="py-0">
          <EmptyState
            icon={HistoryIcon}
            title="处置记录不存在"
            message="该记录可能已被删除，或编号输入有误。"
            action={
              <Button variant="outline" size="sm" asChild>
                <Link href="/moderation/events">返回处置记录</Link>
              </Button>
            }
          />
        </Card>
      ) : state === 'forbidden' ? (
        <Card className="py-0">
          <EmptyState
            icon={ShieldAlertIcon}
            title="没有查看该记录的权限"
            message="当前账号缺少审核读取权限，请联系管理员开通后重试。"
          />
        </Card>
      ) : state === 'error' ? (
        <Card>
          <ErrorState
            title="处置记录加载失败"
            message={error ?? '操作失败，请稍后重试。'}
            onRetry={() => setReloadToken((value) => value + 1)}
          />
        </Card>
      ) : state === 'loading' ? (
        <Card>
          <LoadingState label="正在读取处置记录…" />
        </Card>
      ) : summary ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HistoryIcon className="size-4 text-muted-foreground" />
                处置记录 #{id}
              </CardTitle>
              <CardDescription>
                {summary.eventType
                  ? eventTypeLabel(summary.eventType)
                  : '无法识别的处置事件'}
                {summary.eventType ? (
                  <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                    {summary.eventType}
                  </span>
                ) : null}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <dl className="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">处置时间</dt>
                  <dd className="mt-1 text-xs">{formatTimestamp(summary.createdAt, dateFormat)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">操作人</dt>
                  <dd className="mt-1 font-mono text-xs break-all">
                    {summary.createdBy ?? '未知'}
                    {summary.creatorHandle ? (
                      <span className="ml-2 text-muted-foreground">
                        {summary.creatorHandle}
                      </span>
                    ) : null}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">处置对象</dt>
                  <dd className="mt-1 flex flex-wrap items-center gap-2">
                    {summary.subject ? (
                      subjectHrefValue ? (
                        <Link
                          href={subjectHrefValue}
                          className="font-mono text-xs break-all text-primary hover:underline"
                        >
                          {summary.subject}
                        </Link>
                      ) : (
                        <span className="font-mono text-xs break-all">{summary.subject}</span>
                      )
                    ) : (
                      <span className="text-xs text-muted-foreground">未记录处置对象</span>
                    )}
                    {summary.subjectHandle ? (
                      <span className="text-xs text-muted-foreground">
                        {summary.subjectHandle}
                      </span>
                    ) : null}
                    {summary.subjectType === 'account' ||
                    summary.subjectType === 'record' ||
                    summary.subjectType === 'message' ||
                    summary.subjectType === 'conversation' ? (
                      <Badge variant="muted">
                        {subjectTypeLabels[summary.subjectType]}
                      </Badge>
                    ) : null}
                  </dd>
                </div>
                {summary.comment ? (
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-muted-foreground">处置说明</dt>
                    <dd className="mt-1 text-xs leading-relaxed">{summary.comment}</dd>
                  </div>
                ) : null}
                {summary.durationInHours !== undefined ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">处置时长</dt>
                    <dd className="mt-1 text-xs">{summary.durationInHours} 小时</dd>
                  </div>
                ) : null}
                {summary.labels.length ? (
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-muted-foreground">审核标签</dt>
                    <dd className="mt-1 flex flex-wrap gap-1.5">
                      {summary.labels.map((label) => (
                        <Badge key={label} variant="secondary">
                          {label}
                        </Badge>
                      ))}
                    </dd>
                  </div>
                ) : null}
              </dl>

              <div className="rounded-lg border bg-muted/30 p-3 text-xs leading-relaxed">
                {summary.eventType && isReversibleEvent(summary.eventType) ? (
                  <p>
                    该处置可逆：可由具备审核写权限的管理员对同一对象执行解除操作，恢复后将在处置记录中新增一条事件。
                  </p>
                ) : summary.eventType ? (
                  <p>该处置事件不提供反向操作；如需调整对象状态，请使用对应的处置动作。</p>
                ) : (
                  <p>无法识别事件类型，暂不提供可逆性判断。</p>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>审批信息</CardTitle>
                <CardDescription>与本次处置关联的审批编号</CardDescription>
              </CardHeader>
              <CardContent className="text-sm">
                {summary.approvalId ? (
                  <div className="space-y-2">
                    <p className="font-mono text-xs break-all">{summary.approvalId}</p>
                    <Button variant="outline" size="sm" asChild>
                      <Link href="/security?tab=approvals">
                        <Link2Icon />
                        打开审批中心
                      </Link>
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    该处置记录未携带审批编号，通常表示由具备权限的管理员直接执行；审批链路的操作可在审批中心与审计日志中查询。
                  </p>
                )}
                <p className="mt-3 text-xs text-muted-foreground">
                  操作人：{summary.createdBy ? truncateDid(summary.createdBy) : '未知'}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>批次摘要</CardTitle>
                <CardDescription>同一批次产生的处置事件统计</CardDescription>
              </CardHeader>
              <CardContent className="text-sm">
                {!batchId ? (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    该记录不属于任何处置批次。
                  </p>
                ) : batchState === 'loading' ? (
                  <p className="text-xs text-muted-foreground">正在读取批次摘要…</p>
                ) : batchState === 'error' ? (
                  <p role="alert" className="text-xs text-destructive">
                    {batchError ?? '批次摘要加载失败，请稍后重试。'}
                  </p>
                ) : batch ? (
                  <div className="space-y-2 text-xs">
                    <p>批次编号：<span className="font-mono">{batch.batchId}</span></p>
                    <p>
                      事件数量：{batch.scannedEvents} 条
                      {batch.truncated ? '（已截断，仅统计前 500 条）' : ''}
                    </p>
                    <p>
                      时间范围：{formatTimestamp(batch.createdAfter, dateFormat)} 至{' '}
                      {formatTimestamp(batch.createdBefore, dateFormat)}
                    </p>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {batch.typeCounts.map((entry) => (
                        <Badge key={entry.eventType} variant="outline">
                          {eventTypeLabel(entry.eventType)} × {entry.count}
                        </Badge>
                      ))}
                    </div>
                    <Button variant="outline" size="sm" className="mt-2" asChild>
                      <Link href={`/moderation/events?batchId=${encodeURIComponent(batch.batchId)}`}>
                        查看批次内全部记录
                      </Link>
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>

          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>原始记录</CardTitle>
              <CardDescription>审核服务返回的完整字段，仅用于核对</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="max-h-80 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
                {prettyJson(raw)}
              </pre>
              {summary.subject && summary.subjectType === undefined ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  未识别对象的类型，如无法跳转请从审核服务中直接查询：
                  {truncateSubject(summary.subject)}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  )
}
