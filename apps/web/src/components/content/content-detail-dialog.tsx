'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CopyIcon, ShieldAlertIcon } from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState, ErrorState, LoadingState } from '@/components/data-state'
import { ChatModerationPanel } from '@/components/moderation/chat-moderation-panel'
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
import { Select } from '@/components/ui/select'
import { useAuth } from '@/components/auth/auth-provider'
import { AdminApiError } from '@/lib/api/admin-client'
import { hasPermission } from '@/lib/access'
import { moderationActionLabels } from '@/lib/approvals'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type { ContentGetResult, ModerationAction } from '@/lib/data/types'
import { describeAdminError } from '@/lib/errors'
import { formatDateTime, formatNumber, truncateDid } from '@/lib/format'
import {
  eventTypeLabel,
  moderationActionOptions,
  reportStatusLabels,
  reportStatusVariants,
  reportTypeLabel,
} from '@/lib/moderation'

type LoadState = 'loading' | 'ready' | 'error'

export function ContentDetailDialog({
  uri,
  onClose,
  onChanged,
}: {
  uri: string | null
  onClose: () => void
  onChanged?: () => void
}) {
  const provider = useDataProvider()
  const { identity } = useAuth()
  const canModerate = hasPermission(identity, 'moderation.write')

  const [state, setState] = useState<LoadState>('loading')
  const [result, setResult] = useState<ContentGetResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [moderationAction, setModerationAction] = useState<ModerationAction>('takedown')
  const [moderationRequest, setModerationRequest] =
    useState<ModerationActionRequest | null>(null)

  useEffect(() => {
    if (!uri) return
    let active = true
    setState('loading')
    setError(null)
    setResult(null)
    provider
      .getContent(uri)
      .then((value) => {
        if (!active) return
        setResult(value)
        setState('ready')
      })
      .catch((cause: unknown) => {
        if (!active) return
        setError(
          cause instanceof AdminApiError && cause.kind === 'not_found'
            ? '未找到该内容，可能已被删除或尚未同步到审核服务。'
            : describeAdminError(cause),
        )
        setState('error')
      })
    return () => {
      active = false
    }
  }, [provider, uri, reloadToken])

  async function copyUri() {
    if (!uri) return
    try {
      await navigator.clipboard.writeText(uri)
      toast.success('已复制内容地址')
    } catch {
      toast.error('复制失败，请手动选择内容地址复制。')
    }
  }

  const record = result?.record
  const moderationAvailable = result?.moderationAvailable ?? true

  return (
    <>
      <Dialog
        open={uri !== null && moderationRequest === null}
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>内容详情</DialogTitle>
            <DialogDescription>
              内容来自公开接口，审核状态与处置记录来自审核服务；处置动作会写入审计日志。
            </DialogDescription>
          </DialogHeader>

          {state === 'loading' ? (
            <LoadingState label="正在加载内容详情…" />
          ) : state === 'error' ? (
            <ErrorState
              title="内容详情加载失败"
              message={error ?? '操作失败，请稍后重试。'}
              onRetry={() => setReloadToken((value) => value + 1)}
            />
          ) : record ? (
            <div className="max-h-[68vh] space-y-4 overflow-auto pr-1 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                {record.hidden ? (
                  <Badge variant="destructive">已隐藏</Badge>
                ) : (
                  <Badge variant="success">客户端可见</Badge>
                )}
                {record.reviewState ? (
                  <Badge variant="outline">审核状态：{record.reviewState}</Badge>
                ) : null}
                {(record.labels ?? []).map((label) => (
                  <Badge key={label} variant="secondary">
                    {label}
                  </Badge>
                ))}
              </div>

              {record.text ? (
                <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap">
                  {record.text}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">该内容没有文本正文。</p>
              )}

              <dl className="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">作者</dt>
                  <dd className="mt-1 text-xs">
                    <Link
                      href={`/directory/${encodeURIComponent(record.author)}`}
                      className="text-primary hover:underline"
                    >
                      {record.authorHandle ?? truncateDid(record.author)}
                    </Link>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">索引时间</dt>
                  <dd className="mt-1 text-xs">{formatDateTime(record.indexedAt)}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">内容地址</dt>
                  <dd className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs break-all">{record.uri}</span>
                    <Button variant="ghost" size="sm" className="h-7 px-2" onClick={copyUri}>
                      <CopyIcon className="size-3.5" />
                      复制
                    </Button>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">互动数据</dt>
                  <dd className="mt-1 text-xs tabular-nums">
                    点赞 {formatNumber(record.likeCount ?? 0)} · 转发{' '}
                    {formatNumber(record.repostCount ?? 0)} · 回复{' '}
                    {formatNumber(record.replyCount ?? 0)}
                  </dd>
                </div>
              </dl>

              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-lg border p-3">
                  <p className="text-sm font-medium">近期处置记录</p>
                  {result.events.length === 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      该内容暂无处置记录。
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {result.events.slice(0, 5).map((event) => (
                        <li key={event.id} className="text-xs">
                          <p className="font-medium">{eventTypeLabel(event.eventType)}</p>
                          <p className="mt-0.5 text-muted-foreground">
                            {formatDateTime(event.createdAt)} · {truncateDid(event.createdBy)}
                          </p>
                          {event.comment ? (
                            <p className="mt-0.5 text-muted-foreground">{event.comment}</p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                  <Button variant="link" size="sm" className="mt-2 h-auto px-0" asChild>
                    <Link href={`/moderation/events?subject=${encodeURIComponent(record.uri)}`}>
                      查看全部处置记录
                    </Link>
                  </Button>
                </div>

                <div className="rounded-lg border p-3">
                  <p className="text-sm font-medium">关联举报</p>
                  {result.reports.length === 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">该内容暂无关联举报。</p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {result.reports.slice(0, 5).map((report) => (
                        <li key={report.id} className="flex items-center gap-2 text-xs">
                          <Badge variant={reportStatusVariants[report.status]}>
                            {reportStatusLabels[report.status]}
                          </Badge>
                          <span>#{report.id}</span>
                          <span className="text-muted-foreground">
                            {reportTypeLabel(report.reportType)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Button variant="link" size="sm" className="mt-2 h-auto px-0" asChild>
                    <Link href="/moderation/reports">前往举报处理</Link>
                  </Button>
                </div>
              </div>

              <div className="space-y-2 rounded-lg border p-3">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <ShieldAlertIcon className="size-3.5 text-muted-foreground" />
                  内容处置
                </p>
                {!moderationAvailable ? (
                  <p className="text-xs text-muted-foreground">
                    审核服务尚未配置，当前只能查看公开内容，无法执行处置。请联系部署管理员完成审核服务配置。
                  </p>
                ) : !canModerate ? (
                  <p className="text-xs text-muted-foreground">
                    当前账号没有执行内容处置的权限。如需下架、打标或禁言，请联系管理员开通审核权限。
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      下架、禁言与打标属于高风险动作，需要另一位管理员批准后执行；提交时会自动发起审批请求。
                    </p>
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
                            subjects: [record.uri],
                            action: moderationAction,
                            subjectType: 'record',
                          })
                        }
                      >
                        执行{moderationActionLabels[moderationAction]}
                      </Button>
                    </div>
                  </>
                )}
              </div>

              <ChatModerationPanel />
            </div>
          ) : (
            <EmptyState title="内容详情不可用" message="未获取到内容，请关闭后重试。" />
          )}

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
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
