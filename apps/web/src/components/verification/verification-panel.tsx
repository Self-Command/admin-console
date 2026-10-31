'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { BadgeCheckIcon, LoaderCircleIcon, SearchXIcon } from 'lucide-react'
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
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useWorkspace } from '@/components/layout/workspace-provider'
import {
  isApprovalRequired,
  verificationGrantApprovalDraft,
  verificationRevokeApprovalDraft,
  type ApprovalRequestDraft,
} from '@/lib/approvals'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type { VerificationGrantInput, VerificationView } from '@/lib/data/types'
import { describeAdminError } from '@/lib/errors'
import { formatDateTime, truncateDid } from '@/lib/format'

const DID_PATTERN = /^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/
const HANDLE_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i

type LoadStatus = 'loading' | 'ready' | 'error'
type StatusFilter = 'all' | 'active' | 'revoked'

type Props = {
  canWrite: boolean
  refreshToken: number
  onChanged: () => void
  onRequestApproval: (draft: ApprovalRequestDraft) => void
}

export function VerificationPanel({ canWrite, refreshToken, onChanged, onRequestApproval }: Props) {
  const provider = useDataProvider()
  const { pageSize } = useWorkspace()

  const [records, setRecords] = useState<VerificationView[]>([])
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [listError, setListError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const [subjectInput, setSubjectInput] = useState('')
  const [appliedSubject, setAppliedSubject] = useState<string | undefined>()
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [filterError, setFilterError] = useState<string | null>(null)

  const [page, setPage] = useState(1)
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined])
  const [nextCursor, setNextCursor] = useState<string | undefined>()

  const [grantOpen, setGrantOpen] = useState(false)
  const [grantSubject, setGrantSubject] = useState('')
  const [grantHandle, setGrantHandle] = useState('')
  const [grantName, setGrantName] = useState('')
  const [grantError, setGrantError] = useState<string | null>(null)
  const [granting, setGranting] = useState(false)

  const [revokeTarget, setRevokeTarget] = useState<VerificationView | null>(null)
  const [revokeReason, setRevokeReason] = useState('')
  const [revokeError, setRevokeError] = useState<string | null>(null)
  const [revoking, setRevoking] = useState(false)

  useEffect(() => {
    let active = true
    const cursor = cursors[page - 1]
    setStatus('loading')
    setListError(null)

    provider
      .listVerifications({
        cursor,
        limit: pageSize,
        ...(appliedSubject ? { subject: appliedSubject } : {}),
        ...(statusFilter === 'all' ? {} : { isRevoked: statusFilter === 'revoked' }),
      })
      .then((result) => {
        if (!active) return
        setRecords(result.verifications)
        setNextCursor(result.cursor)
        setStatus('ready')
      })
      .catch((cause: unknown) => {
        if (!active) return
        setListError(describeAdminError(cause))
        setStatus('error')
      })

    return () => {
      active = false
    }
  }, [provider, cursors, page, pageSize, appliedSubject, statusFilter, reloadToken, refreshToken])

  function reload() {
    setReloadToken((value) => value + 1)
    onChanged()
  }

  function resetPaging() {
    setPage(1)
    setCursors([undefined])
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = subjectInput.trim()
    if (value && !DID_PATTERN.test(value)) {
      setFilterError('请输入完整的账号标识，例如 did:plc:… 或 did:web:…')
      return
    }
    setFilterError(null)
    setAppliedSubject(value || undefined)
    resetPaging()
  }

  function openGrant() {
    setGrantSubject('')
    setGrantHandle('')
    setGrantName('')
    setGrantError(null)
    setGrantOpen(true)
  }

  async function submitGrant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const subject = grantSubject.trim()
    const handle = grantHandle.trim().replace(/^@/, '')
    const displayName = grantName.trim()
    if (!DID_PATTERN.test(subject)) {
      setGrantError('请输入完整的账号标识，例如 did:plc:… 或 did:web:…')
      return
    }
    if (!HANDLE_PATTERN.test(handle)) {
      setGrantError('账号名需要是完整域名格式，例如 alice.example.com。')
      return
    }
    if (!displayName) {
      setGrantError('请填写认证展示名称。')
      return
    }
    if (displayName.length > 200) {
      setGrantError('认证展示名称不能超过 200 个字符。')
      return
    }

    const verifications: VerificationGrantInput[] = [{ subject, handle, displayName }]
    setGranting(true)
    setGrantError(null)
    try {
      const result = await provider.actOnVerifications({ action: 'grant', verifications })
      if (result.failed.length > 0) {
        toast.warning('认证请求已提交，但认证服务未确认生效，请核对认证记录后重试。')
      } else {
        toast.success(`已为 ${displayName} 授予认证。`)
      }
      setGrantOpen(false)
      reload()
    } catch (cause) {
      if (isApprovalRequired(cause)) {
        onRequestApproval(verificationGrantApprovalDraft(verifications))
        setGrantOpen(false)
        return
      }
      setGrantError(describeAdminError(cause))
    } finally {
      setGranting(false)
    }
  }

  function openRevoke(record: VerificationView) {
    setRevokeTarget(record)
    setRevokeReason('')
    setRevokeError(null)
  }

  async function confirmRevoke() {
    if (!revokeTarget) return
    if (revokeReason.trim().length > 500) {
      setRevokeError('撤销说明不能超过 500 个字符。')
      return
    }
    const reason = revokeReason.trim()
    setRevoking(true)
    setRevokeError(null)
    try {
      const result = await provider.actOnVerifications({
        action: 'revoke',
        uris: [revokeTarget.uri],
        ...(reason ? { reason } : {}),
      })
      if (result.failed.length > 0) {
        toast.warning('撤销请求已提交，但认证服务未确认生效，请核对认证记录后重试。')
      } else {
        toast.success('认证已撤销，公开资料将在短时间内同步。')
      }
      setRevokeTarget(null)
      reload()
    } catch (cause) {
      if (isApprovalRequired(cause)) {
        onRequestApproval(verificationRevokeApprovalDraft([revokeTarget], reason || undefined))
        setRevokeTarget(null)
        return
      }
      setRevokeError(describeAdminError(cause))
    } finally {
      setRevoking(false)
    }
  }

  const hasFilter = appliedSubject !== undefined || statusFilter !== 'all'
  const showInitialLoading = status === 'loading' && records.length === 0

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 lg:flex-row lg:items-start lg:justify-between">
        <form
          className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-start"
          onSubmit={applyFilters}
        >
          <div className="flex flex-1 items-center gap-2">
            <Input
              value={subjectInput}
              onChange={(event) => {
                setSubjectInput(event.target.value)
                setFilterError(null)
              }}
              placeholder="按账号标识（DID）精确筛选"
              className="font-mono text-xs"
              aria-label="按账号标识筛选认证记录"
              aria-invalid={filterError ? true : undefined}
            />
            <Select
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value as StatusFilter)
                resetPaging()
              }}
              aria-label="按认证状态筛选"
              className="w-36 shrink-0"
            >
              <option value="all">全部状态</option>
              <option value="active">已生效</option>
              <option value="revoked">已撤销</option>
            </Select>
            <Button type="submit" variant="secondary" size="sm" className="h-9">
              应用
            </Button>
          </div>
          <p
            className={`text-[11px] sm:max-w-56 ${filterError ? 'text-destructive' : 'text-muted-foreground'}`}
          >
            {filterError ?? '账号标识是 AT Protocol 身份的唯一编号，可在账号详情中复制。'}
          </p>
        </form>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={reload} disabled={status === 'loading'}>
            刷新
          </Button>
          <Button size="sm" onClick={openGrant} disabled={!canWrite} title={canWrite ? undefined : '当前账号没有管理认证的权限'}>
            <BadgeCheckIcon />
            授予认证
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        {status === 'error' ? (
          <ErrorState
            title="认证记录加载失败"
            message={listError ?? '操作失败，请稍后重试。'}
            onRetry={reload}
          />
        ) : showInitialLoading ? (
          <LoadingState label="正在加载认证记录…" />
        ) : records.length === 0 ? (
          <EmptyState
            icon={SearchXIcon}
            title={hasFilter ? '没有匹配的认证记录' : '当前没有认证记录'}
            message={
              hasFilter
                ? '调整账号标识或状态筛选后再试。'
                : '为需要公示身份的账号授予认证后，认证记录会显示在这里。'
            }
            action={
              hasFilter ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSubjectInput('')
                    setAppliedSubject(undefined)
                    setStatusFilter('all')
                    setFilterError(null)
                    resetPaging()
                  }}
                >
                  清空筛选
                </Button>
              ) : null
            }
          />
        ) : (
          <Table aria-busy={status === 'loading'}>
            <TableHeader>
              <TableRow>
                <TableHead>账号</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>认证时间</TableHead>
                <TableHead>签发人</TableHead>
                <TableHead>撤销说明</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((record) => (
                <TableRow key={record.uri}>
                  <TableCell>
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">
                        {record.displayName ?? '未设置展示名称'}
                      </p>
                      {record.handle ? (
                        <p className="text-xs text-muted-foreground">@{record.handle}</p>
                      ) : null}
                      <Link
                        href={`/directory/${encodeURIComponent(record.subject)}`}
                        className="block max-w-48 truncate font-mono text-[11px] text-primary hover:underline"
                        title={record.subject}
                      >
                        {truncateDid(record.subject, 20, 8)}
                      </Link>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={record.isActive ? 'success' : 'muted'}>
                      {record.isActive ? '已生效' : '已撤销'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                    {formatDateTime(record.createdAt)}
                  </TableCell>
                  <TableCell
                    className="font-mono text-xs text-muted-foreground"
                    title={record.issuer}
                  >
                    {truncateDid(record.issuer, 16, 6)}
                  </TableCell>
                  <TableCell className="max-w-56 text-xs text-muted-foreground">
                    {record.isActive ? '—' : record.revokeReason ?? '未填写撤销说明'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openRevoke(record)}
                      disabled={!canWrite || !record.isActive}
                      title={
                        !record.isActive
                          ? '该认证已撤销'
                          : canWrite
                            ? undefined
                            : '当前账号没有管理认证的权限'
                      }
                    >
                      撤销认证
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <div className="flex flex-col gap-2 border-t px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            第 {page} 页，本页 {records.length} 条
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
      </div>

      <Dialog
        open={grantOpen}
        onOpenChange={(open) => {
          if (!open && !granting) setGrantOpen(false)
        }}
      >
        <DialogContent>
          <form className="space-y-4" onSubmit={submitGrant}>
            <DialogHeader>
              <DialogTitle>授予账号认证</DialogTitle>
              <DialogDescription>
                认证信息会展示在账号公开资料中。若系统存在多位管理员，本操作需要另一位管理员批准后执行。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="grant-subject">账号标识</Label>
                <Input
                  id="grant-subject"
                  value={grantSubject}
                  onChange={(event) => {
                    setGrantSubject(event.target.value)
                    setGrantError(null)
                  }}
                  placeholder="did:plc:…"
                  className="font-mono text-xs"
                  disabled={granting}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="grant-handle">账号名</Label>
                <Input
                  id="grant-handle"
                  value={grantHandle}
                  onChange={(event) => {
                    setGrantHandle(event.target.value)
                    setGrantError(null)
                  }}
                  placeholder="alice.example.com"
                  disabled={granting}
                />
                <p className="text-xs text-muted-foreground">
                  填写账号当前的完整域名账号名，认证信息会与公开资料核对。
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="grant-name">认证展示名称</Label>
                <Input
                  id="grant-name"
                  value={grantName}
                  onChange={(event) => {
                    setGrantName(event.target.value)
                    setGrantError(null)
                  }}
                  placeholder="例如：官方账号"
                  maxLength={200}
                  disabled={granting}
                />
              </div>
              {grantError ? (
                <p
                  role="alert"
                  className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
                >
                  {grantError}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setGrantOpen(false)}
                disabled={granting}
              >
                取消
              </Button>
              <Button type="submit" disabled={granting}>
                {granting ? <LoaderCircleIcon className="animate-spin" /> : null}
                授予认证
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open && !revoking) setRevokeTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>撤销账号认证</DialogTitle>
            <DialogDescription>
              撤销后账号将失去认证标识，公开资料会在短时间内同步；操作会写入审计日志。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border bg-muted/40 p-3 text-xs">
              <p className="text-sm font-medium">
                {revokeTarget?.displayName ?? '未设置展示名称'}
              </p>
              <p className="mt-0.5 font-mono text-[11px] break-all text-muted-foreground">
                {revokeTarget?.subject}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="revoke-reason">撤销说明（可选）</Label>
              <Input
                id="revoke-reason"
                value={revokeReason}
                onChange={(event) => {
                  setRevokeReason(event.target.value)
                  setRevokeError(null)
                }}
                placeholder="例如：认证信息变更，等待重新核验"
                maxLength={500}
                disabled={revoking}
              />
              <p className="text-xs text-muted-foreground">撤销说明会对账号公开显示。</p>
            </div>
            {revokeError ? (
              <p
                role="alert"
                className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                {revokeError}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRevokeTarget(null)}
              disabled={revoking}
            >
              取消
            </Button>
            <Button variant="destructive" onClick={confirmRevoke} disabled={revoking}>
              {revoking ? <LoaderCircleIcon className="animate-spin" /> : null}
              确认撤销
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
