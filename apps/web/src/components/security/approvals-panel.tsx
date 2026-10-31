'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  CheckIcon,
  ClipboardCheckIcon,
  LoaderCircleIcon,
  PlusIcon,
  XIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState, ErrorState, LoadingState } from '@/components/data-state'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AdminApiError } from '@/lib/api/admin-client'
import {
  approvalActionLabels,
  approvalStatusLabels,
  approvalStatusVariants,
  demoteApprovalDraft,
  resetAllApprovalDraft,
  revokeApprovalDraft,
  type ApprovalRequestDraft,
} from '@/lib/approvals'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type { Approval, ApprovalStatus } from '@/lib/data/types'
import { describeAdminError } from '@/lib/errors'
import { formatDateTime, truncateDid } from '@/lib/format'
import { roleLabels, type RoleName } from '@/lib/roles'

const DID_PATTERN = /^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/

type LoadStatus = 'loading' | 'ready' | 'error'
type CreateAction = 'role.revoke' | 'role.demote' | 'settings.resetAll'

const STATUS_ORDER: ApprovalStatus[] = [
  'pending',
  'executed',
  'rejected',
  'cancelled',
  'expired',
  'failed',
]

function approvalMessage(error: unknown): string {
  if (error instanceof AdminApiError) {
    if (error.code === 'ApprovalState') return '审批请求状态已变化，请刷新列表后再处理。'
    if (error.code === 'ApprovalNotFound') return '审批请求已不存在，请刷新列表。'
    if (error.code === 'Forbidden') return '请求人不能批准或拒绝自己发起的审批请求。'
    if (error.code === 'LastAdmin') return '执行后工作区将没有管理员，已阻止本次执行。'
  }
  return describeAdminError(error)
}

type Props = {
  canWrite: boolean
  selfDid?: string
  onRequestApproval: (draft: ApprovalRequestDraft) => void
  refreshToken: number
  onChanged: () => void
}

export function ApprovalsPanel({
  canWrite,
  selfDid,
  onRequestApproval,
  refreshToken,
  onChanged,
}: Props) {
  const provider = useDataProvider()

  const [approvals, setApprovals] = useState<Approval[]>([])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [listError, setListError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [statusFilter, setStatusFilter] = useState<'all' | ApprovalStatus>('pending')

  const [page, setPage] = useState(1)
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined])
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const pageSize = 20

  const [approveTarget, setApproveTarget] = useState<Approval | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [acting, setActing] = useState(false)

  const [rejectTarget, setRejectTarget] = useState<Approval | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const [cancelTarget, setCancelTarget] = useState<Approval | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [createAction, setCreateAction] = useState<CreateAction>('role.revoke')
  const [createSubject, setCreateSubject] = useState('')
  const [createRole, setCreateRole] = useState<Exclude<RoleName, 'admin'>>('operator')
  const [createReason, setCreateReason] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const cursor = cursors[page - 1]
    setStatus('loading')
    setListError(null)

    provider
      .listApprovals({
        cursor,
        limit: pageSize,
        status: statusFilter === 'all' ? undefined : statusFilter,
      })
      .then((result) => {
        if (!active) return
        setApprovals(result.approvals)
        setTotal(result.total)
        setNextCursor(result.cursor)
        setStatus('ready')
        const maxPage = Math.max(1, Math.ceil(result.total / pageSize))
        if (page > maxPage) {
          setPage(maxPage)
          setCursors((current) => current.slice(0, maxPage))
        }
      })
      .catch((cause: unknown) => {
        if (!active) return
        setListError(describeAdminError(cause))
        setStatus('error')
      })

    return () => {
      active = false
    }
  }, [provider, cursors, page, pageSize, statusFilter, reloadToken, refreshToken])

  function reload() {
    setReloadToken((value) => value + 1)
    onChanged()
  }

  function resetPaging() {
    setPage(1)
    setCursors([undefined])
  }

  async function confirmApprove() {
    if (!approveTarget) return
    setActing(true)
    setActionError(null)
    try {
      await provider.approveApproval(approveTarget.id)
      toast.success('已批准并执行审批请求')
      setApproveTarget(null)
      reload()
    } catch (cause) {
      setActionError(approvalMessage(cause))
    } finally {
      setActing(false)
    }
  }

  async function confirmReject() {
    if (!rejectTarget) return
    if (rejectReason.trim().length > 200) {
      setActionError('拒绝原因不能超过 200 个字符。')
      return
    }
    setActing(true)
    setActionError(null)
    try {
      await provider.rejectApproval(rejectTarget.id, rejectReason.trim() || undefined)
      toast.success('已拒绝审批请求')
      setRejectTarget(null)
      setRejectReason('')
      reload()
    } catch (cause) {
      setActionError(approvalMessage(cause))
    } finally {
      setActing(false)
    }
  }

  async function confirmCancel() {
    if (!cancelTarget) return
    setActing(true)
    setActionError(null)
    try {
      await provider.cancelApproval(cancelTarget.id)
      toast.success('已撤回审批请求')
      setCancelTarget(null)
      reload()
    } catch (cause) {
      setActionError(approvalMessage(cause))
    } finally {
      setActing(false)
    }
  }

  function submitCreate() {
    if (createAction === 'settings.resetAll') {
      setCreateError(null)
      setCreateOpen(false)
      onRequestApproval(resetAllApprovalDraft(createReason.trim() || undefined))
      setCreateReason('')
      return
    }
    const subject = createSubject.trim()
    if (!DID_PATTERN.test(subject)) {
      setCreateError('请输入合法的账号标识，例如 did:plc:… 或 did:web:…')
      return
    }
    setCreateError(null)
    setCreateOpen(false)
    onRequestApproval(
      createAction === 'role.revoke'
        ? revokeApprovalDraft(subject)
        : demoteApprovalDraft(subject, createRole),
    )
    setCreateSubject('')
  }

  const pageStart = (page - 1) * pageSize
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const showInitialLoading = status === 'loading' && approvals.length === 0

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value as 'all' | ApprovalStatus)
              resetPaging()
            }}
            className="w-32"
            aria-label="按审批状态筛选"
          >
            <option value="all">全部状态</option>
            {STATUS_ORDER.map((item) => (
              <option key={item} value={item}>
                {approvalStatusLabels[item]}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">共 {total} 条审批请求</p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setCreateError(null)
            setCreateOpen(true)
          }}
          disabled={!canWrite}
          title={canWrite ? undefined : '当前账号没有管理后台安全的权限'}
        >
          <PlusIcon />
          发起审批
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        {status === 'error' ? (
          <ErrorState
            title="审批请求加载失败"
            message={listError ?? '操作失败，请稍后重试。'}
            onRetry={() => setReloadToken((value) => value + 1)}
          />
        ) : showInitialLoading ? (
          <LoadingState label="正在加载审批请求…" />
        ) : approvals.length === 0 ? (
          <EmptyState
            icon={ClipboardCheckIcon}
            title={statusFilter === 'pending' ? '当前没有待审批事项' : '没有匹配的审批请求'}
            message="高风险动作需要另一位管理员批准：发起请求后，由另一位管理员在待审批列表中批准执行。"
          />
        ) : (
          <Table aria-busy={status === 'loading'}>
            <TableHeader>
              <TableRow>
                <TableHead>动作</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>请求人</TableHead>
                <TableHead>发起时间</TableHead>
                <TableHead>有效期至</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {approvals.map((approval) => {
                const own = selfDid !== undefined && approval.requestedBy === selfDid
                const pending = approval.status === 'pending'
                return (
                  <TableRow key={approval.id}>
                    <TableCell>
                      <p className="text-sm font-medium">{approvalActionLabels[approval.action]}</p>
                      <p className="mt-0.5 max-w-72 truncate text-xs text-muted-foreground">
                        {approval.summary ?? '未填写摘要'}
                      </p>
                      {approval.target ? (
                        <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                          {truncateDid(approval.target, 24, 8)}
                        </p>
                      ) : null}
                      {approval.error ? (
                        <p className="mt-1 text-xs text-destructive">{approval.error}</p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant={approvalStatusVariants[approval.status]}>
                        {approvalStatusLabels[approval.status]}
                      </Badge>
                    </TableCell>
                    <TableCell
                      className="font-mono text-xs text-muted-foreground"
                      title={approval.requestedBy}
                    >
                      {own ? '本人' : truncateDid(approval.requestedBy, 16, 6)}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                      {formatDateTime(approval.requestedAt)}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                      {formatDateTime(approval.expiresAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {!pending ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : own ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setActionError(null)
                            setCancelTarget(approval)
                          }}
                          disabled={!canWrite}
                          title={canWrite ? undefined : '当前账号没有管理后台安全的权限'}
                        >
                          <XIcon />
                          撤回
                        </Button>
                      ) : (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setActionError(null)
                              setApproveTarget(approval)
                            }}
                            disabled={!canWrite}
                            title={canWrite ? undefined : '当前账号没有管理后台安全的权限'}
                          >
                            <CheckIcon />
                            批准
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setActionError(null)
                              setRejectReason('')
                              setRejectTarget(approval)
                            }}
                            disabled={!canWrite}
                            title={canWrite ? undefined : '当前账号没有管理后台安全的权限'}
                          >
                            <XIcon />
                            拒绝
                          </Button>
                        </div>
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
            共 {total} 条
            {total > 0 ? `，第 ${pageStart + 1}–${pageStart + approvals.length} 条` : ''}
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
            <span className="px-2 font-mono tabular-nums">
              {page} / {pageCount}
            </span>
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
      </div>

      <p className="text-xs text-muted-foreground">
        审批请求默认 24 小时后失效，同一请求只能执行一次；批准与执行在同一事务内完成。需要查看角色或设置细节时，可前往
        <Link href="/roles" className="mx-1 text-primary hover:underline">
          管理员与角色
        </Link>
        或
        <Link href="/settings" className="mx-1 text-primary hover:underline">
          系统设置
        </Link>
        页面核对。
      </p>

      <Dialog
        open={approveTarget !== null}
        onOpenChange={(open) => {
          if (!open && !acting) setApproveTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>批准并执行</DialogTitle>
            <DialogDescription>
              批准后系统会立即执行该动作，并写入审计日志；执行失败时审批状态记为“执行失败”，可重新发起。
            </DialogDescription>
          </DialogHeader>
          {approveTarget ? (
            <div className="space-y-3 text-sm">
              <div className="rounded-lg border bg-muted/40 p-3">
                <p className="font-medium">{approvalActionLabels[approveTarget.action]}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {approveTarget.summary ?? '未填写摘要'}
                </p>
                {approveTarget.target ? (
                  <p className="mt-1 font-mono text-xs break-all">{approveTarget.target}</p>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                请求人：{approveTarget.requestedBy === selfDid ? '本人' : approveTarget.requestedBy}
              </p>
              {actionError ? (
                <p
                  role="alert"
                  className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
                >
                  {actionError}
                </p>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveTarget(null)} disabled={acting}>
              取消
            </Button>
            <Button onClick={confirmApprove} disabled={acting}>
              {acting ? <LoaderCircleIcon className="animate-spin" /> : null}
              确认批准并执行
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={rejectTarget !== null}
        onOpenChange={(open) => {
          if (!open && !acting) {
            setRejectTarget(null)
            setRejectReason('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>拒绝审批请求</DialogTitle>
            <DialogDescription>
              拒绝后该请求不会再执行；如需继续操作，发起人需要重新提交请求。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="reject-reason" className="text-sm font-medium">
                拒绝原因（可选）
              </label>
              <Input
                id="reject-reason"
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                placeholder="例如：变更范围需要先确认"
                maxLength={200}
                disabled={acting}
              />
            </div>
            {actionError ? (
              <p
                role="alert"
                className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                {actionError}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRejectTarget(null)
                setRejectReason('')
              }}
              disabled={acting}
            >
              取消
            </Button>
            <Button variant="destructive" onClick={confirmReject} disabled={acting}>
              {acting ? <LoaderCircleIcon className="animate-spin" /> : null}
              确认拒绝
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open && !acting) setCancelTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>撤回审批请求</DialogTitle>
            <DialogDescription>
              撤回后该请求立即失效；只有请求人本人可以撤回。
            </DialogDescription>
          </DialogHeader>
          {cancelTarget ? (
            <p className="text-sm">{approvalActionLabels[cancelTarget.action]}</p>
          ) : null}
          {actionError ? (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {actionError}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)} disabled={acting}>
              取消
            </Button>
            <Button variant="destructive" onClick={confirmCancel} disabled={acting}>
              {acting ? <LoaderCircleIcon className="animate-spin" /> : null}
              确认撤回
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!open) setCreateOpen(false)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>发起审批请求</DialogTitle>
            <DialogDescription>
              选择需要复核的高风险动作并填写目标；提交后由另一位管理员批准执行。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="create-action" className="text-sm font-medium">
                动作
              </label>
              <Select
                id="create-action"
                value={createAction}
                onChange={(event) => {
                  setCreateAction(event.target.value as CreateAction)
                  setCreateError(null)
                }}
                className="w-full"
              >
                <option value="role.revoke">撤销管理员角色</option>
                <option value="role.demote">降级管理员角色</option>
                <option value="settings.resetAll">全部恢复默认设置</option>
              </Select>
            </div>
            {createAction === 'settings.resetAll' ? (
              <div className="space-y-1.5">
                <label htmlFor="create-reason" className="text-sm font-medium">
                  原因（可选）
                </label>
                <Input
                  id="create-reason"
                  value={createReason}
                  onChange={(event) => setCreateReason(event.target.value)}
                  placeholder="例如：配置异常，需要恢复初始状态"
                  maxLength={200}
                />
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <label htmlFor="create-subject" className="text-sm font-medium">
                    目标账号标识
                  </label>
                  <Input
                    id="create-subject"
                    value={createSubject}
                    onChange={(event) => {
                      setCreateSubject(event.target.value)
                      setCreateError(null)
                    }}
                    placeholder="did:plc:… 或 did:web:…"
                    className="font-mono text-xs"
                  />
                </div>
                {createAction === 'role.demote' ? (
                  <div className="space-y-1.5">
                    <label htmlFor="create-role" className="text-sm font-medium">
                      降级后的角色
                    </label>
                    <Select
                      id="create-role"
                      value={createRole}
                      onChange={(event) =>
                        setCreateRole(event.target.value as Exclude<RoleName, 'admin'>)
                      }
                      className="w-full"
                    >
                      <option value="operator">{roleLabels.operator}</option>
                      <option value="viewer">{roleLabels.viewer}</option>
                    </Select>
                  </div>
                ) : null}
              </>
            )}
            {createError ? (
              <p
                role="alert"
                className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                {createError}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={submitCreate}>继续</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}