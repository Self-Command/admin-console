'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AtSignIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  MailIcon,
  ShieldAlertIcon,
  TicketIcon,
  Trash2Icon,
} from 'lucide-react'
import { toast } from 'sonner'
import { ApprovalRequestDialog } from '@/components/security/approval-request-dialog'
import { EmptyState, ErrorState, LoadingState } from '@/components/data-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  accountAdminDeleteApprovalDraft,
  accountAdminUpdateApprovalDraft,
  isApprovalRequired,
  type ApprovalRequestDraft,
} from '@/lib/approvals'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type { AccountAdminInfo, AccountAdminUpdateInput } from '@/lib/data/types'
import { describeAdminError, isNotConfigured } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'

type LoadState = 'loading' | 'ready' | 'error' | 'unavailable'

const HANDLE_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i
const PASSWORD_MIN = 8
const PASSWORD_MAX = 256

function emailProblem(value: string): string | null {
  if (!value) return null
  if (value.length > 320) return '邮箱最长 320 个字符。'
  if (!value.includes('@') || /\s/.test(value)) return '邮箱格式不正确，请填写完整的邮箱地址。'
  return null
}

function handleProblem(value: string): string | null {
  if (!value) return null
  if (value.length > 253) return '账号名最长 253 个字符。'
  if (!HANDLE_PATTERN.test(value)) return '账号名应为域名格式，例如 alice.example.com。'
  return null
}

function passwordProblem(value: string, confirmation: string): string | null {
  if (!value) return null
  if (value.length < PASSWORD_MIN || value.length > PASSWORD_MAX) {
    return `密码长度需在 ${PASSWORD_MIN} 到 ${PASSWORD_MAX} 个字符之间。`
  }
  if (value !== confirmation) return '两次输入的密码不一致。'
  return null
}

export function AccountAdminPanel({
  did,
  handle,
  canManage,
}: {
  did: string
  handle?: string
  canManage: boolean
}) {
  const provider = useDataProvider()
  const router = useRouter()

  const [state, setState] = useState<LoadState>('loading')
  const [info, setInfo] = useState<AccountAdminInfo | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const [email, setEmail] = useState('')
  const [handleInput, setHandleInput] = useState('')
  const [profileError, setProfileError] = useState<string | null>(null)
  const [savingProfile, setSavingProfile] = useState(false)

  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [savingPassword, setSavingPassword] = useState(false)

  const [disableOpen, setDisableOpen] = useState(false)
  const [disabling, setDisabling] = useState(false)
  const [disableError, setDisableError] = useState<string | null>(null)

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [approvalDraft, setApprovalDraft] = useState<ApprovalRequestDraft | null>(null)

  useEffect(() => {
    if (!canManage) return
    let active = true
    setState('loading')
    setLoadError(null)
    provider
      .getAccountAdminInfo(did)
      .then((result) => {
        if (!active) return
        setInfo(result)
        setEmail(result.email ?? '')
        setHandleInput(result.handle ?? '')
        setState('ready')
      })
      .catch((cause: unknown) => {
        if (!active) return
        if (isNotConfigured(cause)) {
          setState('unavailable')
          return
        }
        setLoadError(describeAdminError(cause))
        setState('error')
      })
    return () => {
      active = false
    }
  }, [provider, did, canManage, reloadToken])

  function reload() {
    setReloadToken((value) => value + 1)
  }

  async function saveProfile() {
    if (savingProfile) return
    const nextEmail = email.trim()
    const nextHandle = handleInput.trim()
    const problem = emailProblem(nextEmail) ?? handleProblem(nextHandle)
    if (problem) {
      setProfileError(problem)
      return
    }
    const changes: AccountAdminUpdateInput = {
      did,
      ...(nextEmail && nextEmail !== (info?.email ?? '') ? { email: nextEmail } : {}),
      ...(nextHandle && nextHandle !== (info?.handle ?? '') ? { handle: nextHandle } : {}),
    }
    if (!changes.email && !changes.handle) {
      setProfileError('邮箱与账号名均未变更，请修改后再保存。')
      return
    }
    setProfileError(null)
    setSavingProfile(true)
    try {
      await provider.updateAccountAdmin(changes)
      toast.success('账号资料已更新。')
      reload()
    } catch (cause) {
      if (isApprovalRequired(cause)) {
        setApprovalDraft(accountAdminUpdateApprovalDraft(changes))
        return
      }
      if (isNotConfigured(cause)) {
        setState('unavailable')
        return
      }
      setProfileError(describeAdminError(cause))
    } finally {
      setSavingProfile(false)
    }
  }

  async function savePassword() {
    if (savingPassword) return
    if (!password) {
      setPasswordError('请输入新密码。')
      return
    }
    const problem = passwordProblem(password, passwordConfirmation)
    if (problem) {
      setPasswordError(problem)
      return
    }
    setPasswordError(null)
    setSavingPassword(true)
    const changes: AccountAdminUpdateInput = { did, password }
    try {
      await provider.updateAccountAdmin(changes)
      toast.success('账号密码已重置。')
      setPassword('')
      setPasswordConfirmation('')
      reload()
    } catch (cause) {
      if (isApprovalRequired(cause)) {
        setApprovalDraft(accountAdminUpdateApprovalDraft(changes))
        setPassword('')
        setPasswordConfirmation('')
        return
      }
      if (isNotConfigured(cause)) {
        setState('unavailable')
        return
      }
      setPasswordError(describeAdminError(cause))
    } finally {
      setSavingPassword(false)
    }
  }

  async function confirmDisableInvites() {
    if (disabling) return
    setDisabling(true)
    setDisableError(null)
    try {
      await provider.disableAccountInvites({ did })
      toast.success('已停用该账号创建的邀请码。')
      setDisableOpen(false)
      reload()
    } catch (cause) {
      if (isNotConfigured(cause)) {
        setDisableOpen(false)
        setState('unavailable')
        return
      }
      setDisableError(describeAdminError(cause))
    } finally {
      setDisabling(false)
    }
  }

  async function confirmDelete() {
    if (deleting) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await provider.deleteAccountAdmin(did)
      toast.success('账号已删除。')
      setDeleteOpen(false)
      router.push('/directory')
    } catch (cause) {
      if (isApprovalRequired(cause)) {
        setDeleteOpen(false)
        setApprovalDraft(accountAdminDeleteApprovalDraft(did, info?.handle ?? handle))
        return
      }
      if (isNotConfigured(cause)) {
        setDeleteOpen(false)
        setState('unavailable')
        return
      }
      setDeleteError(describeAdminError(cause))
    } finally {
      setDeleting(false)
    }
  }

  if (!canManage) {
    return (
      <Card className="py-0">
        <EmptyState
          icon={ShieldAlertIcon}
          title="没有账号资料管理权限"
          message="当前账号只能查看账号目录与运营记录。如需修改邮箱、账号名或密码，请联系具备账号管理权限的管理员。"
        />
      </Card>
    )
  }

  if (state === 'loading') {
    return (
      <Card className="py-0">
        <LoadingState label="正在读取账号资料…" />
      </Card>
    )
  }

  if (state === 'unavailable') {
    return (
      <Card className="py-0">
        <EmptyState
          icon={ShieldAlertIcon}
          title="账号资料管理暂不可用"
          message="当前部署尚未配置账号服务的管理员凭据，暂时无法读取或修改账号资料。请联系部署管理员完成配置后重试。"
          action={
            <Button variant="outline" size="sm" onClick={reload}>
              重新检查
            </Button>
          }
        />
      </Card>
    )
  }

  if (state === 'error' || !info) {
    return (
      <Card className="py-0">
        <ErrorState
          title="账号资料加载失败"
          message={loadError ?? '操作失败，请稍后重试。'}
          onRetry={reload}
        />
      </Card>
    )
  }

  const invites = info.invites ?? []
  const expectedConfirmation = info.handle ?? did
  const confirmMatches = deleteConfirmation.trim() === expectedConfirmation

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MailIcon className="size-4 text-muted-foreground" />
            账号资料
          </CardTitle>
          <CardDescription>
            资料由账号服务维护。保存后立即生效；当前工作区存在多位管理员时，系统会要求另一位管理员批准后执行。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">邮箱</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-2">
                <span>{info.email ?? '未绑定邮箱'}</span>
                {info.email ? (
                  <Badge variant={info.emailConfirmed ? 'success' : 'warning'}>
                    {info.emailConfirmed ? '已验证' : '未验证'}
                  </Badge>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">账号名</dt>
              <dd className="mt-1">{info.handle ?? '未设置账号名'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">目录索引时间</dt>
              <dd className="mt-1 text-xs">{formatDateTime(info.indexedAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">账号状态</dt>
              <dd className="mt-1 flex flex-wrap gap-2">
                {info.takedown ? <Badge variant="destructive">已下架</Badge> : null}
                {info.deactivatedAt ? <Badge variant="warning">已停用</Badge> : null}
                {!info.takedown && !info.deactivatedAt ? (
                  <Badge variant="success">正常</Badge>
                ) : null}
              </dd>
            </div>
          </dl>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="account-admin-email">邮箱</Label>
              <Input
                id="account-admin-email"
                type="email"
                value={email}
                inputMode="email"
                autoComplete="off"
                placeholder="alice@example.com"
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="account-admin-handle">账号名</Label>
              <div className="relative">
                <AtSignIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="account-admin-handle"
                  value={handleInput}
                  autoComplete="off"
                  placeholder="alice.example.com"
                  className="pl-8"
                  onChange={(event) => setHandleInput(event.target.value)}
                />
              </div>
            </div>
          </div>
          {profileError ? (
            <p role="alert" className="text-xs text-destructive">
              {profileError}
            </p>
          ) : null}
          <Button size="sm" onClick={saveProfile} disabled={savingProfile}>
            {savingProfile ? <LoaderCircleIcon className="animate-spin" /> : null}
            保存账号资料
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRoundIcon className="size-4 text-muted-foreground" />
              重置密码
            </CardTitle>
            <CardDescription>
              新密码在提交时加密保存，仅在另一位管理员批准后由账号服务执行重置；后台不会保留明文密码。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="account-admin-password">新密码</Label>
              <Input
                id="account-admin-password"
                type="password"
                value={password}
                autoComplete="new-password"
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="account-admin-password-confirm">确认新密码</Label>
              <Input
                id="account-admin-password-confirm"
                type="password"
                value={passwordConfirmation}
                autoComplete="new-password"
                onChange={(event) => setPasswordConfirmation(event.target.value)}
              />
            </div>
            {passwordError ? (
              <p role="alert" className="text-xs text-destructive">
                {passwordError}
              </p>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              onClick={savePassword}
              disabled={savingPassword}
            >
              {savingPassword ? <LoaderCircleIcon className="animate-spin" /> : null}
              重置密码
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TicketIcon className="size-4 text-muted-foreground" />
              邀请码
            </CardTitle>
            <CardDescription>
              邀请码用于新账号注册。停用后，该账号创建的全部邀请码将立即失效。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {info.invitesDisabled ? (
                <Badge variant="warning">已停用该账号创建的邀请码</Badge>
              ) : (
                <Badge variant="outline">邀请码可用</Badge>
              )}
              {info.invitedBy ? (
                <span>
                  该账号通过邀请码 {info.invitedBy.code} 注册（{formatDateTime(info.invitedBy.createdAt)}）
                </span>
              ) : (
                <span>没有记录该账号的注册邀请码。</span>
              )}
            </div>

            {invites.length === 0 ? (
              <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                该账号尚未创建邀请码。
              </p>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>邀请码</TableHead>
                      <TableHead>可用次数</TableHead>
                      <TableHead>使用次数</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>创建时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invites.map((invite) => (
                      <TableRow key={invite.code}>
                        <TableCell className="font-mono text-xs">{invite.code}</TableCell>
                        <TableCell>{invite.available}</TableCell>
                        <TableCell>{invite.usesCount}</TableCell>
                        <TableCell>
                          <Badge variant={invite.disabled ? 'outline' : 'success'}>
                            {invite.disabled ? '已停用' : '可用'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {formatDateTime(invite.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {disableError ? (
              <p role="alert" className="text-xs text-destructive">
                {disableError}
              </p>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setDisableError(null)
                setDisableOpen(true)
              }}
            >
              停用该账号创建的全部邀请码
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <Trash2Icon className="size-4" />
            删除账号
          </CardTitle>
          <CardDescription>
            删除后，该账号及其内容将被永久移除，操作无法撤销。删除前请确认已完成必要的资料留存。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => {
              setDeleteConfirmation('')
              setDeleteError(null)
              setDeleteOpen(true)
            }}
          >
            删除账号
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={disableOpen} onOpenChange={(open) => !disabling && setDisableOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>停用该账号创建的邀请码</AlertDialogTitle>
            <AlertDialogDescription>
              停用后，该账号此前创建且仍可用的邀请码将立即失效，已注册账号不受影响。是否继续？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disabling}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={disabling}
              onClick={(event) => {
                event.preventDefault()
                void confirmDisableInvites()
              }}
            >
              {disabling ? '正在停用…' : '确认停用'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => !deleting && setDeleteOpen(open)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除账号</AlertDialogTitle>
            <AlertDialogDescription>
              请输入账号名 <span className="font-mono">{expectedConfirmation}</span>{' '}
              以确认删除。删除后账号及其内容将被永久移除，操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            aria-label="确认删除的账号名"
            value={deleteConfirmation}
            autoComplete="off"
            onChange={(event) => setDeleteConfirmation(event.target.value)}
          />
          {deleteError ? (
            <p role="alert" className="text-xs text-destructive">
              {deleteError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting || !confirmMatches}
              onClick={(event) => {
                event.preventDefault()
                void confirmDelete()
              }}
            >
              {deleting ? '正在删除…' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ApprovalRequestDialog draft={approvalDraft} onClose={() => setApprovalDraft(null)} />
    </div>
  )
}
