'use client'

import { useEffect, useState, type FormEvent } from 'react'
import {
  LayersIcon,
  LoaderCircleIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
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
import type { PolicySetView } from '@/lib/data/types'
import { describeAdminError } from '@/lib/errors'
import { formatDateTime, formatNumber } from '@/lib/format'

type LoadStatus = 'loading' | 'ready' | 'error'
type EditorState = { mode: 'create' } | { mode: 'edit'; set: PolicySetView } | null

const DETAIL_LIMIT = 100

type Props = {
  canWrite: boolean
  onRequestApproval: (draft: ApprovalRequestDraft) => void
}

export function PolicySetsPanel({ canWrite, onRequestApproval }: Props) {
  const provider = useDataProvider()
  const { pageSize } = useWorkspace()

  const [sets, setSets] = useState<PolicySetView[]>([])
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [listError, setListError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const [namePrefixInput, setNamePrefixInput] = useState('')
  const [appliedNamePrefix, setAppliedNamePrefix] = useState<string | undefined>()

  const [page, setPage] = useState(1)
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined])
  const [nextCursor, setNextCursor] = useState<string | undefined>()

  const [editor, setEditor] = useState<EditorState>(null)
  const [nameInput, setNameInput] = useState('')
  const [descriptionInput, setDescriptionInput] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<PolicySetView | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [detail, setDetail] = useState<PolicySetView | null>(null)
  const [detailValues, setDetailValues] = useState<string[]>([])
  const [detailCursor, setDetailCursor] = useState<string | undefined>()
  const [detailStatus, setDetailStatus] = useState<LoadStatus>('loading')
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailToken, setDetailToken] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)

  const [addOpen, setAddOpen] = useState(false)
  const [addValuesInput, setAddValuesInput] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const [removeValueTarget, setRemoveValueTarget] = useState<{
    name: string
    value: string
  } | null>(null)
  const [removeValueError, setRemoveValueError] = useState<string | null>(null)
  const [removingValue, setRemovingValue] = useState(false)

  useEffect(() => {
    let active = true
    const cursor = cursors[page - 1]
    setStatus('loading')
    setListError(null)

    provider
      .listPolicySets({
        cursor,
        limit: pageSize,
        ...(appliedNamePrefix ? { namePrefix: appliedNamePrefix } : {}),
      })
      .then((result) => {
        if (!active) return
        setSets(result.sets)
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
  }, [provider, cursors, page, pageSize, appliedNamePrefix, reloadToken])

  useEffect(() => {
    if (!detail) return
    let active = true
    setDetailStatus('loading')
    setDetailError(null)
    provider
      .getPolicySet({ name: detail.name, limit: DETAIL_LIMIT })
      .then((result) => {
        if (!active) return
        setDetailValues(result.values)
        setDetailCursor(result.cursor)
        setDetailStatus('ready')
      })
      .catch((cause: unknown) => {
        if (!active) return
        setDetailError(describeAdminError(cause))
        setDetailStatus('error')
      })
    return () => {
      active = false
    }
  }, [provider, detail, detailToken])

  function reload() {
    setReloadToken((value) => value + 1)
  }

  function reloadDetail() {
    setDetailToken((value) => value + 1)
    reload()
  }

  function resetPaging() {
    setPage(1)
    setCursors([undefined])
  }

  function applyFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAppliedNamePrefix(namePrefixInput.trim() || undefined)
    resetPaging()
  }

  async function loadMoreValues() {
    if (!detail || !detailCursor) return
    setLoadingMore(true)
    setDetailError(null)
    try {
      const result = await provider.getPolicySet({
        name: detail.name,
        limit: DETAIL_LIMIT,
        cursor: detailCursor,
      })
      setDetailValues((current) => [...current, ...result.values])
      setDetailCursor(result.cursor)
    } catch (cause) {
      setDetailError(describeAdminError(cause))
    } finally {
      setLoadingMore(false)
    }
  }

  function openCreate() {
    setEditor({ mode: 'create' })
    setNameInput('')
    setDescriptionInput('')
    setFormError(null)
  }

  function openEdit(set: PolicySetView) {
    setEditor({ mode: 'edit', set })
    setNameInput(set.name)
    setDescriptionInput(set.description ?? '')
    setFormError(null)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editor) return
    const name = nameInput.trim()
    if (name.length < 3) {
      setFormError('集合名称至少需要 3 个字符。')
      return
    }
    if (name.length > 128) {
      setFormError('集合名称不能超过 128 个字符。')
      return
    }
    const description = descriptionInput.trim()
    if (description.length > 500) {
      setFormError('集合说明不能超过 500 个字符。')
      return
    }

    const operation = 'set.upsert' as const
    const input: Record<string, unknown> = {
      name,
      ...(description ? { description } : {}),
    }
    const summary =
      editor.mode === 'create' ? `新建对象集合 ${name}` : `更新对象集合 ${name} 的说明`

    setSaving(true)
    setFormError(null)
    try {
      await provider.actOnPolicySet({ operation, input })
      toast.success(editor.mode === 'create' ? '对象集合已创建。' : '集合说明已更新。')
      setEditor(null)
      reload()
    } catch (cause) {
      if (isApprovalRequired(cause)) {
        onRequestApproval(
          policyWriteApprovalDraft({ operation, input, summary, target: name }),
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
    const operation = 'set.delete' as const
    const input = { name: deleteTarget.name }
    setDeleting(true)
    setDeleteError(null)
    try {
      await provider.actOnPolicySet({ operation, input })
      toast.success('对象集合已删除。')
      setDeleteTarget(null)
      if (detail?.name === deleteTarget.name) setDetail(null)
      reload()
    } catch (cause) {
      if (isApprovalRequired(cause)) {
        onRequestApproval(
          policyWriteApprovalDraft({
            operation,
            input,
            summary: `删除对象集合 ${deleteTarget.name}`,
            target: deleteTarget.name,
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

  function openAddValues() {
    setAddValuesInput('')
    setAddError(null)
    setAddOpen(true)
  }

  async function submitAddValues(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!detail) return
    const values = addValuesInput
      .split('\n')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
    if (values.length === 0) {
      setAddError('请至少填写一个值，每行一个。')
      return
    }
    if (values.length > 1000) {
      setAddError('一次最多添加 1000 个值。')
      return
    }
    if (values.some((value) => value.length > 2048)) {
      setAddError('单个值不能超过 2048 个字符。')
      return
    }

    const operation = 'set.addValues' as const
    const input = { name: detail.name, values }
    setAdding(true)
    setAddError(null)
    try {
      await provider.actOnPolicySet({ operation, input })
      toast.success(`已向集合添加 ${values.length} 个值。`)
      setAddOpen(false)
      reloadDetail()
    } catch (cause) {
      if (isApprovalRequired(cause)) {
        onRequestApproval(
          policyWriteApprovalDraft({
            operation,
            input,
            summary: `向对象集合 ${detail.name} 添加 ${values.length} 个值`,
            target: detail.name,
          }),
        )
        setAddOpen(false)
        return
      }
      setAddError(describeAdminError(cause))
    } finally {
      setAdding(false)
    }
  }

  async function confirmRemoveValue() {
    if (!removeValueTarget) return
    const operation = 'set.deleteValues' as const
    const input = { name: removeValueTarget.name, values: [removeValueTarget.value] }
    setRemovingValue(true)
    setRemoveValueError(null)
    try {
      await provider.actOnPolicySet({ operation, input })
      toast.success('集合值已移除。')
      setRemoveValueTarget(null)
      reloadDetail()
    } catch (cause) {
      if (isApprovalRequired(cause)) {
        onRequestApproval(
          policyWriteApprovalDraft({
            operation,
            input,
            summary: `从对象集合 ${removeValueTarget.name} 移除 1 个值`,
            target: removeValueTarget.name,
          }),
        )
        setRemoveValueTarget(null)
        return
      }
      setRemoveValueError(describeAdminError(cause))
    } finally {
      setRemovingValue(false)
    }
  }

  const hasFilter = appliedNamePrefix !== undefined
  const showInitialLoading = status === 'loading' && sets.length === 0

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 lg:flex-row lg:items-start lg:justify-between">
        <form
          className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center"
          onSubmit={applyFilter}
        >
          <Input
            value={namePrefixInput}
            onChange={(event) => setNamePrefixInput(event.target.value)}
            placeholder="按集合名称前缀筛选"
            className="flex-1"
            aria-label="按集合名称前缀筛选"
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
            新建集合
          </Button>
        </div>
      </div>

      <div className="rounded-xl border bg-card px-4 py-3 text-xs text-muted-foreground">
        对象集合用于批量管理内容、账号或链接清单，例如禁言名单、关键词名单；集合变化会在下次审核判定时生效。
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        {status === 'error' ? (
          <ErrorState
            title="对象集合加载失败"
            message={listError ?? '操作失败，请稍后重试。'}
            onRetry={reload}
          />
        ) : showInitialLoading ? (
          <LoadingState label="正在加载对象集合…" />
        ) : sets.length === 0 ? (
          <EmptyState
            icon={LayersIcon}
            title={hasFilter ? '没有匹配的对象集合' : '当前没有对象集合'}
            message={
              hasFilter
                ? '调整名称前缀后再试。'
                : '创建集合后可以向其中添加值，用于批量命中审核规则。'
            }
            action={
              hasFilter ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setNamePrefixInput('')
                    setAppliedNamePrefix(undefined)
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
                <TableHead>集合名称</TableHead>
                <TableHead>集合说明</TableHead>
                <TableHead>值数量</TableHead>
                <TableHead>最近更新</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sets.map((set) => (
                <TableRow key={set.name}>
                  <TableCell>
                    <button
                      type="button"
                      className="max-w-56 truncate text-left font-mono text-xs text-primary hover:underline"
                      onClick={() => setDetail(set)}
                      title={set.name}
                    >
                      {set.name}
                    </button>
                  </TableCell>
                  <TableCell className="max-w-64 text-xs text-muted-foreground">
                    {set.description ?? '未填写说明'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {set.valuesCount !== undefined ? formatNumber(set.valuesCount) : '—'}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                    {formatDateTime(set.updatedAt ?? set.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setDetail(set)}>
                        查看成员
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(set)}
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
                          setDeleteTarget(set)
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
            第 {page} 页，本页 {sets.length} 条
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
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) setDetail(null)
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>集合成员</DialogTitle>
            <DialogDescription>
              集合“{detail?.name}”当前包含的成员值；移除后该值不再参与审核判定。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                已加载 {detailValues.length} 个值
                {detail?.valuesCount !== undefined
                  ? `，集合共 ${formatNumber(detail.valuesCount)} 个`
                  : ''}
              </span>
              <div className="flex items-center gap-2">
                {detailCursor ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void loadMoreValues()}
                    disabled={loadingMore}
                  >
                    {loadingMore ? <LoaderCircleIcon className="animate-spin" /> : null}
                    加载更多
                  </Button>
                ) : null}
                <Button size="sm" onClick={openAddValues} disabled={!canWrite}>
                  <PlusIcon />
                  添加值
                </Button>
              </div>
            </div>

            {detailStatus === 'error' ? (
              <ErrorState
                title="集合成员加载失败"
                message={detailError ?? '操作失败，请稍后重试。'}
                onRetry={() => setDetailToken((value) => value + 1)}
              />
            ) : detailStatus === 'loading' && detailValues.length === 0 ? (
              <LoadingState label="正在加载集合成员…" />
            ) : detailValues.length === 0 ? (
              <p className="rounded-lg border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
                该集合尚未包含任何值。添加值后可用于批量审核规则。
              </p>
            ) : (
              <div className="max-h-72 overflow-y-auto rounded-lg border">
                <ul className="divide-y">
                  {detailValues.map((value) => (
                    <li
                      key={value}
                      className="flex items-center justify-between gap-2 px-3 py-2"
                    >
                      <span
                        className="truncate font-mono text-xs text-muted-foreground"
                        title={value}
                      >
                        {value}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        aria-label={`移除 ${value}`}
                        onClick={() => {
                          if (!detail) return
                          setRemoveValueError(null)
                          setRemoveValueTarget({ name: detail.name, value })
                        }}
                        disabled={!canWrite}
                      >
                        <XIcon />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {detailError && detailStatus !== 'error' ? (
              <p
                role="alert"
                className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                {detailError}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetail(null)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          if (!open && !adding) setAddOpen(false)
        }}
      >
        <DialogContent>
          <form className="space-y-4" onSubmit={submitAddValues}>
            <DialogHeader>
              <DialogTitle>向集合添加值</DialogTitle>
              <DialogDescription>
                每行填写一个值，例如内容标识、账号标识或关键词；重复值不会重复添加。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="set-add-values">成员值</Label>
              <Textarea
                id="set-add-values"
                value={addValuesInput}
                onChange={(event) => {
                  setAddValuesInput(event.target.value)
                  setAddError(null)
                }}
                className="min-h-32 font-mono text-xs"
                placeholder={'value-1\nvalue-2'}
                spellCheck={false}
                disabled={adding}
              />
            </div>
            {addError ? (
              <p
                role="alert"
                className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                {addError}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAddOpen(false)}
                disabled={adding}
              >
                取消
              </Button>
              <Button type="submit" disabled={adding}>
                {adding ? <LoaderCircleIcon className="animate-spin" /> : null}
                添加值
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setEditor(null)
        }}
      >
        <DialogContent>
          <form className="space-y-4" onSubmit={save}>
            <DialogHeader>
              <DialogTitle>{editor?.mode === 'edit' ? '编辑对象集合' : '新建对象集合'}</DialogTitle>
              <DialogDescription>
                集合名称创建后不能修改；若系统存在多位管理员，保存操作需要另一位管理员批准后执行。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="set-name">集合名称</Label>
                <Input
                  id="set-name"
                  value={nameInput}
                  onChange={(event) => {
                    setNameInput(event.target.value)
                    setFormError(null)
                  }}
                  placeholder="例如：muted-accounts"
                  disabled={saving || editor?.mode === 'edit'}
                  maxLength={128}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="set-description">集合说明（可选）</Label>
                <Textarea
                  id="set-description"
                  value={descriptionInput}
                  onChange={(event) => {
                    setDescriptionInput(event.target.value)
                    setFormError(null)
                  }}
                  className="min-h-20"
                  maxLength={500}
                  disabled={saving}
                />
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
                保存集合
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
            <AlertDialogTitle>删除对象集合</AlertDialogTitle>
            <AlertDialogDescription>
              删除后集合“{deleteTarget?.name}”及其成员值将从审核服务移除，引用该集合的规则不再命中。
            </AlertDialogDescription>
          </AlertDialogHeader>
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
              删除集合
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={removeValueTarget !== null}
        onOpenChange={(open) => {
          if (!open && !removingValue) setRemoveValueTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>移除集合值</AlertDialogTitle>
            <AlertDialogDescription>
              移除后该值不再参与审核判定，操作会写入审计日志。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-lg border bg-muted/40 p-3 font-mono text-xs break-all">
            {removeValueTarget?.value}
          </div>
          {removeValueError ? (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {removeValueError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removingValue}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault()
                void confirmRemoveValue()
              }}
              disabled={removingValue}
            >
              {removingValue ? <LoaderCircleIcon className="animate-spin" /> : null}
              移除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
