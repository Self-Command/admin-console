'use client'

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  BookmarkIcon,
  PencilIcon,
  Settings2Icon,
  StarIcon,
  Trash2Icon,
} from 'lucide-react'
import { toast } from 'sonner'
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
import { Checkbox } from '@/components/ui/checkbox'
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
import { useWorkspace } from '@/components/layout/workspace-provider'
import type {
  FilterMacro,
  FilterMacroFilters,
  FilterMacroScope,
} from '@/lib/runtime/types'

const MACRO_NAME_LIMIT = 40
const MACRO_LIMIT = 20

const scopeLabels: Record<FilterMacroScope, string> = {
  reports: '举报',
  events: '事件',
}

function newMacroId(): string {
  return `macro-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function compactFilters(filters: FilterMacroFilters): FilterMacroFilters {
  const compact: FilterMacroFilters = {}
  if (filters.subject) compact.subject = filters.subject
  if (filters.subjectType) compact.subjectType = filters.subjectType
  if (filters.status) compact.status = filters.status
  if (filters.queue) compact.queue = filters.queue
  if (filters.actor) compact.actor = filters.actor
  if (filters.keyword) compact.keyword = filters.keyword
  if (filters.types && filters.types.length > 0) compact.types = filters.types
  if (filters.hasComment !== undefined) compact.hasComment = filters.hasComment
  if (filters.direction) compact.direction = filters.direction
  if (filters.batchId) compact.batchId = filters.batchId
  return compact
}

function withoutDefault(macro: FilterMacro): FilterMacro {
  const cleared: FilterMacro = { id: macro.id, name: macro.name, scope: macro.scope }
  if (macro.filters) cleared.filters = macro.filters
  return cleared
}

function filtersSignature(filters: FilterMacroFilters): string {
  return JSON.stringify(
    Object.keys(filters)
      .sort()
      .map((key) => [key, filters[key as keyof FilterMacroFilters]]),
  )
}

export function FilterMacroBar({
  scope,
  current,
  onApply,
  autoApply = true,
}: {
  scope: FilterMacroScope
  current: FilterMacroFilters
  onApply: (filters: FilterMacroFilters) => void
  autoApply?: boolean
}) {
  const { status, preferences, savingPreferences, savePreferences } = useWorkspace()
  const macros = useMemo(
    () => (preferences.filterMacros ?? []).filter((macro) => macro.scope === scope),
    [preferences.filterMacros, scope],
  )
  const defaultMacro = useMemo(
    () => macros.find((macro) => macro.isDefault),
    [macros],
  )

  const [saveOpen, setSaveOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveDefault, setSaveDefault] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<FilterMacro | null>(null)
  const [renameName, setRenameName] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<FilterMacro | null>(null)

  const onApplyRef = useRef(onApply)
  onApplyRef.current = onApply
  const appliedDefaultRef = useRef<string | null>(null)

  useEffect(() => {
    if (!autoApply || status !== 'ready' || !defaultMacro) return
    if (appliedDefaultRef.current === defaultMacro.id) return
    appliedDefaultRef.current = defaultMacro.id
    const filters = defaultMacro.filters ?? {}
    if (filtersSignature(filters) === filtersSignature(current)) return
    onApplyRef.current(filters)
  }, [autoApply, status, defaultMacro, current])

  const currentSignature = filtersSignature(compactFilters(current))

  function applyMacro(macro: FilterMacro) {
    appliedDefaultRef.current = macro.id
    onApply(macro.filters ?? {})
    setManageOpen(false)
    toast.success(`已应用筛选宏「${macro.name}」。`)
  }

  function openSaveDialog() {
    setSaveName('')
    setSaveDefault(macros.length === 0)
    setSaveError(null)
    setSaveOpen(true)
  }

  async function saveCurrentMacro(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = saveName.trim()
    if (!name) {
      setSaveError('请填写筛选宏名称。')
      return
    }
    if (name.length > MACRO_NAME_LIMIT) {
      setSaveError(`筛选宏名称最长 ${MACRO_NAME_LIMIT} 个字符。`)
      return
    }
    if (macros.some((macro) => macro.name === name)) {
      setSaveError('当前页面已存在同名筛选宏，请使用其他名称。')
      return
    }
    if ((preferences.filterMacros?.length ?? 0) >= MACRO_LIMIT) {
      setSaveError(`最多保存 ${MACRO_LIMIT} 个筛选宏，请先删除不再使用的宏。`)
      return
    }
    const next: FilterMacro[] = (preferences.filterMacros ?? [])
      .map((macro) =>
        saveDefault && macro.scope === scope && macro.isDefault
          ? withoutDefault(macro)
          : macro,
      )
      .concat({
        id: newMacroId(),
        name,
        scope,
        ...(saveDefault ? { isDefault: true } : {}),
        filters: compactFilters(current),
      })
    setSaveError(null)
    const saved = await savePreferences({ filterMacros: next })
    if (!saved) {
      setSaveError('筛选宏未能同步到账号，请稍后重试。')
      return
    }
    setSaveOpen(false)
    toast.success(`已保存筛选宏「${name}」。`)
  }

  async function writeMacros(next: FilterMacro[], failure: string): Promise<boolean> {
    const saved = await savePreferences({ filterMacros: next })
    if (!saved) toast.error(failure)
    return saved
  }

  async function setDefaultMacro(macro: FilterMacro, isDefault: boolean) {
    const next = (preferences.filterMacros ?? []).map((item) => {
      if (item.scope !== macro.scope) return item
      if (item.id === macro.id) {
        return isDefault ? { ...withoutDefault(item), isDefault: true } : withoutDefault(item)
      }
      return isDefault && item.isDefault ? withoutDefault(item) : item
    })
    const saved = await writeMacros(next, '默认筛选未能同步到账号，请稍后重试。')
    if (saved) {
      toast.success(
        isDefault
          ? `已将「${macro.name}」设为${scopeLabels[macro.scope]}页面的默认筛选。`
          : `已取消「${macro.name}」的默认筛选。`,
      )
    }
  }

  function openRename(macro: FilterMacro) {
    setRenameTarget(macro)
    setRenameName(macro.name)
    setRenameError(null)
  }

  async function submitRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!renameTarget) return
    const name = renameName.trim()
    if (!name) {
      setRenameError('请填写筛选宏名称。')
      return
    }
    if (name.length > MACRO_NAME_LIMIT) {
      setRenameError(`筛选宏名称最长 ${MACRO_NAME_LIMIT} 个字符。`)
      return
    }
    if (
      macros.some((macro) => macro.id !== renameTarget.id && macro.name === name)
    ) {
      setRenameError('当前页面已存在同名筛选宏，请使用其他名称。')
      return
    }
    const next = (preferences.filterMacros ?? []).map((macro) =>
      macro.id === renameTarget.id ? { ...macro, name } : macro,
    )
    const saved = await writeMacros(next, '筛选宏重命名未能同步到账号，请稍后重试。')
    if (!saved) {
      setRenameError('筛选宏重命名未能同步到账号，请稍后重试。')
      return
    }
    toast.success(`已重命名为「${name}」。`)
    setRenameTarget(null)
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    const next = (preferences.filterMacros ?? []).filter(
      (macro) => macro.id !== deleteTarget.id,
    )
    const saved = await writeMacros(next, '筛选宏删除未能同步到账号，请稍后重试。')
    if (saved) toast.success(`已删除筛选宏「${deleteTarget.name}」。`)
    setDeleteTarget(null)
  }

  return (
    <div className="flex flex-col gap-2 border-b p-4 text-xs lg:flex-row lg:items-center">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <BookmarkIcon className="size-3.5" />
          筛选宏
        </span>
        {macros.length === 0 ? (
          <span className="text-muted-foreground">尚未保存筛选宏</span>
        ) : (
          macros.map((macro) => {
            const active = filtersSignature(compactFilters(macro.filters ?? {})) === currentSignature
            return (
              <Button
                key={macro.id}
                type="button"
                variant={active ? 'secondary' : 'outline'}
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={() => applyMacro(macro)}
                aria-label={`应用筛选宏：${macro.name}`}
              >
                {macro.isDefault ? (
                  <StarIcon className="size-3 fill-current text-amber-500" />
                ) : null}
                {macro.name}
              </Button>
            )
          })
        )}
      </div>
      <div className="flex items-center gap-2 lg:ml-auto">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={openSaveDialog}
          disabled={savingPreferences}
        >
          保存当前筛选
        </Button>
        {macros.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setManageOpen(true)}
            disabled={savingPreferences}
          >
            <Settings2Icon className="size-3.5" />
            管理
          </Button>
        ) : null}
      </div>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <form className="space-y-4" onSubmit={saveCurrentMacro}>
            <DialogHeader>
              <DialogTitle>保存筛选宏</DialogTitle>
              <DialogDescription>
                将当前筛选条件保存为{scopeLabels[scope]}页面的常用组合。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="macro-name">名称</Label>
              <Input
                id="macro-name"
                value={saveName}
                onChange={(event) => {
                  setSaveName(event.target.value)
                  setSaveError(null)
                }}
                maxLength={MACRO_NAME_LIMIT}
                placeholder="例如：待处理举报"
                aria-invalid={saveError ? true : undefined}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={saveDefault}
                onCheckedChange={(value) => setSaveDefault(value === true)}
              />
              打开{scopeLabels[scope]}页面时默认应用该筛选
            </label>
            {saveError ? <p className="text-xs text-destructive">{saveError}</p> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setSaveOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={savingPreferences}>
                保存
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>管理筛选宏</DialogTitle>
            <DialogDescription>
              筛选宏按管理员账号保存，仅当前页面可使用。默认筛选在打开页面时自动应用。
            </DialogDescription>
          </DialogHeader>
          <div className="divide-y rounded-md border">
            {macros.map((macro) => (
              <div
                key={macro.id}
                className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"
              >
                <span className="flex items-center gap-1.5">
                  {macro.name}
                  {macro.isDefault ? (
                    <Badge variant="secondary" className="gap-1">
                      <StarIcon className="size-3 fill-current text-amber-500" />
                      默认
                    </Badge>
                  ) : null}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => applyMacro(macro)}
                  >
                    应用
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => void setDefaultMacro(macro, !macro.isDefault)}
                    disabled={savingPreferences}
                  >
                    {macro.isDefault ? '取消默认' : '设为默认'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`重命名筛选宏：${macro.name}`}
                    onClick={() => openRename(macro)}
                  >
                    <PencilIcon className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`删除筛选宏：${macro.name}`}
                    onClick={() => setDeleteTarget(macro)}
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setManageOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null)
        }}
      >
        <DialogContent>
          <form className="space-y-4" onSubmit={submitRename}>
            <DialogHeader>
              <DialogTitle>重命名筛选宏</DialogTitle>
              <DialogDescription>仅修改名称，筛选条件保持不变。</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="macro-rename">名称</Label>
              <Input
                id="macro-rename"
                value={renameName}
                onChange={(event) => {
                  setRenameName(event.target.value)
                  setRenameError(null)
                }}
                maxLength={MACRO_NAME_LIMIT}
                aria-invalid={renameError ? true : undefined}
              />
            </div>
            {renameError ? <p className="text-xs text-destructive">{renameError}</p> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenameTarget(null)}>
                取消
              </Button>
              <Button type="submit" disabled={savingPreferences}>
                保存
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除筛选宏「{deleteTarget?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              删除后无法恢复，当前页面的筛选条件不会改变。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void confirmDelete()
              }}
              disabled={savingPreferences}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
