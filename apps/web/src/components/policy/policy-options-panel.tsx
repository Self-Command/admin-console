'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { LoaderCircleIcon, PencilIcon, PlusIcon, SearchXIcon, Trash2Icon } from 'lucide-react'
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
import type { PolicyOption, PolicyScope } from '@/lib/data/types'
import { describeAdminError } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import {
  PolicyOptionValueEditor,
  isStructuredPolicyKey,
  policyValueTemplate,
  validatePolicyValue,
} from '@/components/policy/policy-option-value-editor'

const NSID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+(\.[A-Za-z][A-Za-z0-9]*)+$/

const SCOPE_LABELS: Record<PolicyScope, string> = {
  instance: '实例级',
  personal: '个人级',
}

const MANAGER_ROLES = [
  { value: '', label: '不限制管理角色' },
  { value: 'tools.ozone.team.defs#roleAdmin', label: '管理员' },
  { value: 'tools.ozone.team.defs#roleModerator', label: '审核员' },
  { value: 'tools.ozone.team.defs#roleTriage', label: '分诊员' },
  { value: 'tools.ozone.team.defs#roleVerifier', label: '认证员' },
] as const

const managerRoleLabels = new Map<string, string>(
  MANAGER_ROLES.filter((role) => role.value).map((role) => [role.value, role.label]),
)

type LoadStatus = 'loading' | 'ready' | 'error'
type EditorState = { mode: 'create' } | { mode: 'edit'; option: PolicyOption } | null

type Props = {
  canWrite: boolean
  onRequestApproval: (draft: ApprovalRequestDraft) => void
}

export function PolicyOptionsPanel({ canWrite, onRequestApproval }: Props) {
  const provider = useDataProvider()
  const { pageSize } = useWorkspace()

  const [options, setOptions] = useState<PolicyOption[]>([])
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [listError, setListError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const [scope, setScope] = useState<PolicyScope>('instance')
  const [prefixInput, setPrefixInput] = useState('')
  const [appliedPrefix, setAppliedPrefix] = useState<string | undefined>()

  const [page, setPage] = useState(1)
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined])
  const [nextCursor, setNextCursor] = useState<string | undefined>()

  const [editor, setEditor] = useState<EditorState>(null)
  const [keyInput, setKeyInput] = useState('')
  const [scopeInput, setScopeInput] = useState<PolicyScope>('instance')
  const [valueInput, setValueInput] = useState('')
  const [structuredKey, setStructuredKey] = useState<string | null>(null)
  const [structuredValue, setStructuredValue] = useState<Record<string, unknown> | null>(
    null,
  )
  const [descriptionInput, setDescriptionInput] = useState('')
  const [managerRoleInput, setManagerRoleInput] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<PolicyOption | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    let active = true
    const cursor = cursors[page - 1]
    setStatus('loading')
    setListError(null)

    provider
      .listPolicyOptions({
        scope,
        cursor,
        limit: pageSize,
        ...(appliedPrefix ? { prefix: appliedPrefix } : {}),
      })
      .then((result) => {
        if (!active) return
        setOptions(result.options)
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
  }, [provider, cursors, page, pageSize, scope, appliedPrefix, reloadToken])

  function reload() {
    setReloadToken((value) => value + 1)
  }

  function resetPaging() {
    setPage(1)
    setCursors([undefined])
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAppliedPrefix(prefixInput.trim() || undefined)
    resetPaging()
  }

  function openCreate() {
    setEditor({ mode: 'create' })
    setKeyInput('')
    setScopeInput(scope)
    setValueInput('{\n  \n}')
    setStructuredKey(null)
    setStructuredValue(null)
    setDescriptionInput('')
    setManagerRoleInput('')
    setFormError(null)
  }

  function openEdit(option: PolicyOption) {
    setEditor({ mode: 'edit', option })
    setKeyInput(option.key)
    setScopeInput(option.scope)
    setValueInput(JSON.stringify(option.value ?? {}, null, 2))
    const structured =
      isStructuredPolicyKey(option.key) &&
      typeof option.value === 'object' &&
      option.value !== null &&
      !Array.isArray(option.value)
        ? (option.value as Record<string, unknown>)
        : null
    setStructuredKey(structured ? option.key : null)
    setStructuredValue(structured)
    setDescriptionInput(option.description ?? '')
    setManagerRoleInput(option.managerRole ?? '')
    setFormError(null)
  }

  function changeKey(nextKey: string) {
    setKeyInput(nextKey)
    setFormError(null)
    if (!isStructuredPolicyKey(nextKey)) {
      setStructuredKey(null)
      setStructuredValue(null)
      return
    }
    if (structuredKey === nextKey && structuredValue) return
    setStructuredKey(nextKey)
    setStructuredValue(policyValueTemplate(nextKey))
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editor) return
    const key = keyInput.trim()
    if (!NSID_PATTERN.test(key)) {
      setFormError('选项标识需要是完整域名形式，例如 tools.ozone.team.setting。')
      return
    }
    let value: unknown
    if (isStructuredPolicyKey(key) && structuredValue) {
      const structuredError = validatePolicyValue(key, structuredValue)
      if (structuredError) {
        setFormError(structuredError)
        return
      }
      value = structuredValue
    } else {
      try {
        value = JSON.parse(valueInput)
      } catch {
        setFormError('选项值不是有效的 JSON，请检查括号与引号。')
        return
      }
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        setFormError('选项值必须是一个 JSON 对象，例如 {"enabled": true}。')
        return
      }
    }
    const description = descriptionInput.trim()
    if (description.length > 2000) {
      setFormError('选项说明不能超过 2000 个字符。')
      return
    }
    const managerRole = managerRoleInput.trim()

    const operation = 'option.upsert' as const
    const input: Record<string, unknown> = {
      key,
      scope: scopeInput,
      value,
      ...(description ? { description } : {}),
      ...(managerRole ? { managerRole } : {}),
    }
    const summary = `保存策略选项 ${key}（${SCOPE_LABELS[scopeInput]}）`

    setSaving(true)
    setFormError(null)
    try {
      await provider.actOnPolicyOption({ operation, input })
      toast.success('策略选项已保存。')
      setEditor(null)
      reload()
    } catch (cause) {
      if (isApprovalRequired(cause)) {
        onRequestApproval(
          policyWriteApprovalDraft({ operation, input, summary, target: key }),
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
    const operation = 'option.remove' as const
    const input = { keys: [deleteTarget.key], scope: deleteTarget.scope }
    setDeleting(true)
    setDeleteError(null)
    try {
      await provider.actOnPolicyOption({ operation, input })
      toast.success('策略选项已删除。')
      setDeleteTarget(null)
      reload()
    } catch (cause) {
      if (isApprovalRequired(cause)) {
        onRequestApproval(
          policyWriteApprovalDraft({
            operation,
            input,
            summary: `删除策略选项 ${deleteTarget.key}（${SCOPE_LABELS[deleteTarget.scope]}）`,
            target: deleteTarget.key,
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

  const customManagerRole =
    managerRoleInput !== '' && !managerRoleLabels.has(managerRoleInput)
      ? managerRoleInput
      : undefined
  const hasFilter = appliedPrefix !== undefined
  const showInitialLoading = status === 'loading' && options.length === 0

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 lg:flex-row lg:items-start lg:justify-between">
        <form
          className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center"
          onSubmit={applyFilters}
        >
          <Select
            value={scope}
            onChange={(event) => {
              setScope(event.target.value as PolicyScope)
              resetPaging()
            }}
            aria-label="按选项范围筛选"
            className="w-36 shrink-0"
          >
            <option value="instance">实例级选项</option>
            <option value="personal">个人级选项</option>
          </Select>
          <Input
            value={prefixInput}
            onChange={(event) => setPrefixInput(event.target.value)}
            placeholder="按选项标识前缀筛选，例如 tools.ozone"
            className="flex-1 font-mono text-xs"
            aria-label="按选项标识前缀筛选"
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
            新建选项
          </Button>
        </div>
      </div>

      <div className="rounded-xl border bg-card px-4 py-3 text-xs text-muted-foreground">
        实例级选项对全站生效；个人级选项只影响当前账号的审核偏好。选项标识是策略在审核服务中的唯一名称，保存后立即生效。
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        {status === 'error' ? (
          <ErrorState
            title="策略选项加载失败"
            message={listError ?? '操作失败，请稍后重试。'}
            onRetry={reload}
          />
        ) : showInitialLoading ? (
          <LoadingState label="正在加载策略选项…" />
        ) : options.length === 0 ? (
          <EmptyState
            icon={SearchXIcon}
            title={hasFilter ? '没有匹配的策略选项' : '当前范围内没有策略选项'}
            message={
              hasFilter
                ? '调整选项标识前缀后再试。'
                : '审核服务尚未在此范围保存选项；需要时可新建选项并填写 JSON 值。'
            }
            action={
              hasFilter ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPrefixInput('')
                    setAppliedPrefix(undefined)
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
                <TableHead>选项标识</TableHead>
                <TableHead>范围</TableHead>
                <TableHead>选项值</TableHead>
                <TableHead>说明</TableHead>
                <TableHead>管理角色</TableHead>
                <TableHead>更新时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {options.map((option) => (
                <TableRow key={`${option.scope}:${option.key}`}>
                  <TableCell
                    className="max-w-56 truncate font-mono text-xs"
                    title={option.key}
                  >
                    {option.key}
                  </TableCell>
                  <TableCell>
                    <Badge variant={option.scope === 'instance' ? 'secondary' : 'muted'}>
                      {SCOPE_LABELS[option.scope]}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-64">
                    <p
                      className="truncate font-mono text-[11px] text-muted-foreground"
                      title={safeJson(option.value)}
                    >
                      {safeJson(option.value)}
                    </p>
                  </TableCell>
                  <TableCell className="max-w-56 text-xs text-muted-foreground">
                    {option.description ?? '未填写说明'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {option.managerRole
                      ? (managerRoleLabels.get(option.managerRole) ?? option.managerRole)
                      : '不限制'}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                    {formatDateTime(option.updatedAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(option)}
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
                          setDeleteTarget(option)
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
            第 {page} 页，本页 {options.length} 条
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
              <DialogTitle>{editor?.mode === 'edit' ? '编辑策略选项' : '新建策略选项'}</DialogTitle>
              <DialogDescription>
                已知配置项使用结构化表单填写，字段校验通过后才能保存；其他配置项使用 JSON
                对象。若系统存在多位管理员，保存操作需要另一位管理员批准后执行。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="option-key">选项标识</Label>
                  <Input
                    id="option-key"
                    value={keyInput}
                    onChange={(event) => changeKey(event.target.value)}
                    placeholder="tools.ozone.team.setting"
                    className="font-mono text-xs"
                    disabled={saving || editor?.mode === 'edit'}
                    maxLength={128}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="option-scope">生效范围</Label>
                  <Select
                    id="option-scope"
                    value={scopeInput}
                    onChange={(event) => {
                      setScopeInput(event.target.value as PolicyScope)
                      setFormError(null)
                    }}
                    disabled={saving || editor?.mode === 'edit'}
                  >
                    <option value="instance">实例级（对全站生效）</option>
                    <option value="personal">个人级（仅当前账号）</option>
                  </Select>
                </div>
              </div>
              {structuredValue ? (
                <div className="max-h-[26rem] space-y-2 overflow-y-auto rounded-md border p-3">
                  <PolicyOptionValueEditor
                    valueKey={keyInput}
                    value={structuredValue}
                    onChange={(next) => {
                      setStructuredValue(next)
                      setFormError(null)
                    }}
                  />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="option-value">选项值（JSON 对象）</Label>
                  <Textarea
                    id="option-value"
                    value={valueInput}
                    onChange={(event) => {
                      setValueInput(event.target.value)
                      setFormError(null)
                    }}
                    className="min-h-32 font-mono text-xs"
                    spellCheck={false}
                    disabled={saving}
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="option-description">选项说明（可选）</Label>
                <Textarea
                  id="option-description"
                  value={descriptionInput}
                  onChange={(event) => {
                    setDescriptionInput(event.target.value)
                    setFormError(null)
                  }}
                  className="min-h-20"
                  maxLength={2000}
                  disabled={saving}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="option-manager-role">管理角色（可选）</Label>
                <Select
                  id="option-manager-role"
                  value={managerRoleInput}
                  onChange={(event) => {
                    setManagerRoleInput(event.target.value)
                    setFormError(null)
                  }}
                  disabled={saving}
                >
                  {MANAGER_ROLES.map((role) => (
                    <option key={role.value || 'none'} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                  {customManagerRole ? (
                    <option value={customManagerRole}>自定义（{customManagerRole}）</option>
                  ) : null}
                </Select>
                <p className="text-xs text-muted-foreground">
                  限制哪些管理角色可以修改该选项；不限制时所有管理员均可修改。
                </p>
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
                保存选项
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
            <AlertDialogTitle>删除策略选项</AlertDialogTitle>
            <AlertDialogDescription>
              删除后审核服务将不再读取“{deleteTarget?.key}”的配置，使用该选项的功能会恢复默认行为。
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
              删除选项
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function safeJson(value: unknown): string {
  if (value === undefined) return '—'
  try {
    const text = JSON.stringify(value)
    if (text === undefined) return '—'
    return text.length > 160 ? `${text.slice(0, 160)}…` : text
  } catch {
    return '—'
  }
}
