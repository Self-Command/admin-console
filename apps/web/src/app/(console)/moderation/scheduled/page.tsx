'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { CalendarClockIcon, LoaderCircleIcon, RotateCcwIcon, SearchIcon } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/page-header'
import { EmptyState, ErrorState, LoadingState } from '@/components/data-state'
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
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/components/auth/auth-provider'
import { useWorkspace } from '@/components/layout/workspace-provider'
import { hasPermission } from '@/lib/access'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type { ScheduledActionStatus, ScheduledActionView } from '@/lib/data/types'
import { describeAdminError } from '@/lib/errors'
import { formatDateTime, truncateDid } from '@/lib/format'
import {
  scheduledActionLabel,
  scheduledStatusLabels,
  scheduledStatusVariants,
  subjectHref,
  truncateSubject,
} from '@/lib/moderation'

type LoadStatus = 'loading' | 'ready' | 'error'

const COMMENT_LIMIT = 2000

export default function ScheduledActionsPage() {
  const provider = useDataProvider()
  const { pageSize } = useWorkspace()
  const { identity } = useAuth()
  const canRead = hasPermission(identity, 'moderation.read')
  const canWrite = hasPermission(identity, 'moderation.write')

  const [actions, setActions] = useState<ScheduledActionView[]>([])
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const [statusFilter, setStatusFilter] = useState<'all' | ScheduledActionStatus>('pending')
  const [subjectInput, setSubjectInput] = useState('')
  const [appliedSubject, setAppliedSubject] = useState<string | undefined>()
  const [subjectError, setSubjectError] = useState<string | null>(null)

  const [page, setPage] = useState(1)
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined])
  const [nextCursor, setNextCursor] = useState<string | undefined>()

  const [cancelTarget, setCancelTarget] = useState<ScheduledActionView | null>(null)
  const [comment, setComment] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    if (!canRead) return
    let active = true
    const cursor = cursors[page - 1]
    setStatus('loading')
    setError(null)
    provider
      .listScheduledActions({
        cursor,
        limit: pageSize,
        statuses: statusFilter === 'all' ? undefined : [statusFilter],
        subjects: appliedSubject ? [appliedSubject] : undefined,
      })
      .then((result) => {
        if (!active) return
        setActions(result.actions)
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
    appliedSubject,
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
    setStatusFilter('pending')
    setSubjectInput('')
    setAppliedSubject(undefined)
    setSubjectError(null)
    resetPaging()
  }

  async function confirmCancel() {
    if (!cancelTarget || cancelling) return
    if (comment.trim().length > COMMENT_LIMIT) {
      setFormError(`取消说明不能超过 ${COMMENT_LIMIT} 个字符。`)
      return
    }
    setFormError(null)
    setCancelling(true)
    try {
      await provider.cancelScheduledActions({
        subjects: [cancelTarget.subject],
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      })
      toast.success('已取消该对象的定时处置。')
      setCancelTarget(null)
      setComment('')
      setReloadToken((value) => value + 1)
    } catch (cause) {
      setFormError(describeAdminError(cause))
    } finally {
      setCancelling(false)
    }
  }

  const hasFilters =
    statusFilter !== 'pending' || appliedSubject !== undefined

  if (!canRead) {
    return (
      <div className="space-y-5">
        <PageHeader title="定时处置" description="查看尚未执行的定时处置。" />
        <Card className="py-0">
          <EmptyState
            icon={CalendarClockIcon}
            title="没有查看定时处置的权限"
            message="如需查看或取消定时处置，请联系管理员开通审核权限。"
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="定时处置"
        description="审核服务中尚未执行或已结束的定时动作；取消操作只影响尚未执行的任务。"
        actions={
          <Badge variant="outline" className="gap-1.5">
            <CalendarClockIcon className="size-3.5" />
            定时任务
          </Badge>
        }
      />

      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-3 border-b p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-start">
            <Select
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value as 'all' | ScheduledActionStatus)
                resetPaging()
              }}
              className="lg:w-32"
              aria-label="按状态过滤"
            >
              <option value="all">全部状态</option>
              {(Object.keys(scheduledStatusLabels) as ScheduledActionStatus[]).map((item) => (
                <option key={item} value={item}>
                  {scheduledStatusLabels[item]}
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
            title="定时处置加载失败"
            message={error ?? '操作失败，请稍后重试。'}
            onRetry={() => setReloadToken((value) => value + 1)}
          />
        ) : status === 'loading' && actions.length === 0 ? (
          <LoadingState label="正在加载定时处置…" />
        ) : actions.length === 0 ? (
          <EmptyState
            icon={SearchIcon}
            title="没有匹配的定时处置"
            message="当前筛选条件下没有定时任务。可以切换状态或清空过滤条件后再试。"
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
                <TableHead className="w-28">动作</TableHead>
                <TableHead>处置对象</TableHead>
                <TableHead className="w-24">状态</TableHead>
                <TableHead className="w-40">执行时间</TableHead>
                <TableHead>说明</TableHead>
                <TableHead className="w-32">创建人</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {actions.map((action) => {
                const href = subjectHref(action.subject)
                const failure = action.lastFailureReason
                return (
                  <TableRow key={action.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">
                      #{action.id}
                    </TableCell>
                    <TableCell className="text-sm">{scheduledActionLabel(action.action)}</TableCell>
                    <TableCell>
                      {href ? (
                        <Link
                          href={href}
                          title={action.subject}
                          className="block max-w-56 truncate font-mono text-xs text-primary hover:underline"
                        >
                          {truncateSubject(action.subject)}
                        </Link>
                      ) : (
                        <span
                          title={action.subject}
                          className="block max-w-56 truncate font-mono text-xs text-muted-foreground"
                        >
                          {truncateSubject(action.subject)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={scheduledStatusVariants[action.status]}>
                        {scheduledStatusLabels[action.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                      {action.executeAt
                        ? formatDateTime(action.executeAt)
                        : action.executeAfter
                          ? `不早于 ${formatDateTime(action.executeAfter)}`
                          : '—'}
                    </TableCell>
                    <TableCell className="max-w-56 truncate text-xs text-muted-foreground">
                      {failure ?? action.comment ?? '—'}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      <span title={action.createdBy}>{truncateDid(action.createdBy)}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      {action.status === 'pending' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!canWrite}
                          onClick={() => {
                            setCancelTarget(action)
                            setComment('')
                            setFormError(null)
                          }}
                        >
                          取消
                        </Button>
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

        <div className="flex flex-col gap-2 border-t px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            当前第 {page} 页，本页 {actions.length} 条
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
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open && !cancelling) setCancelTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>取消定时处置</DialogTitle>
            <DialogDescription>
              取消后该对象不再按原计划执行处置；已执行或已取消的任务不受影响。取消动作会写入审计日志。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm">
              处置对象：
              <span className="font-mono text-xs break-all">{cancelTarget?.subject}</span>
            </p>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="scheduled-comment">
                取消说明（可选）
              </label>
              <Textarea
                id="scheduled-comment"
                value={comment}
                onChange={(event) => {
                  setComment(event.target.value)
                  setFormError(null)
                }}
                rows={2}
                maxLength={COMMENT_LIMIT}
                placeholder="说明取消原因，便于后续复核。"
                disabled={cancelling}
              />
            </div>
            {formError ? (
              <p role="alert" className="text-xs text-destructive">
                {formError}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCancelTarget(null)}
              disabled={cancelling}
            >
              关闭
            </Button>
            <Button variant="destructive" onClick={() => void confirmCancel()} disabled={cancelling}>
              {cancelling ? <LoaderCircleIcon className="animate-spin" /> : null}
              确认取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
