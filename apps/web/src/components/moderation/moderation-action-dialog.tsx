'use client'

import { useEffect, useMemo, useState } from 'react'
import { CircleAlertIcon, InfoIcon, LoaderCircleIcon, ShieldCheckIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ApprovalRequestDialog } from '@/components/security/approval-request-dialog'
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
import { Textarea } from '@/components/ui/textarea'
import { AdminApiError } from '@/lib/api/admin-client'
import {
  moderationActionDescriptions,
  moderationActionLabels,
  moderationApprovalDraft,
  requiredModerationApproval,
  type ApprovalRequestDraft,
} from '@/lib/approvals'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type {
  ModerationAction,
  ModerationActResult,
  ModerationSubjectType,
} from '@/lib/data/types'
import { describeAdminError } from '@/lib/errors'
import { isDestructiveAction, subjectTypeLabels, truncateSubject } from '@/lib/moderation'

export type ModerationActionRequest = {
  subjects: string[]
  action: ModerationAction
  subjectType?: ModerationSubjectType
  reportId?: number
}

const COMMENT_LIMIT = 2000
const REASON_LIMIT = 200
const MAX_LABELS = 10

function parseLabels(value: string): string[] {
  const seen = new Set<string>()
  const labels: string[] = []
  for (const raw of value.split(/[,\uFF0C\s]+/)) {
    const label = raw.trim()
    if (!label) continue
    const key = label.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    labels.push(label)
  }
  return labels
}

export function ModerationActionDialog({
  request,
  onClose,
  onCompleted,
}: {
  request: ModerationActionRequest | null
  onClose: () => void
  onCompleted?: () => void
}) {
  const provider = useDataProvider()
  const [comment, setComment] = useState('')
  const [reason, setReason] = useState('')
  const [labelsText, setLabelsText] = useState('')
  const [durationText, setDurationText] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ModerationActResult | null>(null)
  const [approvalDraft, setApprovalDraft] = useState<ApprovalRequestDraft | null>(null)

  useEffect(() => {
    setComment('')
    setReason('')
    setLabelsText('')
    setDurationText('')
    setFormError(null)
    setError(null)
    setResult(null)
    setSubmitting(false)
  }, [request])

  const action = request?.action
  const subjects = useMemo(() => request?.subjects ?? [], [request])
  const labels = parseLabels(labelsText)
  const needsLabels = action === 'label'
  const needsDuration = action === 'takedown' || action === 'mute'
  const approvalAction =
    request && action ? requiredModerationApproval(subjects, action) : undefined

  async function submit() {
    if (!request || submitting) return
    const trimmed = comment.trim()
    if (trimmed.length < 2) {
      setFormError('请填写不少于 2 个字符的处置说明，说明会写入处置记录。')
      return
    }
    if (trimmed.length > COMMENT_LIMIT) {
      setFormError(`处置说明不能超过 ${COMMENT_LIMIT} 个字符。`)
      return
    }
    if (reason.trim().length > REASON_LIMIT) {
      setFormError(`处置理由不能超过 ${REASON_LIMIT} 个字符。`)
      return
    }
    if (needsLabels && labels.length === 0) {
      setFormError('标签处置需要至少填写 1 个标签。')
      return
    }
    if (labels.length > MAX_LABELS) {
      setFormError(`标签最多 ${MAX_LABELS} 个，当前有 ${labels.length} 个。`)
      return
    }
    let durationInHours: number | undefined
    if (needsDuration && durationText.trim()) {
      const value = Number(durationText)
      if (!Number.isInteger(value) || value < 1 || value > 87600) {
        setFormError('处置时长需要是 1 到 87600 之间的整数小时。')
        return
      }
      durationInHours = value
    }

    setFormError(null)
    setError(null)
    setSubmitting(true)
    try {
      const next = await provider.actOnSubjects({
        subjects: request.subjects,
        action: request.action,
        comment: trimmed,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        ...(needsLabels ? { labels } : {}),
        ...(durationInHours !== undefined ? { durationInHours } : {}),
        ...(request.reportId !== undefined ? { reportId: request.reportId } : {}),
      })
      onCompleted?.()
      if (next.failed.length > 0) {
        setResult(next)
        toast.warning(
          `已完成 ${next.events.length} 个对象的处置，${next.failed.length} 个对象处置失败。`,
        )
        return
      }
      toast.success(
        request.subjects.length > 1
          ? `已完成 ${request.subjects.length} 个对象的处置。`
          : '处置已完成，结果已写入处置记录。',
      )
      onClose()
    } catch (cause) {
      if (
        cause instanceof AdminApiError &&
        cause.kind === 'conflict' &&
        cause.code === 'ApprovalRequired'
      ) {
        // 独立打标默认无需审批；当审批范围追加 moderation.label 后，服务端会在此要求审批。
        const draftAction =
          approvalAction ??
          (request.action === 'label' && request.subjects.length === 1
            ? 'moderation.label'
            : undefined)
        if (draftAction) {
          setApprovalDraft(
            moderationApprovalDraft(
              {
                subjects: request.subjects,
                action: request.action,
                ...(trimmed ? { comment: trimmed } : {}),
                ...(reason.trim() ? { reason: reason.trim() } : {}),
                ...(needsLabels ? { labels } : {}),
                ...(durationInHours !== undefined ? { durationInHours } : {}),
                ...(request.reportId !== undefined ? { reportId: request.reportId } : {}),
                ...(request.subjectType ? { subjectType: request.subjectType } : {}),
              },
              draftAction,
            ),
          )
          onClose()
          return
        }
      }
      if (cause instanceof AdminApiError && cause.status === 503) {
        setError('审核服务尚未配置，暂时无法执行处置。请联系部署管理员完成审核服务配置。')
      } else {
        setError(describeAdminError(cause))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Dialog
        open={request !== null && approvalDraft === null}
        onOpenChange={(open) => {
          if (!open) setSubmitting(false)
          if (!open) onClose()
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {action ? moderationActionLabels[action] : '执行处置'}
              {subjects.length > 1 ? `（${subjects.length} 个对象）` : ''}
            </DialogTitle>
            <DialogDescription>
              {action ? moderationActionDescriptions[action] : '对选定对象执行审核处置。'}
            </DialogDescription>
          </DialogHeader>

          {result ? (
            <div className="space-y-3 text-sm">
              <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                部分对象处置失败，请核对失败原因后重试；成功部分已写入处置记录。
              </p>
              <div className="space-y-2">
                <p className="text-xs font-medium">处置失败的对象</p>
                <ul className="max-h-56 space-y-1.5 overflow-auto pr-1">
                  {result.failed.map((item) => (
                    <li
                      key={item.subject}
                      className="rounded-md border px-3 py-2 text-xs"
                    >
                      <p className="font-mono break-all">{item.subject}</p>
                      <p className="mt-1 text-destructive">{item.message}</p>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="text-xs text-muted-foreground">
                本次成功处置 {result.events.length} 个对象。
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/40 px-3 py-2">
                <p className="text-xs text-muted-foreground">处置对象</p>
                <ul className="mt-1.5 max-h-24 space-y-1 overflow-auto">
                  {subjects.map((subject) => (
                    <li
                      key={subject}
                      title={subject}
                      className="font-mono text-xs break-all"
                    >
                      {truncateSubject(subject)}
                    </li>
                  ))}
                </ul>
                {request?.subjectType ? (
                  <Badge variant="outline" className="mt-2">
                    {subjectTypeLabels[request.subjectType]}
                  </Badge>
                ) : null}
              </div>

              {approvalAction ? (
                <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-relaxed">
                  <ShieldCheckIcon className="mt-0.5 size-3.5 shrink-0" />
                  该动作需要另一位管理员批准后才会执行。提交后若系统要求审批，本窗口会关闭并自动发起审批请求。
                </p>
              ) : null}

              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="moderation-comment">
                  处置说明
                </label>
                <Textarea
                  id="moderation-comment"
                  value={comment}
                  onChange={(event) => {
                    setComment(event.target.value)
                    setFormError(null)
                  }}
                  rows={3}
                  maxLength={COMMENT_LIMIT}
                  placeholder="说明处置依据与范围，便于后续复核。"
                  disabled={submitting}
                />
                <p className="text-right text-xs text-muted-foreground tabular-nums">
                  {comment.length} / {COMMENT_LIMIT}
                </p>
              </div>

              {needsLabels ? (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="moderation-labels">
                    审核标签
                  </label>
                  <Input
                    id="moderation-labels"
                    value={labelsText}
                    onChange={(event) => {
                      setLabelsText(event.target.value)
                      setFormError(null)
                    }}
                    placeholder="用逗号分隔，例如：spam，misleading"
                    disabled={submitting}
                  />
                  <p className="text-xs text-muted-foreground">
                    最多 {MAX_LABELS} 个，已识别 {labels.length} 个。
                  </p>
                </div>
              ) : null}

              <div className={needsDuration ? 'grid gap-3 sm:grid-cols-2' : 'space-y-1.5'}>
                {needsDuration ? (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium" htmlFor="moderation-duration">
                      处置时长（小时，可选）
                    </label>
                    <Input
                      id="moderation-duration"
                      inputMode="numeric"
                      value={durationText}
                      onChange={(event) => {
                        setDurationText(event.target.value)
                        setFormError(null)
                      }}
                      placeholder="留空表示长期有效"
                      disabled={submitting}
                    />
                  </div>
                ) : null}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="moderation-reason">
                    {needsDuration ? '处置理由（可选）' : '补充说明（可选）'}
                  </label>
                  <Input
                    id="moderation-reason"
                    value={reason}
                    onChange={(event) => {
                      setReason(event.target.value)
                      setFormError(null)
                    }}
                    maxLength={REASON_LIMIT}
                    placeholder="用于审批与复核的简短理由"
                    disabled={submitting}
                  />
                </div>
              </div>

              {isDestructiveAction(request?.action ?? 'comment') ? (
                <p className="flex items-start gap-2 text-xs text-muted-foreground">
                  <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
                  下架、禁言与打标属于高风险动作，执行结果与审批编号都会写入处置记录与审计日志。
                </p>
              ) : null}

              {formError ? (
                <p role="alert" className="text-xs text-destructive">
                  {formError}
                </p>
              ) : null}
              {error ? (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
                >
                  <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
                  {error}
                </p>
              ) : null}
            </div>
          )}

          <DialogFooter>
            {result ? (
              <Button onClick={onClose}>关闭</Button>
            ) : (
              <>
                <Button variant="outline" onClick={onClose} disabled={submitting}>
                  取消
                </Button>
                <Button onClick={() => void submit()} disabled={submitting}>
                  {submitting ? <LoaderCircleIcon className="animate-spin" /> : null}
                  确认处置
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ApprovalRequestDialog
        draft={approvalDraft}
        onClose={() => setApprovalDraft(null)}
      />
    </>
  )
}
