'use client'

import { useEffect, useState } from 'react'
import { InboxIcon, LoaderCircleIcon, PlusIcon, RotateCcwIcon } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/page-header'
import { EmptyState, ErrorState, LoadingState } from '@/components/data-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
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
import { AdminApiError } from '@/lib/api/admin-client'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type { ModerationSubjectType, QueueView } from '@/lib/data/types'
import { describeAdminError } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { reportTypeLabel, subjectTypeLabels } from '@/lib/moderation'

type LoadStatus = 'loading' | 'ready' | 'error'
type QueueDialog = 'create' | 'edit' | 'delete' | 'assign' | 'route' | null

const SUBJECT_TYPES: ModerationSubjectType[] = ['account', 'record', 'message', 'conversation']
const NAME_LIMIT = 60
const DESCRIPTION_LIMIT = 200

function parseTypes(value: string): string[] {
  const seen = new Set<string>()
  const items: string[] = []
  for (const raw of value.split(/[,\uFF0C\s]+/)) {
    const item = raw.trim()
    if (!item) continue
    const key = item.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    items.push(item)
  }
  return items
}

export default function QueuesPage() {
  const provider = useDataProvider()
  const { pageSize } = useWorkspace()
  const { identity } = useAuth()
  const canRead = hasPermission(identity, 'moderation.read')
  const canManage = hasPermission(identity, 'moderation.queue.manage')

  const [queues, setQueues] = useState<QueueView[]>([])
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [enabledFilter, setEnabledFilter] = useState<'all' | 'enabled' | 'disabled'>('all')

  const [dialog, setDialog] = useState<QueueDialog>(null)
  const [target, setTarget] = useState<QueueView | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [subjectTypes, setSubjectTypes] = useState<ModerationSubjectType[]>([])
  const [collection, setCollection] = useState('')
  const [reportTypes, setReportTypes] = useState('')
  const [migrateTo, setMigrateTo] = useState('')
  const [assignee, setAssignee] = useState('')
  const [startReportId, setStartReportId] = useState('')
  const [endReportId, setEndReportId] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [page, setPage] = useState(1)
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined])
  const [nextCursor, setNextCursor] = useState<string | undefined>()

  useEffect(() => {
    if (!canRead) return
    let active = true
    const cursor = cursors[page - 1]
    setStatus('loading')
    setError(null)
    provider
      .listQueues({
        cursor,
        limit: pageSize,
        enabled: enabledFilter === 'all' ? undefined : enabledFilter === 'enabled',
      })
      .then((result) => {
        if (!active) return
        setQueues(result.queues)
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
  }, [provider, canRead, pageSize, cursors, page, enabledFilter, reloadToken])

  function resetPaging() {
    setPage(1)
    setCursors([undefined])
  }

  function reopen(kind: QueueDialog, queue: QueueView | null) {
    setTarget(queue)
    setDialog(kind)
    setFormError(null)
    setSaving(false)
    setName(queue?.name ?? '')
    setDescription(queue?.description ?? '')
    setEnabled(queue?.enabled ?? true)
    setSubjectTypes(queue?.subjectTypes ?? [])
    setCollection(queue?.collection ?? '')
    setReportTypes((queue?.reportTypes ?? []).join('，'))
    setMigrateTo('')
    setAssignee('')
    setStartReportId('')
    setEndReportId('')
  }

  function closeDialog() {
    if (saving) return
    setDialog(null)
    setTarget(null)
    setFormError(null)
  }

  function toggleSubjectType(type: ModerationSubjectType, checked: boolean) {
    setSubjectTypes((current) =>
      checked ? [...current, type] : current.filter((item) => item !== type),
    )
  }

  async function submitQueueForm() {
    if (saving) return
    const trimmedName = name.trim()
    if (!trimmedName) {
      setFormError('请填写队列名称。')
      return
    }
    if (trimmedName.length > NAME_LIMIT) {
      setFormError(`队列名称不能超过 ${NAME_LIMIT} 个字符。`)
      return
    }
    if (description.trim().length > DESCRIPTION_LIMIT) {
      setFormError(`队列说明不能超过 ${DESCRIPTION_LIMIT} 个字符。`)
      return
    }
    const types = parseTypes(reportTypes)
    if (types.length > 50) {
      setFormError('举报类型最多 50 个。')
      return
    }
    const longType = types.find((item) => item.length > 128)
    if (longType) {
      setFormError('单个举报类型不能超过 128 个字符。')
      return
    }
    setFormError(null)
    setSaving(true)
    try {
      const input = {
        action: dialog === 'edit' ? ('update' as const) : ('create' as const),
        ...(target ? { queueId: target.id } : {}),
        name: trimmedName,
        enabled,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(subjectTypes.length > 0 ? { subjectTypes } : {}),
        ...(collection.trim() ? { collection: collection.trim() } : {}),
        ...(types.length > 0 ? { reportTypes: types } : {}),
      }
      await provider.actOnQueue(input)
      toast.success(dialog === 'edit' ? '举报队列已更新。' : '举报队列已创建。')
      setDialog(null)
      setTarget(null)
      setReloadToken((value) => value + 1)
    } catch (cause) {
      setFormError(describeAdminError(cause))
    } finally {
      setSaving(false)
    }
  }

  async function toggleEnabled(queue: QueueView) {
    if (!canManage || saving) return
    setSaving(true)
    try {
      await provider.actOnQueue({
        action: 'update',
        queueId: queue.id,
        enabled: !queue.enabled,
      })
      toast.success(queue.enabled ? '举报队列已停用。' : '举报队列已启用。')
      setReloadToken((value) => value + 1)
    } catch (cause) {
      toast.error(describeAdminError(cause))
    } finally {
      setSaving(false)
    }
  }

  async function deleteQueue() {
    if (!target || saving) return
    setSaving(true)
    setFormError(null)
    try {
      const result = await provider.actOnQueue({
        action: 'delete',
        queueId: target.id,
        ...(migrateTo ? { migrateToQueueId: Number(migrateTo) } : {}),
      })
      toast.success(
        result.reportsMigrated ? `队列已删除，迁移 ${result.reportsMigrated} 条举报。` : '举报队列已删除。',
      )
      setDialog(null)
      setTarget(null)
      setReloadToken((value) => value + 1)
    } catch (cause) {
      if (cause instanceof AdminApiError && cause.code === 'QueueNotEmpty') {
        setFormError('该队列仍有待处理举报，请选择迁移目标队列后再删除。')
      } else {
        setFormError(describeAdminError(cause))
      }
    } finally {
      setSaving(false)
    }
  }

  async function assignQueue() {
    if (!target || saving) return
    const did = assignee.trim()
    if (!/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/.test(did)) {
      setFormError('请填写完整的审核员账号标识，例如 did:plc:…')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await provider.actOnQueue({ action: 'assign', queueId: target.id, did })
      toast.success('已将该审核员指派到举报队列。')
      setDialog(null)
      setTarget(null)
    } catch (cause) {
      setFormError(describeAdminError(cause))
    } finally {
      setSaving(false)
    }
  }

  async function routeReports() {
    if (!target || saving) return
    const start = Number(startReportId)
    const end = Number(endReportId)
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 1 ||
      end < 1 ||
      start > end
    ) {
      setFormError('请填写有效的起始与结束举报编号，起始编号不能大于结束编号。')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const result = await provider.actOnQueue({
        action: 'route',
        startReportId: start,
        endReportId: end,
      })
      toast.success(
        `路由完成：已分配 ${result.assigned ?? 0} 条，未匹配 ${result.unmatched ?? 0} 条。`,
      )
      setDialog(null)
      setTarget(null)
      setReloadToken((value) => value + 1)
    } catch (cause) {
      setFormError(describeAdminError(cause))
    } finally {
      setSaving(false)
    }
  }

  if (!canRead) {
    return (
      <div className="space-y-5">
        <PageHeader title="举报队列" description="维护举报分流队列与审核员指派。" />
        <Card className="py-0">
          <EmptyState
            icon={InboxIcon}
            title="没有查看举报队列的权限"
            message="如需维护举报队列，请联系管理员开通审核权限。"
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="举报队列"
        description="按对象类型与举报类型分流举报；删除队列前可把未结案举报迁移到其他队列。"
        actions={
          <div className="flex items-center gap-2">
            <Select
              value={enabledFilter}
              onChange={(event) => {
                setEnabledFilter(event.target.value as 'all' | 'enabled' | 'disabled')
                resetPaging()
              }}
              className="w-32"
              aria-label="按启用状态过滤"
            >
              <option value="all">全部状态</option>
              <option value="enabled">已启用</option>
              <option value="disabled">已停用</option>
            </Select>
            <Button
              size="sm"
              onClick={() => reopen('create', null)}
              disabled={!canManage}
            >
              <PlusIcon />
              新建队列
            </Button>
          </div>
        }
      />

      {!canManage ? (
        <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-relaxed">
          当前账号可以查看举报队列，但没有管理权限。如需新建、修改或删除队列，请联系管理员开通队列管理权限。
        </p>
      ) : null}

      <Card className="gap-0 py-0">
        {status === 'error' ? (
          <ErrorState
            title="举报队列加载失败"
            message={error ?? '操作失败，请稍后重试。'}
            onRetry={() => setReloadToken((value) => value + 1)}
          />
        ) : status === 'loading' && queues.length === 0 ? (
          <LoadingState label="正在加载举报队列…" />
        ) : queues.length === 0 ? (
          <EmptyState
            icon={InboxIcon}
            title="暂无举报队列"
            message={
              canManage
                ? '尚未创建举报队列。创建队列后，举报会按对象类型与举报类型自动分流。'
                : '尚未创建举报队列，请联系管理员创建。'
            }
            action={
              canManage ? (
                <Button variant="outline" size="sm" onClick={() => reopen('create', null)}>
                  新建队列
                </Button>
              ) : null
            }
          />
        ) : (
          <Table aria-busy={status === 'loading'}>
            <TableHeader>
              <TableRow>
                <TableHead>队列</TableHead>
                <TableHead className="w-24">状态</TableHead>
                <TableHead>分流规则</TableHead>
                <TableHead className="w-24 text-right">待处理</TableHead>
                <TableHead className="w-24 text-right">已结案</TableHead>
                <TableHead className="w-40">更新时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queues.map((queue) => (
                <TableRow key={queue.id}>
                  <TableCell>
                    <p className="text-sm font-medium">{queue.name}</p>
                    {queue.description ? (
                      <p className="mt-0.5 max-w-72 truncate text-xs text-muted-foreground">
                        {queue.description}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant={queue.enabled ? 'success' : 'outline'}>
                      {queue.enabled ? '已启用' : '已停用'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      {(queue.subjectTypes ?? []).map((type) => (
                        <Badge key={type} variant="muted">
                          {subjectTypeLabels[type]}
                        </Badge>
                      ))}
                      {queue.collection ? (
                        <Badge variant="outline">集合 {queue.collection}</Badge>
                      ) : null}
                      {(queue.reportTypes ?? []).slice(0, 2).map((type) => (
                        <Badge key={type} variant="secondary">
                          {reportTypeLabel(type)}
                        </Badge>
                      ))}
                      {(queue.reportTypes ?? []).length > 2 ? (
                        <Badge variant="secondary">
                          +{(queue.reportTypes ?? []).length - 2}
                        </Badge>
                      ) : null}
                      {(queue.subjectTypes ?? []).length === 0 &&
                      !queue.collection &&
                      (queue.reportTypes ?? []).length === 0 ? (
                        <span className="text-xs text-muted-foreground">接收全部举报</span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {queue.stats?.pendingCount ?? 0}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {queue.stats?.closedCount ?? 0}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                    {formatDateTime(queue.updatedAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" disabled={!canManage || saving}>
                          管理
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => reopen('edit', queue)}>
                          编辑队列
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void toggleEnabled(queue)}>
                          {queue.enabled ? '停用队列' : '启用队列'}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => reopen('assign', queue)}>
                          指派审核员
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => reopen('route', queue)}>
                          路由历史举报
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onSelect={() => reopen('delete', queue)}
                        >
                          删除队列
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <div className="flex flex-col gap-2 border-t px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            当前第 {page} 页，本页 {queues.length} 条
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
        open={dialog === 'create' || dialog === 'edit'}
        onOpenChange={(open) => {
          if (!open) closeDialog()
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{dialog === 'edit' ? '编辑举报队列' : '新建举报队列'}</DialogTitle>
            <DialogDescription>
              队列按对象类型、内容集合与举报类型筛选举报；留空表示接收全部举报。
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-4 overflow-auto pr-1">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="queue-name">
                队列名称
              </label>
              <Input
                id="queue-name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  setFormError(null)
                }}
                maxLength={NAME_LIMIT}
                disabled={saving}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="queue-description">
                队列说明（可选）
              </label>
              <Textarea
                id="queue-description"
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value)
                  setFormError(null)
                }}
                maxLength={DESCRIPTION_LIMIT}
                rows={2}
                disabled={saving}
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">接收的对象类型</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {SUBJECT_TYPES.map((type) => (
                  <label key={type} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={subjectTypes.includes(type)}
                      onCheckedChange={(checked) => toggleSubjectType(type, checked === true)}
                      disabled={saving}
                    />
                    {subjectTypeLabels[type]}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="queue-collection">
                  内容类型标识（可选）
                </label>
                <Input
                  id="queue-collection"
                  value={collection}
                  onChange={(event) => {
                    setCollection(event.target.value)
                    setFormError(null)
                  }}
                  placeholder="填写内容类型的技术标识"
                  className="font-mono text-xs"
                  disabled={saving}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="queue-report-types">
                  举报类型（可选）
                </label>
                <Input
                  id="queue-report-types"
                  value={reportTypes}
                  onChange={(event) => {
                    setReportTypes(event.target.value)
                    setFormError(null)
                  }}
                  placeholder="用逗号分隔"
                  className="text-xs"
                  disabled={saving}
                />
              </div>
            </div>
            <label className="flex items-center justify-between rounded-lg border px-3 py-2">
              <span className="space-y-0.5">
                <span className="block text-sm font-medium">启用队列</span>
                <span className="block text-xs text-muted-foreground">
                  停用后新举报不再进入该队列，已进入的举报保持原状。
                </span>
              </span>
              <Switch checked={enabled} onCheckedChange={setEnabled} disabled={saving} />
            </label>
            {formError ? (
              <p role="alert" className="text-xs text-destructive">
                {formError}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={saving}>
              取消
            </Button>
            <Button onClick={() => void submitQueueForm()} disabled={saving}>
              {saving ? <LoaderCircleIcon className="animate-spin" /> : null}
              {dialog === 'edit' ? '保存修改' : '创建队列'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialog === 'delete'}
        onOpenChange={(open) => {
          if (!open) closeDialog()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除举报队列</DialogTitle>
            <DialogDescription>
              删除后无法恢复。若队列中仍有待处理举报，请选择迁移目标队列；未选择迁移目标时，服务端会拒绝删除非空队列。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm">
              即将删除：<span className="font-medium">{target?.name}</span>
            </p>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="queue-migrate">
                迁移目标队列（可选）
              </label>
              <Select
                id="queue-migrate"
                value={migrateTo}
                onChange={(event) => {
                  setMigrateTo(event.target.value)
                  setFormError(null)
                }}
                disabled={saving}
              >
                <option value="">不迁移</option>
                {queues
                  .filter((queue) => queue.id !== target?.id)
                  .map((queue) => (
                    <option key={queue.id} value={queue.id}>
                      {queue.name}
                    </option>
                  ))}
              </Select>
            </div>
            {formError ? (
              <p role="alert" className="text-xs text-destructive">
                {formError}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={saving}>
              取消
            </Button>
            <Button variant="destructive" onClick={() => void deleteQueue()} disabled={saving}>
              {saving ? <LoaderCircleIcon className="animate-spin" /> : null}
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialog === 'assign'}
        onOpenChange={(open) => {
          if (!open) closeDialog()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>指派审核员</DialogTitle>
            <DialogDescription>
              将审核员指派到「{target?.name}」队列，指派记录会写入审计日志。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="queue-assignee">
              审核员账号标识
            </label>
            <Input
              id="queue-assignee"
              value={assignee}
              onChange={(event) => {
                setAssignee(event.target.value)
                setFormError(null)
              }}
              placeholder="did:plc:…"
              className="font-mono text-xs"
              disabled={saving}
            />
            {formError ? (
              <p role="alert" className="text-xs text-destructive">
                {formError}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={saving}>
              取消
            </Button>
            <Button onClick={() => void assignQueue()} disabled={saving}>
              {saving ? <LoaderCircleIcon className="animate-spin" /> : null}
              确认指派
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialog === 'route'}
        onOpenChange={(open) => {
          if (!open) closeDialog()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>路由历史举报</DialogTitle>
            <DialogDescription>
              按举报编号区间重新应用「{target?.name}」队列的分流规则，已匹配的举报会进入该队列。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="route-start">
                起始举报编号
              </label>
              <Input
                id="route-start"
                inputMode="numeric"
                value={startReportId}
                onChange={(event) => {
                  setStartReportId(event.target.value)
                  setFormError(null)
                }}
                disabled={saving}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="route-end">
                结束举报编号
              </label>
              <Input
                id="route-end"
                inputMode="numeric"
                value={endReportId}
                onChange={(event) => {
                  setEndReportId(event.target.value)
                  setFormError(null)
                }}
                disabled={saving}
              />
            </div>
          </div>
          {formError ? (
            <p role="alert" className="text-xs text-destructive">
              {formError}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={saving}>
              取消
            </Button>
            <Button onClick={() => void routeReports()} disabled={saving}>
              {saving ? <LoaderCircleIcon className="animate-spin" /> : null}
              开始路由
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <RotateCcwIcon className="size-3.5" />
        队列规则变更只影响后续举报；历史举报可通过“路由历史举报”按编号区间重新分流。
      </p>
    </div>
  )
}
