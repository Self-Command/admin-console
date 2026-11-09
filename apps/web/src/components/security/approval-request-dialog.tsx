'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2Icon, LoaderCircleIcon, ShieldCheckIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type { Approval } from '@/lib/data/types'
import { describeAdminError } from '@/lib/errors'
import {
  approvalActionDescriptions,
  approvalActionLabels,
  type ApprovalRequestDraft,
} from '@/lib/approvals'
import { formatDateTime } from '@/lib/format'

type Props = {
  draft: ApprovalRequestDraft | null
  onClose: () => void
}

export function ApprovalRequestDialog({ draft, onClose }: Props) {
  const provider = useDataProvider()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<Approval | null>(null)

  useEffect(() => {
    if (!draft) {
      setCreated(null)
      setError(null)
      setSubmitting(false)
    }
  }, [draft])

  async function submit() {
    if (!draft) return
    setSubmitting(true)
    setError(null)
    try {
      const approval = await provider.createApproval({
        action: draft.action,
        ...(draft.targetType ? { targetType: draft.targetType } : {}),
        ...(draft.target ? { target: draft.target } : {}),
        summary: draft.summary,
        payload: draft.payload,
      })
      setCreated(approval)
      toast.success('审批请求已创建，等待另一位管理员批准。')
    } catch (cause) {
      setError(describeAdminError(cause))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={draft !== null}
      onOpenChange={(open) => {
        if (!open && !submitting) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheckIcon className="size-4 text-primary" />
            发起审批请求
          </DialogTitle>
          <DialogDescription>
            该操作属于高风险动作，需要另一位管理员批准后才会执行；请求人不能批准自己发起的请求。
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="space-y-3">
            <p className="flex items-start gap-2 rounded-md bg-success/10 px-3 py-2 text-xs text-success">
              <CheckCircle2Icon className="mt-0.5 size-3.5 shrink-0" />
              审批请求已创建，另一位管理员在“安全与审批”页面批准后，系统会立即执行该操作。
            </p>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">审批编号</dt>
                <dd className="mt-1 font-mono text-xs break-all">{created.id}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">有效期至</dt>
                <dd className="mt-1 text-xs">{formatDateTime(created.expiresAt)}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">动作</dt>
                <dd className="mt-1 text-xs">{approvalActionLabels[created.action]}</dd>
              </div>
            </dl>
          </div>
        ) : draft ? (
          <div className="space-y-3">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">动作</dt>
                <dd className="mt-1">{approvalActionLabels[draft.action]}</dd>
                <dd className="mt-1 text-xs text-muted-foreground">
                  {approvalActionDescriptions[draft.action]}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">请求摘要</dt>
                <dd className="mt-1 text-xs">{draft.summary}</dd>
              </div>
              {draft.target ? (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">目标</dt>
                  <dd className="mt-1 font-mono text-xs break-all">{draft.target}</dd>
                </div>
              ) : null}
            </dl>
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              审批请求默认 24 小时后失效；批准后系统在同一事务内执行该动作，并写入审计日志。若需调整内容，请关闭本窗口后重新发起。
            </p>
            {error ? (
              <p
                role="alert"
                className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                {error}
              </p>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          {created ? (
            <>
              <Button variant="outline" onClick={onClose}>
                关闭
              </Button>
              <Button asChild>
                <Link href="/security?tab=approvals">查看审批列表</Link>
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onClose} disabled={submitting}>
                取消
              </Button>
              <Button onClick={submit} disabled={submitting || draft === null}>
                {submitting ? <LoaderCircleIcon className="animate-spin" /> : null}
                发起审批请求
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}