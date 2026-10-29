'use client'

import { useEffect, useState, type FormEvent } from 'react'
import {
  InfoIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { EmptyState, ErrorState, LoadingState } from '@/components/data-state'
import { useAuth } from '@/components/auth/auth-provider'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { hasPermission } from '@/lib/access'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type { RoleBinding } from '@/lib/data/types'
import { describeAdminError } from '@/lib/errors'
import { formatDateTime, truncateDid } from '@/lib/format'
import { roleDescriptions, roleLabels, type RoleName } from '@/lib/roles'

const DID_PATTERN = /^did:(plc|web):[A-Za-z0-9._:%-]+$/
const PAGE_SIZE = 10

type LoadStatus = 'loading' | 'ready' | 'error'

function RoleBadge({ role }: { role: RoleName }) {
  return (
    <Badge
      variant={role === 'admin' ? 'default' : role === 'operator' ? 'secondary' : 'outline'}
    >
      {roleLabels[role]}
    </Badge>
  )
}

function mutationMessage(error: unknown): string {
  if (error instanceof AdminApiError) {
    if (error.code === 'RoleExists') return '该 DID 已有角色，请改为修改角色。'
    if (error.code === 'LastAdmin') return '不能撤销或降级最后一名管理员。'
    if (error.code === 'RoleNotFound') return '该角色绑定已不存在，请刷新列表后重试。'
    if (error.code === 'InvalidRequest') return 'DID 或角色不合法，请检查后重试。'
  }
  return describeAdminError(error)
}

export default function RolesPage() {
  const provider = useDataProvider()
  const { identity, preview } = useAuth()
  const canWrite = hasPermission(identity, 'role.write')

  const [roles, setRoles] = useState<RoleBinding[]>([])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [listError, setListError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | RoleName>('all')
  const [page, setPage] = useState(1)
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined])
  const [nextCursor, setNextCursor] = useState<string | undefined>()

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<RoleBinding | null>(null)
  const [subject, setSubject] = useState('')
  const [role, setRole] = useState<RoleName>('operator')
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [revokeTarget, setRevokeTarget] = useState<RoleBinding | null>(null)
  const [revokeError, setRevokeError] = useState<string | null>(null)
  const [revoking, setRevoking] = useState(false)

  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (search === debouncedSearch) return
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
      setCursors([undefined])
    }, 300)
    return () => window.clearTimeout(timer)
  }, [search, debouncedSearch])

  useEffect(() => {
    let active = true
    const cursor = cursors[page - 1]
    setStatus('loading')
    setListError(null)

    provider
      .listRoles({
        cursor,
        limit: PAGE_SIZE,
        role: roleFilter === 'all' ? undefined : roleFilter,
        search: debouncedSearch.trim() || undefined,
      })
      .then((result) => {
        if (!active) return
        setRoles(result.roles)
        setTotal(result.total)
        setNextCursor(result.cursor)
        setStatus('ready')
        const maxPage = Math.max(1, Math.ceil(result.total / PAGE_SIZE))
        if (page > maxPage) {
          setPage(maxPage)
          setCursors((current) => current.slice(0, maxPage))
        }
      })
      .catch((error: unknown) => {
        if (!active) return
        setListError(describeAdminError(error))
        setStatus('error')
      })

    return () => {
      active = false
    }
  }, [provider, cursors, page, roleFilter, debouncedSearch, reloadToken])

  function reload() {
    setReloadToken((value) => value + 1)
  }

  function resetPaging() {
    setPage(1)
    setCursors([undefined])
  }

  function openCreate() {
    setEditing(null)
    setSubject('')
    setRole('operator')
    setNote('')
    setFormError(null)
    setNotice(null)
    setFormOpen(true)
  }

  function openEdit(binding: RoleBinding) {
    setEditing(binding)
    setSubject(binding.subject)
    setRole(binding.role)
    setNote(binding.note ?? '')
    setFormError(null)
    setNotice(null)
    setFormOpen(true)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextSubject = subject.trim()

    if (!DID_PATTERN.test(nextSubject)) {
      setFormError('请输入合法的 DID，例如 did:plc:… 或 did:web:…')
      return
    }

    setSaving(true)
    setFormError(null)
    try {
      if (editing) {
        await provider.updateRole({
          subject: editing.subject,
          role,
          note: note.trim() || undefined,
        })
        setNotice(`已更新 ${truncateDid(editing.subject, 24, 8)} 的角色`)
      } else {
        await provider.createRole({
          subject: nextSubject,
          role,
          note: note.trim() || undefined,
        })
        setNotice(`已授予 ${truncateDid(nextSubject, 24, 8)} ${roleLabels[role]}角色`)
        resetPaging()
      }
      setFormOpen(false)
      reload()
    } catch (error) {
      setFormError(mutationMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function confirmRevoke() {
    if (!revokeTarget) return
    setRevoking(true)
    setRevokeError(null)
    try {
      await provider.revokeRole(revokeTarget.subject)
      setNotice(`已撤销 ${truncateDid(revokeTarget.subject, 24, 8)} 的角色`)
      setRevokeTarget(null)
      reload()
    } catch (error) {
      setRevokeError(mutationMessage(error))
      if (error instanceof AdminApiError && error.code === 'RoleNotFound') {
        setRevokeTarget(null)
        reload()
      }
    } finally {
      setRevoking(false)
    }
  }

  const pageStart = (page - 1) * PAGE_SIZE
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const showInitialLoading = status === 'loading' && roles.length === 0
  const hasFilters = search.trim() !== '' || roleFilter !== 'all'

  return (
    <div className="space-y-5">
      <PageHeader
        title="管理员与角色"
        description="按 DID 授予后台角色；高风险操作由服务端校验并写入审计。"
        actions={
          canWrite ? (
            <Button size="sm" onClick={openCreate}>
              <PlusIcon />
              新增角色
            </Button>
          ) : (
            <Badge variant="outline">只读视图</Badge>
          )
        }
      />

      {preview ? (
        <div className="flex items-start gap-2 rounded-lg border border-dashed bg-muted/40 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          <InfoIcon className="mt-0.5 size-4 shrink-0" />
          界面预览：本页修改只保存在浏览器内。使用 PDS 账号登录后将写入数据库并生成审计记录。
        </div>
      ) : null}

      {notice ? (
        <div
          role="status"
          className="rounded-lg border border-success/30 bg-success/10 px-4 py-2.5 text-xs text-success"
        >
          {notice}
        </div>
      ) : null}

      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-xs">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索 DID、备注或授权人"
              className="pl-9"
              aria-label="搜索角色"
            />
          </div>
          <Select
            value={roleFilter}
            onChange={(event) => {
              setRoleFilter(event.target.value as 'all' | RoleName)
              resetPaging()
            }}
            className="sm:w-40"
            aria-label="按角色筛选"
          >
            <option value="all">全部角色</option>
            {(Object.keys(roleLabels) as RoleName[]).map((item) => (
              <option key={item} value={item}>
                {roleLabels[item]}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground sm:ml-auto">共 {total} 条</p>
        </div>

        {status === 'error' ? (
          <ErrorState
            title="角色列表加载失败"
            message={listError ?? '操作失败，请稍后重试。'}
            onRetry={reload}
          />
        ) : showInitialLoading ? (
          <LoadingState label="正在加载角色绑定…" />
        ) : roles.length === 0 ? (
          <EmptyState
            icon={SearchIcon}
            title="没有匹配的角色绑定"
            message="调整搜索词或角色筛选后再试。"
            action={
              hasFilters ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSearch('')
                    setDebouncedSearch('')
                    setRoleFilter('all')
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
                <TableHead>成员</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>授权人</TableHead>
                <TableHead>更新时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.map((binding) => (
                <TableRow key={binding.subject}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                        {(binding.note ?? roleLabels[binding.role]).slice(0, 1)}
                      </span>
                      <div className="min-w-0">
                        <p className="font-mono text-xs font-medium" title={binding.subject}>
                          {truncateDid(binding.subject, 22, 8)}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {binding.note ?? '未填写备注'}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <RoleBadge role={binding.role} />
                  </TableCell>
                  <TableCell
                    className="font-mono text-xs text-muted-foreground"
                    title={binding.grantedBy}
                  >
                    {binding.grantedBy === 'system'
                      ? '系统引导'
                      : truncateDid(binding.grantedBy, 18, 6)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDateTime(binding.updatedAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    {canWrite ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label="角色操作">
                            <MoreHorizontalIcon />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => openEdit(binding)}>
                            <PencilIcon />
                            修改角色
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => {
                              setRevokeError(null)
                              setNotice(null)
                              setRevokeTarget(binding)
                            }}
                          >
                            <Trash2Icon />
                            撤销角色
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <div className="flex flex-col gap-2 border-t px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            共 {total} 条
            {total > 0 ? `，第 ${pageStart + 1}–${pageStart + roles.length} 条` : ''}
            {preview ? ' · 预览数据' : ''}
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
      </Card>

      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          if (!open && !saving) setFormOpen(false)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? '修改角色' : '新增角色'}</DialogTitle>
            <DialogDescription>
              角色在服务端校验；授予、修改与撤销都会写入审计。
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-1.5">
              <label htmlFor="role-subject" className="text-sm font-medium">
                成员 DID
              </label>
              <Input
                id="role-subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                disabled={Boolean(editing) || saving}
                placeholder="did:plc:… 或 did:web:…"
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">仅支持已存在的 AT Protocol 身份。</p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="role-name" className="text-sm font-medium">
                角色
              </label>
              <Select
                id="role-name"
                value={role}
                onChange={(event) => setRole(event.target.value as RoleName)}
                className="w-full"
                disabled={saving}
              >
                {(Object.keys(roleLabels) as RoleName[]).map((item) => (
                  <option key={item} value={item}>
                    {roleLabels[item]} — {roleDescriptions[item]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="role-note" className="text-sm font-medium">
                备注
              </label>
              <Input
                id="role-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="例如：内容运营"
                disabled={saving}
              />
            </div>
            {formError ? (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {formError}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setFormOpen(false)}
                disabled={saving}
              >
                取消
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? <LoaderCircleIcon className="animate-spin" /> : null}
                {editing ? '保存修改' : '授予角色'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open && !revoking) {
            setRevokeTarget(null)
            setRevokeError(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>撤销角色</DialogTitle>
            <DialogDescription>
              撤销后该成员将立即失去后台权限，操作会写入审计。
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-muted/40 p-3 font-mono text-xs break-all">
            {revokeTarget?.subject}
          </div>
          {revokeError ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {revokeError}
            </p>
          ) : null}
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
