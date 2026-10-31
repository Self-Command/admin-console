'use client'

import { useEffect, useState, type FormEvent } from 'react'
import {
  LoaderCircleIcon,
  MegaphoneIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/page-header'
import { EmptyState, ErrorState, LoadingState } from '@/components/data-state'
import { useAuth } from '@/components/auth/auth-provider'
import { useWorkspace } from '@/components/layout/workspace-provider'
import { ApprovalRequestDialog } from '@/components/security/approval-request-dialog'
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
import { hasPermission } from '@/lib/access'
import {
  announcementArchiveApprovalDraft,
  announcementPublishApprovalDraft,
  isApprovalRequired,
  type ApprovalRequestDraft,
} from '@/lib/approvals'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type {
  AnnouncementLevel,
  AnnouncementPlacement,
  AnnouncementStatus,
  AnnouncementView,
} from '@/lib/data/types'
import { describeAdminError } from '@/lib/errors'
import { formatTimestamp } from '@/lib/format'

type LoadState = 'loading' | 'ready' | 'error'
type StatusFilter = AnnouncementStatus | 'all'
type PlacementFilter = AnnouncementPlacement | 'all'

const TITLE_LIMIT = 120
const BODY_LIMIT = 5000

const levelLabels: Record<AnnouncementLevel, string> = {
  info: '通知',
  warning: '提醒',
  critical: '重要',
}

const levelVariants: Record<
  AnnouncementLevel,
  'secondary' | 'warning' | 'destructive'
> = {
  info: 'secondary',
  warning: 'warning',
  critical: 'destructive',
}

const statusLabels: Record<AnnouncementStatus, string> = {
  draft: '草稿',
  published: '已发布',
  archived: '已下线',
}

const statusVariants: Record<
  AnnouncementStatus,
  'muted' | 'success' | 'outline'
> = {
  draft: 'muted',
  published: 'success',
  archived: 'outline',
}

const placementLabels: Record<AnnouncementPlacement, string> = {
  admin: '管理后台',
  app: '客户端',
}

type EditorState =
  | { mode: 'create' }
  | { mode: 'edit'; announcement: AnnouncementView }

type StatusChange = {
  announcement: AnnouncementView
  action: 'publish' | 'archive'
}

type FormState = {
  title: string
  body: string
  level: AnnouncementLevel
  placement: AnnouncementPlacement
  startsAt: string
  endsAt: string
}

const EMPTY_FORM: FormState = {
  title: '',
  body: '',
  level: 'info',
  placement: 'app',
  startsAt: '',
  endsAt: '',
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function toLocalInput(iso?: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function toIso(value: string): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  return date.toISOString()
}

function windowLabel(item: AnnouncementView, format: 'date-time' | 'date'): string {
  const starts = item.startsAt ? formatTimestamp(item.startsAt, format) : '立即生效'
  const ends = item.endsAt ? formatTimestamp(item.endsAt, format) : '长期有效'
  return `${starts} 至 ${ends}`
}

export default function AnnouncementsPage() {
  const provider = useDataProvider()
  const { identity } = useAuth()
  const { pageSize, dateFormat } = useWorkspace()
  const canRead = hasPermission(identity, 'announcement.read')
  const canWrite = hasPermission(identity, 'announcement.write')
  const canPublish = hasPermission(identity, 'announcement.publish')

  const [status, setStatus] = useState<LoadState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<AnnouncementView[]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [reloadToken, setReloadToken] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [placementFilter, setPlacementFilter] = useState<PlacementFilter>('all')
  const [keyword, setKeyword] = useState('')
  const [applied, setApplied] = useState<{
    status: StatusFilter
    placement: PlacementFilter
    q: string
  }>({ status: 'all', placement: 'all', q: '' })

  const [editor, setEditor] = useState<EditorState | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [pendingChange, setPendingChange] = useState<StatusChange | null>(null)
  const [acting, setActing] = useState(false)
  const [approvalDraft, setApprovalDraft] = useState<ApprovalRequestDraft | null>(null)

  useEffect(() => {
    if (!canRead) return
    let active = true
    setStatus('loading')
    setError(null)
    provider
      .listAnnouncements({
        limit: pageSize,
        ...(applied.status === 'all' ? {} : { status: applied.status }),
        ...(applied.placement === 'all' ? {} : { placement: applied.placement }),
        ...(applied.q ? { q: applied.q } : {}),
      })
      .then((result) => {
        if (!active) return
        setItems(result.announcements)
        setCursor(result.cursor)
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
  }, [provider, canRead, pageSize, applied, reloadToken])

  useEffect(() => {
    if (!editor) return
    setFormError(null)
    setSaving(false)
    setForm(
      editor.mode === 'edit'
        ? {
            title: editor.announcement.title,
            body: editor.announcement.body,
            level: editor.announcement.level,
            placement: editor.announcement.placement,
            startsAt: toLocalInput(editor.announcement.startsAt),
            endsAt: toLocalInput(editor.announcement.endsAt),
          }
        : EMPTY_FORM,
    )
  }, [editor])

  function reload() {
    setReloadToken((value) => value + 1)
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setApplied({
      status: statusFilter,
      placement: placementFilter,
      q: keyword.trim(),
    })
  }

  function resetFilters() {
    setStatusFilter('all')
    setPlacementFilter('all')
    setKeyword('')
    setApplied({ status: 'all', placement: 'all', q: '' })
  }

  async function loadMore() {
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    try {
      const result = await provider.listAnnouncements({
        limit: pageSize,
        cursor,
        ...(applied.status === 'all' ? {} : { status: applied.status }),
        ...(applied.placement === 'all' ? {} : { placement: applied.placement }),
        ...(applied.q ? { q: applied.q } : {}),
      })
      setItems((current) => [...current, ...result.announcements])
      setCursor(result.cursor)
    } catch (cause) {
      toast.error(describeAdminError(cause))
    } finally {
      setLoadingMore(false)
    }
  }

  async function submitEditor() {
    if (!editor || saving) return
    const title = form.title.trim()
    const body = form.body.trim()
    if (!title) {
      setFormError('请填写公告标题。')
      return
    }
    if (title.length > TITLE_LIMIT) {
      setFormError(`公告标题不能超过 ${TITLE_LIMIT} 个字符。`)
      return
    }
    if (!body) {
      setFormError('请填写公告正文。')
      return
    }
    if (body.length > BODY_LIMIT) {
      setFormError(`公告正文不能超过 ${BODY_LIMIT} 个字符。`)
      return
    }
    const startsAt = toIso(form.startsAt)
    const endsAt = toIso(form.endsAt)
    if (form.startsAt && !startsAt) {
      setFormError('开始时间格式不正确。')
      return
    }
    if (form.endsAt && !endsAt) {
      setFormError('结束时间格式不正确。')
      return
    }
    if (startsAt && endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      setFormError('结束时间必须晚于开始时间。')
      return
    }
    if (/<[a-zA-Z!/?][^>]*>/.test(title) || /<[a-zA-Z!/?][^>]*>/.test(body)) {
      setFormError('标题与正文只能包含纯文本，不支持 HTML。')
      return
    }

    setFormError(null)
    setSaving(true)
    try {
      const input = {
        title,
        body,
        level: form.level,
        placement: form.placement,
        ...(startsAt ? { startsAt } : {}),
        ...(endsAt ? { endsAt } : {}),
      }
      if (editor.mode === 'create') {
        await provider.createAnnouncement(input)
        toast.success('公告草稿已创建，可在列表中发布。')
      } else {
        await provider.updateAnnouncement(editor.announcement.id, input)
        toast.success('公告草稿已保存。')
      }
      setEditor(null)
      reload()
    } catch (cause) {
      setFormError(describeAdminError(cause))
    } finally {
      setSaving(false)
    }
  }

  async function confirmStatusChange() {
    if (!pendingChange || acting) return
    const { announcement, action } = pendingChange
    setActing(true)
    try {
      if (action === 'publish') {
        await provider.publishAnnouncement({ id: announcement.id })
        toast.success('公告已发布。')
      } else {
        await provider.archiveAnnouncement({ id: announcement.id })
        toast.success('公告已下线。')
      }
      setPendingChange(null)
      reload()
    } catch (cause) {
      if (isApprovalRequired(cause)) {
        setApprovalDraft(
          action === 'publish'
            ? announcementPublishApprovalDraft(announcement)
            : announcementArchiveApprovalDraft(announcement),
        )
        setPendingChange(null)
        return
      }
      toast.error(describeAdminError(cause))
    } finally {
      setActing(false)
    }
  }

  if (!canRead) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="站内公告"
          description="维护面向管理后台与客户端的站内公告。"
        />
        <Card className="py-0">
          <EmptyState
            icon={MegaphoneIcon}
            title="没有查看站内公告的权限"
            message="当前账号无法查看站内公告。如需使用该功能，请联系管理员开通“查看站内公告”权限。"
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="站内公告"
        description="维护面向管理后台与客户端的站内公告。草稿保存后不会对外展示，发布与下线需要另一位管理员批准。"
        actions={
          <>
            {!canWrite ? <Badge variant="outline">只读视图</Badge> : null}
            <Button
              variant="outline"
              size="sm"
              onClick={reload}
              disabled={status === 'loading'}
            >
              {status === 'loading' ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : (
                <RefreshCwIcon />
              )}
              刷新
            </Button>
            {canWrite ? (
              <Button size="sm" onClick={() => setEditor({ mode: 'create' })}>
                <PlusIcon />
                新建公告
              </Button>
            ) : null}
          </>
        }
      />

      {!canWrite ? (
        <div className="rounded-xl border bg-card px-4 py-3 text-xs text-muted-foreground">
          当前账号只有查看权限：可以浏览公告内容与状态，新建、编辑与发布公告需要“维护站内公告”权限。
        </div>
      ) : null}

      <Card className="gap-0 py-0">
        <form
          className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center"
          onSubmit={applyFilters}
        >
          <Input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="按标题或正文搜索"
            aria-label="公告关键词"
            className="sm:max-w-xs"
          />
          <Select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            aria-label="公告状态"
            className="sm:w-36"
          >
            <option value="all">全部状态</option>
            <option value="draft">草稿</option>
            <option value="published">已发布</option>
            <option value="archived">已下线</option>
          </Select>
          <Select
            value={placementFilter}
            onChange={(event) =>
              setPlacementFilter(event.target.value as PlacementFilter)
            }
            aria-label="展示位置"
            className="sm:w-36"
          >
            <option value="all">全部位置</option>
            <option value="admin">管理后台</option>
            <option value="app">客户端</option>
          </Select>
          <div className="flex items-center gap-2 lg:ml-auto">
            <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
              重置
            </Button>
            <Button type="submit" size="sm" disabled={status === 'loading'}>
              {status === 'loading' ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : (
                <SearchIcon />
              )}
              查询
            </Button>
          </div>
        </form>

        {status === 'loading' && items.length === 0 ? (
          <LoadingState label="正在加载站内公告…" />
        ) : status === 'error' ? (
          <ErrorState
            title="站内公告加载失败"
            message={error ?? '操作失败，请稍后重试。'}
            onRetry={reload}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={MegaphoneIcon}
            title="暂无站内公告"
            message={
              applied.q || applied.status !== 'all' || applied.placement !== 'all'
                ? '当前筛选条件下没有公告，可以调整筛选条件后重新查询。'
                : '还没有创建任何公告。创建草稿并发布后，公告会展示在选定位置。'
            }
            action={
              canWrite ? (
                <Button size="sm" onClick={() => setEditor({ mode: 'create' })}>
                  <PlusIcon />
                  新建公告
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table aria-busy={status === 'loading'}>
            <TableHeader>
              <TableRow>
                <TableHead>公告</TableHead>
                <TableHead className="w-20">级别</TableHead>
                <TableHead className="w-28">展示位置</TableHead>
                <TableHead className="w-24">状态</TableHead>
                <TableHead className="w-56">生效时间</TableHead>
                <TableHead className="w-40">更新时间</TableHead>
                <TableHead className="w-40 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <p className="max-w-md truncate text-sm font-medium">{item.title}</p>
                    <p className="mt-0.5 max-w-md truncate text-xs text-muted-foreground">
                      {item.body}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge variant={levelVariants[item.level]}>
                      {levelLabels[item.level]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    {placementLabels[item.placement]}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariants[item.status]}>
                      {statusLabels[item.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {windowLabel(item, dateFormat)}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                    {formatTimestamp(item.updatedAt, dateFormat)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {canWrite && item.status === 'draft' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditor({ mode: 'edit', announcement: item })}
                        >
                          编辑
                        </Button>
                      ) : null}
                      {canPublish && item.status === 'draft' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPendingChange({ announcement: item, action: 'publish' })}
                        >
                          发布
                        </Button>
                      ) : null}
                      {canPublish && item.status === 'published' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPendingChange({ announcement: item, action: 'archive' })}
                        >
                          下线
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {status === 'ready' && items.length > 0 ? (
          <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
            <span>已显示 {items.length} 条公告</span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2"
              onClick={() => void loadMore()}
              disabled={!cursor || loadingMore}
            >
              {loadingMore ? <LoaderCircleIcon className="animate-spin" /> : null}
              {cursor ? '加载更多' : '已加载全部'}
            </Button>
          </div>
        ) : null}

        <p className="border-t bg-muted/30 px-4 py-2 text-[11px] leading-relaxed text-muted-foreground">
          发布与下线属于内置必审动作：当管理员不止一位时，操作会转为审批请求，由另一位管理员批准后立即执行；公告正文按纯文本保存与展示。
        </p>
      </Card>

      <Dialog
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setEditor(null)
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {editor?.mode === 'edit' ? '编辑公告草稿' : '新建公告草稿'}
            </DialogTitle>
            <DialogDescription>
              草稿保存后不会对外展示；发布后公告会展示在选定的位置。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="announcement-title">
                公告标题
              </label>
              <Input
                id="announcement-title"
                value={form.title}
                onChange={(event) => {
                  setForm((current) => ({ ...current, title: event.target.value }))
                  setFormError(null)
                }}
                maxLength={TITLE_LIMIT}
                placeholder="例如：系统维护通知"
                disabled={saving}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="announcement-body">
                公告正文
              </label>
              <Textarea
                id="announcement-body"
                value={form.body}
                onChange={(event) => {
                  setForm((current) => ({ ...current, body: event.target.value }))
                  setFormError(null)
                }}
                rows={6}
                maxLength={BODY_LIMIT}
                placeholder="填写公告内容，正文按纯文本展示。"
                disabled={saving}
              />
              <p className="text-right text-xs text-muted-foreground tabular-nums">
                {form.body.length} / {BODY_LIMIT}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="announcement-level">
                  公告级别
                </label>
                <Select
                  id="announcement-level"
                  value={form.level}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      level: event.target.value as AnnouncementLevel,
                    }))
                  }
                  disabled={saving}
                  className="sm:w-36"
                >
                  <option value="info">通知</option>
                  <option value="warning">提醒</option>
                  <option value="critical">重要</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="announcement-placement">
                  展示位置
                </label>
                <Select
                  id="announcement-placement"
                  value={form.placement}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      placement: event.target.value as AnnouncementPlacement,
                    }))
                  }
                  disabled={saving}
                  className="sm:w-36"
                >
                  <option value="app">客户端</option>
                  <option value="admin">管理后台</option>
                </Select>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="announcement-starts">
                  开始时间（可选）
                </label>
                <Input
                  id="announcement-starts"
                  type="datetime-local"
                  value={form.startsAt}
                  onChange={(event) => {
                    setForm((current) => ({ ...current, startsAt: event.target.value }))
                    setFormError(null)
                  }}
                  disabled={saving}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="announcement-ends">
                  结束时间（可选）
                </label>
                <Input
                  id="announcement-ends"
                  type="datetime-local"
                  value={form.endsAt}
                  onChange={(event) => {
                    setForm((current) => ({ ...current, endsAt: event.target.value }))
                    setFormError(null)
                  }}
                  disabled={saving}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              留空表示立即生效或长期有效；结束时间必须晚于开始时间。
            </p>

            {formError ? (
              <p role="alert" className="text-xs text-destructive">
                {formError}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditor(null)} disabled={saving}>
              取消
            </Button>
            <Button onClick={() => void submitEditor()} disabled={saving}>
              {saving ? <LoaderCircleIcon className="animate-spin" /> : null}
              保存草稿
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingChange !== null}
        onOpenChange={(open) => {
          if (!open && !acting) setPendingChange(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingChange?.action === 'publish' ? '确认发布该公告？' : '确认下线该公告？'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingChange?.action === 'publish'
                ? `发布后「${pendingChange?.announcement.title ?? ''}」会立即对选定位置的用户展示。`
                : `下线后「${pendingChange?.announcement.title ?? ''}」将不再对用户展示。`}
              当管理员不止一位时，系统会改为发起审批请求，由另一位管理员批准后执行。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={acting}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void confirmStatusChange()
              }}
              disabled={acting}
            >
              {acting ? <LoaderCircleIcon className="animate-spin" /> : null}
              {pendingChange?.action === 'publish' ? '确认发布' : '确认下线'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ApprovalRequestDialog
        draft={approvalDraft}
        onClose={() => {
          setApprovalDraft(null)
          reload()
        }}
      />
    </div>
  )
}
