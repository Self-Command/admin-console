'use client'

import { useEffect, useState, type FormEvent } from 'react'
import {
  LinkIcon,
  LoaderCircleIcon,
  PencilIcon,
  PlusIcon,
  SearchXIcon,
  Trash2Icon,
} from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState, ErrorState, LoadingState } from '@/components/data-state'
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
import { Textarea } from '@/components/ui/textarea'
import { useWorkspace } from '@/components/layout/workspace-provider'
import {
  isApprovalRequired,
  policyWriteApprovalDraft,
  type ApprovalRequestDraft,
} from '@/lib/approvals'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type { SafelinkPattern, SafelinkRule } from '@/lib/data/types'
import { describeAdminError } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'

const PATTERN_LABELS: Record<string, string> = {
  domain: '域名',
  url: '链接',
}

const ACTION_LABELS: Record<string, string> = {
  block: '拦截访问',
  warn: '提醒用户',
  whitelist: '加入白名单',
}

const ACTION_VARIANTS: Record<string, 'destructive' | 'warning' | 'success'> = {
  block: 'destructive',
  warn: 'warning',
  whitelist: 'success',
}

const REASON_LABELS: Record<string, string> = {
  csam: '儿童性虐待内容',
  spam: '垃圾信息',
  phishing: '钓鱼欺诈',
  none: '未标注原因',
}

type LoadStatus = 'loading' | 'ready' | 'error'
type PatternFilter = 'all' | SafelinkPattern
type EditorState = { mode: 'create' } | { mode: 'edit'; rule: SafelinkRule } | null

type Props = {
  canWrite: boolean
  onRequestApproval: (draft: ApprovalRequestDraft) => void
}

export function SafelinkPanel({ canWrite, onRequestApproval }: Props) {
  const provider = useDataProvider()
  const { pageSize } = useWorkspace()

  const [rules, setRules] = useState<SafelinkRule[]>([])
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [listError, setListError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const [patternFilter, setPatternFilter] = useState<PatternFilter>('all')
  const [urlInput, setUrlInput] = useState('')
  const [appliedUrl, setAppliedUrl] = useState<string | undefined>()

  const [page, setPage] = useState(1)
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined])
  const [nextCursor, setNextCursor] = useState<string | undefined>()

  const [editor, setEditor] = useState<EditorState>(null)
  const [editorUrl, setEditorUrl] = useState('')
  const [editorPattern, setEditorPattern] = useState('domain')
  const [editorAction, setEditorAction] = useState('block')
  const [editorReason, setEditorReason] = useState('none')
  const [editorSource, setEditorSource] = useState('')
  const [editorComment, setEditorComment] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<SafelinkRule | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    let active = true
    const cursor = cursors[page - 1]
    setStatus('loading')
    setListError(null)

    provider
      .listSafelinkRules({
        cursor,
        limit: pageSize,
        ...(patternFilter === 'all' ? {} : { patternType: patternFilter }),
        ...(appliedUrl ? { urls: [appliedUrl] } : {}),
      })
      .then((result) => {
        if (!active) return
        setRules(result.rules)
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
  }, [provider, cursors, page, pageSize, patternFilter, appliedUrl, reloadToken])

  function reload() {
    setReloadToken((value) => value + 1)
  }

  function resetPaging() {
    setPage(1)
    setCursors([undefined])
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAppliedUrl(urlInput.trim() || undefined)
    resetPaging()
  }

  function openCreate() {
    setEditor({ mode: 'create' })
    setEditorUrl('')
    setEditorPattern('domain')
    setEditorAction('block')
    setEditorReason('none')
    setEditorSource('')
    setEditorComment('')
    setFormError(null)
  }

  function openEdit(rule: SafelinkRule) {
    setEditor({ mode: 'edit', rule })
    setEditorUrl(rule.url)
    setEditorPattern(rule.pattern)
    setEditorAction(rule.action)
    setEditorReason(rule.reason)
    setEditorSource(rule.source ?? '')
    setEditorComment(rule.comment ?? '')
    setFormError(null)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editor) return
    const url = editorUrl.trim()
    if (!url) {
      setFormError('请填写规则地址。')
      return
    }
    if (url.length > 2048) {
      setFormError('规则地址不能超过 2048 个字符。')
      return
    }
    const source = editorSource.trim()
    if (source.length > 128) {
      setFormError('规则来源不能超过 128 个字符。')
      return
    }
    const comment = editorComment.trim()
    if (comment.length > 500) {
      setFormError('规则备注不能超过 500 个字符。')
      return
    }

    const operation = editor.mode === 'create' ? ('safelink.add' as const) : ('safelink.update' as const)
    const input: Record<string, unknown> = {
      url,
      pattern: editorPattern,
      action: editorAction,
      reason: editorReason,
      ...(source ? { source } : {}),
      ...(comment ? { comment } : {}),
    }
    const summary =
      editor.mode === 'create'
        ? `新增外链规则 ${url}（${PATTERN_LABELS[editorPattern] ?? editorPattern}）`
        : `更新外链规则 ${url}（${PATTERN_LABELS[editorPattern] ?? editorPattern}）`

    setSaving(true)
    setFormError(null)
    try {
      await provider.actOnPolicySafelink({ operation, input })
      toast.success(editor.mode === 'create' ? '外链规则已新增。' : '外链规则已更新。')
      setEditor(null)
      reload()
    } catch (cause) {
      if (isApprovalRequired(cause)) {
        onRequestApproval(
          policyWriteApprovalDraft({ operation, input, summary, target: url }),
        )
        setEditor(null)
        return
      }
      setFormError(describeAdminError(cause))
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    const operation = 'safelink.remove' as const
    const input: Record<string, unknown> = {
      url: deleteTarget.url,
      pattern: deleteTarget.pattern,
      ...(deleteTarget.source ? { source: deleteTarget.source } : {}),
      ...(deleteTarget.comment ? { comment: deleteTarget.comment } : {}),
    }
    setDeleting(true)
    setDeleteError(null)
    try {
      await provider.actOnPolicySafelink({ operation, input })
      toast.success('外链规则已删除。')
      setDeleteTarget(null)
      reload()
    } catch (cause) {
      if (isApprovalRequired(cause)) {
        onRequestApproval(
          policyWriteApprovalDraft({
            operation,
            input,
            summary: `删除外链规则 ${deleteTarget.url}（${PATTERN_LABELS[deleteTarget.pattern] ?? deleteTarget.pattern}）`,
            target: deleteTarget.url,
          }),
        )
        setDeleteTarget(null)
        return
      }
      setDeleteError(describeAdminError(cause))
    } finally {
      setDeleting(false)
    }
  }

  const hasFilter = appliedUrl !== undefined || patternFilter !== 'all'
  const showInitialLoading = status === 'loading' && rules.length === 0

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 lg:flex-row lg:items-start lg:justify-between">
        <form
          className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center"
          onSubmit={applyFilters}
        >
          <Select
            value={patternFilter}
            onChange={(event) => {
              setPatternFilter(event.target.value as PatternFilter)
              resetPaging()
            }}
            aria-label="按规则类型筛选"
            className="w-36 shrink-0"
          >
            <option value="all">全部类型</option>
            <option value="domain">域名规则</option>
            <option value="url">链接规则</option>
          </Select>
          <Input
            value={urlInput}
            onChange={(event) => setUrlInput(event.target.value)}
            placeholder="按规则地址精确筛选"
            className="flex-1 font-mono text-xs"
            aria-label="按规则地址筛选"
          />
          <Button type="submit" variant="secondary" size="sm" className="h-9">
            应用
          </Button>
        </form>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={reload} disabled={status === 'loading'}>
            刷新
          </Button>
          <Button
            size="sm"
            onClick={openCreate}
            disabled={!canWrite}
            title={canWrite ? undefined : '当前账号没有管理审核策略的权限'}
          >
            <PlusIcon />
            新增规则
          </Button>
        </div>
      </div>

      <div className="rounded-xl border bg-card px-4 py-3 text-xs text-muted-foreground">
        外链规则决定用户在社区中打开外部链接时的处理方式：拦截会阻止访问，提醒会显示风险提示，白名单会跳过风险检查。规则按域名或完整链接匹配。
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        {status === 'error' ? (
          <ErrorState
            title="外链规则加载失败"
            message={listError ?? '操作失败，请稍后重试。'}
            onRetry={reload}
          />
        ) : showInitialLoading ? (
          <LoadingState label="正在加载外链规则…" />
        ) : rules.length === 0 ? (
          <EmptyState
            icon={hasFilter ? SearchXIcon : LinkIcon}
            title={hasFilter ? '没有匹配的外链规则' : '当前没有外链规则'}
            message={
              hasFilter
                ? '调整规则类型或地址后再试。'
                : '新增规则后，用户访问对应地址时会按处置方式处理。'
            }
            action={
              hasFilter ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setUrlInput('')
                    setAppliedUrl(undefined)
                    setPatternFilter('all')
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
                <TableHead>规则地址</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>处置方式</TableHead>
                <TableHead>原因</TableHead>
                <TableHead>来源</TableHead>
                <TableHead>更新时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((rule) => (
                <TableRow key={`${rule.pattern}:${rule.url}`}>
                  <TableCell
                    className="max-w-64 truncate font-mono text-xs"
                    title={rule.url}
                  >
                    {rule.url}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {PATTERN_LABELS[rule.pattern] ?? rule.pattern}
                  </TableCell>
                  <TableCell>
                    <Badge variant={ACTION_VARIANTS[rule.action] ?? 'muted'}>
                      {ACTION_LABELS[rule.action] ?? rule.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {REASON_LABELS[rule.reason] ?? rule.reason}
                  </TableCell>
                  <TableCell className="max-w-40 truncate text-xs text-muted-foreground">
                    {rule.source ?? '—'}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                    {formatDateTime(rule.updatedAt ?? rule.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(rule)}
                        disabled={!canWrite}
                      >
                        <PencilIcon />
                        编辑
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          setDeleteError(null)
                          setDeleteTarget(rule)
                        }}
                        disabled={!canWrite}
                      >
                        <Trash2Icon />
                        删除
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <div className="flex flex-col gap-2 border-t px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            第 {page} 页，本页 {rules.length} 条
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
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setEditor(null)
        }}
      >
        <DialogContent className="max-w-xl">
          <form className="space-y-4" onSubmit={save}>
            <DialogHeader>
              <DialogTitle>{editor?.mode === 'edit' ? '编辑外链规则' : '新增外链规则'}</DialogTitle>
              <DialogDescription>
                规则地址与类型共同确定一条规则；编辑时不可修改。若系统存在多位管理员，保存操作需要另一位管理员批准后执行。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="safelink-url">规则地址</Label>
                <Input
                  id="safelink-url"
                  value={editorUrl}
                  onChange={(event) => {
                    setEditorUrl(event.target.value)
                    setFormError(null)
                  }}
                  placeholder={editorPattern === 'domain' ? 'example.com' : 'https://example.com/path'}
                  className="font-mono text-xs"
                  maxLength={2048}
                  disabled={saving || editor?.mode === 'edit'}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="safelink-pattern">规则类型</Label>
                  <Select
                    id="safelink-pattern"
                    value={editorPattern}
                    onChange={(event) => {
                      setEditorPattern(event.target.value)
                      setFormError(null)
                    }}
                    disabled={saving || editor?.mode === 'edit'}
                  >
                    <option value="domain">域名（整站匹配）</option>
                    <option value="url">链接（精确匹配）</option>
                    {editorPattern !== 'domain' && editorPattern !== 'url' ? (
                      <option value={editorPattern}>其他类型（{editorPattern}）</option>
                    ) : null}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="safelink-action">处置方式</Label>
                  <Select
                    id="safelink-action"
                    value={editorAction}
                    onChange={(event) => {
                      setEditorAction(event.target.value)
                      setFormError(null)
                    }}
                    disabled={saving}
                  >
                    <option value="block">拦截访问</option>
                    <option value="warn">提醒用户</option>
                    <option value="whitelist">加入白名单</option>
                    {!Object.hasOwn(ACTION_LABELS, editorAction) ? (
                      <option value={editorAction}>其他处置（{editorAction}）</option>
                    ) : null}
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="safelink-reason">规则原因</Label>
                <Select
                  id="safelink-reason"
                  value={editorReason}
                  onChange={(event) => {
                    setEditorReason(event.target.value)
                    setFormError(null)
                  }}
                  disabled={saving}
                >
                  <option value="none">未标注原因</option>
                  <option value="csam">儿童性虐待内容</option>
                  <option value="spam">垃圾信息</option>
                  <option value="phishing">钓鱼欺诈</option>
                  {!Object.hasOwn(REASON_LABELS, editorReason) ? (
                    <option value={editorReason}>其他原因（{editorReason}）</option>
                  ) : null}
                </Select>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="safelink-source">规则来源（可选）</Label>
                  <Input
                    id="safelink-source"
                    value={editorSource}
                    onChange={(event) => {
                      setEditorSource(event.target.value)
                      setFormError(null)
                    }}
                    placeholder="例如：外部威胁情报"
                    maxLength={128}
                    disabled={saving}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="safelink-comment">规则备注（可选）</Label>
                  <Textarea
                    id="safelink-comment"
                    value={editorComment}
                    onChange={(event) => {
                      setEditorComment(event.target.value)
                      setFormError(null)
                    }}
                    className="min-h-20"
                    maxLength={500}
                    disabled={saving}
                  />
                </div>
              </div>
              {formError ? (
                <p
                  role="alert"
                  className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
                >
                  {formError}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditor(null)}
                disabled={saving}
              >
                取消
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? <LoaderCircleIcon className="animate-spin" /> : null}
                保存规则
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除外链规则</AlertDialogTitle>
            <AlertDialogDescription>
              删除后用户访问该地址时将不再按“{deleteTarget ? ACTION_LABELS[deleteTarget.action] : ''}”处理，操作会写入审计日志。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-lg border bg-muted/40 p-3 font-mono text-xs break-all">
            {deleteTarget?.url}
          </div>
          {deleteError ? (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {deleteError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault()
                void confirmDelete()
              }}
              disabled={deleting}
            >
              {deleting ? <LoaderCircleIcon className="animate-spin" /> : null}
              删除规则
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
