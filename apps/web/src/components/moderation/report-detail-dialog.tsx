'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { LoaderCircleIcon, ShieldAlertIcon } from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState, ErrorState, LoadingState } from '@/components/data-state'
import {
  ModerationActionDialog,
  type ModerationActionRequest,
} from '@/components/moderation/moderation-action-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { Textarea } from '@/components/ui/textarea'
import { hasPermission } from '@/lib/access'
import { moderationActionLabels } from '@/lib/approvals'
import { useAuth } from '@/components/auth/auth-provider'
import { AdminApiError } from '@/lib/api/admin-client'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type { ModerationAction, ReportAction, ReportGetResult } from '@/lib/data/types'
import { describeAdminError } from '@/lib/errors'
import { formatDateTime, truncateDid } from '@/lib/format'
import {
  moderationActionOptions,
  reportActionLabels,
  reportStatusLabels,
  reportStatusVariants,
  reportTypeLabel,
  subjectHref,
  subjectTypeLabels,
} from '@/lib/moderation'

const COMMENT_LIMIT = 2000

type DetailState = 'loading' | 'ready' | 'error'

const ACTION_SUCCESS: Record<ReportAction, string> = {
  assign: '举报已分配给处理人。',
  unassign: '已取消举报分配。',
  close: '举报已结案。',
  escalate: '举报已升级处理。',
  reopen: '举报已重新打开。',
}

export function ReportDetailDialog({
  reportId,
  onClose,
  onChanged,
}: {
  reportId: number | null
  onClose: () => void
  onChanged?: () => void
}) {
  const provider = useDataProvider()
  const { identity } = useAuth()
  const canWrite = hasPermission(identity, 'moderation.write')

  const [state, setState] = useState<DetailState>('loading')
  const [detail, setDetail] = useState<ReportGetResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const [action, setAction] = useState<ReportAction | null>(null)
  const [comment, setComment] = useState('')
  const [assignee, setAssignee] = useState('')
  const [scope, setScope] = useState<'current' | 'all' | 'types'>('current')
  const [reportTypes, setReportTypes] = useState('')
  const [acting, setActing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const [moderationAction, setModerationAction] = useState<ModerationAction>('takedown')
  const [moderationRequest, setModerationRequest] =
    useState<ModerationActionRequest | null>(null)

  useEffect(() => {
    if (reportId === null) return
    let active = true
    setState('loading')
    setError(null)
    setDetail(null)
    setAction(null)
    setComment('')
    setAssignee('')
    setScope('current')
    setReportTypes('')
    setActionError(null)
    provider
      .getReport(reportId)
      .then((result) => {
        if (!active) return
        setDetail(result)
        setState('ready')
      })
      .catch((cause: unknown) => {
        if (!active) return
        setError(
          cause instanceof AdminApiError && cause.kind === 'not_found'
            ? '该举报不存在，可能已被其他管理员删除。'
            : describeAdminError(cause),
        )
        setState('error')
      })
    return () => {
      active = false
    }
  }, [provider, reportId, reloadToken])

  const report = detail?.report
  const href = report ? subjectHref(report.subject, report.subjectType) : null

  async function submitAction() {
    if (!report || !action || acting) return
    if (comment.trim().length > COMMENT_LIMIT) {
      setActionError(`处理说明不能超过 ${COMMENT_LIMIT} 个字符。`)
      return
    }
    if (action === 'close' && scope === 'types' && !reportTypes.trim()) {
      setActionError('按举报类型结案时，请至少填写一个举报类型。')
      return
    }
    if (action === 'assign' && assignee.trim() && !/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/.test(assignee.trim())) {
      setActionError('处理人需要填写完整的账号标识，例如 did:plc:…')
      return
    }
    setActionError(null)
    setActing(true)
    try {
      await provider.actOnReport({
        reportId: report.id,
        action,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
        ...(action === 'assign' && assignee.trim() ? { did: assignee.trim() } : {}),
        ...(action === 'close' ? { scope } : {}),
        ...(action === 'close' && scope === 'types'
          ? {
              reportTypes: reportTypes
                .split(/[,\uFF0C\s]+/)
                .map((item) => item.trim())
                .filter(Boolean),
            }
          : {}),
      })
      toast.success(ACTION_SUCCESS[action])
      setAction(null)
      setComment('')
      setAssignee('')
      setActionError(null)
      onChanged?.()
      setReloadToken((value) => value + 1)
    } catch (cause) {
      setActionError(describeAdminError(cause))
    } finally {
      setActing(false)
    }
  }

  return (
    <>
      <Dialog
        open={reportId !== null && moderationRequest === null}
        onOpenChange={(open) => {
          if (!open && !acting) onClose()
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>举报详情{report ? ` #${report.id}` : ''}</DialogTitle>
            <DialogDescription>
              举报内容来自审核服务，处理动作会写入审核记录与后台审计日志。
            </DialogDescription>
          </DialogHeader>

          {state === 'loading' ? (
            <LoadingState label="正在加载举报详情…" />
          ) : state === 'error' ? (
            <ErrorState
              title="举报详情加载失败"
              message={error ?? '操作失败，请稍后重试。'}
              onRetry={() => setReloadToken((value) => value + 1)}
            />
          ) : report ? (
            <div className="max-h-[68vh] space-y-4 overflow-auto pr-1 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={reportStatusVariants[report.status]}>
                  {reportStatusLabels[report.status]}
                </Badge>
                <Badge variant="outline">{reportTypeLabel(report.reportType)}</Badge>
                {report.subjectType ? (
                  <Badge variant="muted">{subjectTypeLabels[report.subjectType]}</Badge>
                ) : null}
                {report.queueId !== undefined ? (
                  <Badge variant="secondary">队列 #{report.queueId}</Badge>
                ) : null}
              </div>

              <dl className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">举报对象</dt>
                  <dd className="mt-1 flex flex-wrap items-center gap-2">
                    {href ? (
                      <Link
                        href={href}
                        className="font-mono text-xs break-all text-primary hover:underline"
                      >
                        {report.subject}
                      </Link>
                    ) : (
                      <span className="font-mono text-xs break-all">{report.subject}</span>
                    )}
                    {report.subjectHandle ? (
                      <span className="text-xs text-muted-foreground">
                        {report.subjectHandle}
                      </span>
                    ) : null}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">举报人</dt>
                  <dd className="mt-1 font-mono text-xs break-all" title={report.reportedBy}>
                    {report.reporterHandle ?? truncateDid(report.reportedBy)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">举报时间</dt>
                  <dd className="mt-1 text-xs">{formatDateTime(report.createdAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">处理人</dt>
                  <dd className="mt-1 font-mono text-xs break-all">
                    {report.assignedTo ? truncateDid(report.assignedTo) : '未分配'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">优先级</dt>
                  <dd className="mt-1 text-xs tabular-nums">
                    {report.priorityScore ?? '—'}
                  </dd>
                </div>
                {report.closedAt ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">结案时间</dt>
                    <dd className="mt-1 text-xs">{formatDateTime(report.closedAt)}</dd>
                  </div>
                ) : null}
                {report.relatedReportCount !== undefined ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">同对象举报</dt>
                    <dd className="mt-1 text-xs tabular-nums">
                      {report.relatedReportCount} 条
                    </dd>
                  </div>
                ) : null}
                {report.comment ? (
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-muted-foreground">举报说明</dt>
                    <dd className="mt-1 text-xs leading-relaxed">{report.comment}</dd>
                  </div>
                ) : null}
                {report.actionNote ? (
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-muted-foreground">处理备注</dt>
                    <dd className="mt-1 text-xs leading-relaxed">{report.actionNote}</dd>
                  </div>
                ) : null}
              </dl>

              <div className="space-y-2 rounded-lg border p-3">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <ShieldAlertIcon className="size-3.5 text-muted-foreground" />
                  举报处理
                </p>
                {!canWrite ? (
                  <p className="text-xs text-muted-foreground">
                    当前账号没有执行举报处置的权限，只能查看举报信息。如需处理举报，请联系管理员开通审核权限。
                  </p>
                ) : action ? (
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                      当前动作：{reportActionLabels[action]}。处理说明与动作会写入审核记录。
                    </p>
                    {action === 'assign' ? (
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium" htmlFor="report-assignee">
                          处理人账号标识（留空表示指派给自己）
                        </label>
                        <Input
                          id="report-assignee"
                          value={assignee}
                          onChange={(event) => {
                            setAssignee(event.target.value)
                            setActionError(null)
                          }}
                          placeholder="did:plc:…"
                          className="font-mono text-xs"
                          disabled={acting}
                        />
                      </div>
                    ) : null}
                    {action === 'close' ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium" htmlFor="report-scope">
                            结案范围
                          </label>
                          <Select
                            id="report-scope"
                            value={scope}
                            onChange={(event) =>
                              setScope(event.target.value as 'current' | 'all' | 'types')
                            }
                            disabled={acting}
                          >
                            <option value="current">仅当前举报</option>
                            <option value="all">同一对象的全部举报</option>
                            <option value="types">按举报类型</option>
                          </Select>
                        </div>
                        {scope === 'types' ? (
                          <div className="space-y-1.5">
                            <label className="text-xs font-medium" htmlFor="report-types">
                              举报类型
                            </label>
                            <Input
                              id="report-types"
                              value={reportTypes}
                              onChange={(event) => {
                                setReportTypes(event.target.value)
                                setActionError(null)
                              }}
                              placeholder="用逗号分隔"
                              disabled={acting}
                            />
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium" htmlFor="report-comment">
                        处理说明（可选）
                      </label>
                      <Textarea
                        id="report-comment"
                        value={comment}
                        onChange={(event) => {
                          setComment(event.target.value)
                          setActionError(null)
                        }}
                        rows={2}
                        maxLength={COMMENT_LIMIT}
                        placeholder="记录处理结果，便于后续复核。"
                        disabled={acting}
                      />
                    </div>
                    {actionError ? (
                      <p role="alert" className="text-xs text-destructive">
                        {actionError}
                      </p>
                    ) : null}
                    <div className="flex items-center gap-2">
                      <Button size="sm" onClick={() => void submitAction()} disabled={acting}>
                        {acting ? <LoaderCircleIcon className="animate-spin" /> : null}
                        确认{reportActionLabels[action]}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setAction(null)
                          setActionError(null)
                        }}
                        disabled={acting}
                      >
                        取消
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(reportActionLabels) as ReportAction[]).map((item) => (
                      <Button
                        key={item}
                        variant={item === 'close' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => {
                          setAction(item)
                          setActionError(null)
                        }}
                      >
                        {reportActionLabels[item]}
                      </Button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2 rounded-lg border p-3">
                <p className="text-sm font-medium">对举报对象执行处置</p>
                <p className="text-xs text-muted-foreground">
                  下架、禁言与打标属于高风险动作，需要另一位管理员在“安全与审批”中批准后执行；提交时会自动发起审批请求。
                </p>
                {canWrite ? (
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
                          subjects: [report.subject],
                          action: moderationAction,
                          ...(report.subjectType ? { subjectType: report.subjectType } : {}),
                          reportId: report.id,
                        })
                      }
                    >
                      执行{moderationActionLabels[moderationAction]}
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    当前账号没有执行审核处置的权限。如需下架、禁言或打标，请联系管理员开通审核权限。
                  </p>
                )}
              </div>
            </div>
          ) : (
            <EmptyState
              title="举报详情不可用"
              message="未获取到举报内容，请关闭后重试。"
            />
          )}

          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={acting}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ModerationActionDialog
        request={moderationRequest}
        onClose={() => setModerationRequest(null)}
        onCompleted={() => {
          onChanged?.()
          setReloadToken((value) => value + 1)
        }}
      />
    </>
  )
}
