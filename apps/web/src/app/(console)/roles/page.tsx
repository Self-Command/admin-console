'use client'

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import {
  CheckIcon,
  Columns3Icon,
  DownloadIcon,
  LoaderCircleIcon,
  MinusIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/page-header'
import { EmptyState, ErrorState, LoadingState } from '@/components/data-state'
import { useAuth } from '@/components/auth/auth-provider'
import { useWorkspace } from '@/components/layout/workspace-provider'
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
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
import { ApprovalRequestDialog } from '@/components/security/approval-request-dialog'
import { AdminApiError } from '@/lib/api/admin-client'
import { hasPermission } from '@/lib/access'
import {
  demoteApprovalDraft,
  importApprovalDraft,
  revokeApprovalDraft,
  type ApprovalRequestDraft,
} from '@/lib/approvals'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type { RoleBinding, RoleImportItem, RoleSort, SortOrder } from '@/lib/data/types'
import { downloadTextFile, exportTimestamp } from '@/lib/download'
import { describeAdminError } from '@/lib/errors'
import { formatDateTime, truncateDid } from '@/lib/format'
import {
  allPermissions,
  permissionDescriptions,
  permissionLabels,
  roleDescriptions,
  roleLabels,
  rolePermissions,
  type Permission,
  type RoleName,
} from '@/lib/roles'

const DID_PATTERN = /^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/
const PAGE_SIZE = 10
const MAX_IMPORT_ROWS = 500
const COLUMN_STORAGE_KEY = 'selfcommand.admin.roles.columns'

type LoadStatus = 'loading' | 'ready' | 'error'
type SortValue = `${RoleSort}:${SortOrder}`

const SORT_OPTIONS: Array<{ value: SortValue; label: string }> = [
  { value: 'updatedAt:desc', label: '最近更新在前' },
  { value: 'updatedAt:asc', label: '最早更新在前' },
  { value: 'createdAt:desc', label: '最近创建在前' },
  { value: 'createdAt:asc', label: '最早创建在前' },
  { value: 'subject:asc', label: '账号标识升序' },
  { value: 'subject:desc', label: '账号标识降序' },
  { value: 'role:asc', label: '角色升序' },
  { value: 'role:desc', label: '角色降序' },
]

type ColumnKey = 'note' | 'grantedBy' | 'createdAt' | 'updatedAt'

const COLUMN_LABELS: Record<ColumnKey, string> = {
  note: '备注',
  grantedBy: '授权人',
  createdAt: '创建时间',
  updatedAt: '更新时间',
}

const DEFAULT_COLUMNS: Record<ColumnKey, boolean> = {
  note: true,
  grantedBy: true,
  createdAt: false,
  updatedAt: true,
}

function readColumns(): Record<ColumnKey, boolean> {
  try {
    const raw = window.localStorage.getItem(COLUMN_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_COLUMNS }
    const value = JSON.parse(raw) as Record<string, unknown>
    return {
      note: typeof value.note === 'boolean' ? value.note : DEFAULT_COLUMNS.note,
      grantedBy: typeof value.grantedBy === 'boolean' ? value.grantedBy : DEFAULT_COLUMNS.grantedBy,
      createdAt: typeof value.createdAt === 'boolean' ? value.createdAt : DEFAULT_COLUMNS.createdAt,
      updatedAt: typeof value.updatedAt === 'boolean' ? value.updatedAt : DEFAULT_COLUMNS.updatedAt,
    }
  } catch {
    return { ...DEFAULT_COLUMNS }
  }
}

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

function parseRoleValue(value: string): RoleName | null {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'admin' || normalized === '管理员') return 'admin'
  if (normalized === 'operator' || normalized === '运营') return 'operator'
  if (normalized === 'viewer' || normalized === '只读') return 'viewer'
  return null
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index)
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        field += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (char !== '\r') {
      field += char
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''))
}

type ImportRow = {
  line: number
  subject: string
  role: RoleName | null
  roleInput: string
  note?: string
  error?: string
}

type RawImportRow = { subject?: unknown; role?: unknown; note?: unknown }

function buildImportRows(text: string): ImportRow[] {
  const content = text.replace(/^\uFEFF/, '').trim()
  if (!content) throw new Error('文件内容为空，请选择包含角色数据的文件。')

  let raw: RawImportRow[] = []
  if (content.startsWith('[') || content.startsWith('{')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch {
      throw new Error('JSON 文件格式不正确，请检查后重新上传。')
    }
    if (Array.isArray(parsed)) {
      raw = parsed as RawImportRow[]
    } else if (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as { bindings?: unknown }).bindings)
    ) {
      raw = (parsed as { bindings: RawImportRow[] }).bindings
    } else {
      throw new Error('JSON 内容需为角色数组，或包含 bindings 数组的对象。')
    }
  } else {
    const rows = parseCsv(content)
    if (rows.length === 0) throw new Error('文件内容为空，请选择包含角色数据的文件。')
    const header = (rows[0] ?? []).map((cell) => cell.trim().toLowerCase())
    const hasHeader = header.includes('subject') || header.includes('role')
    const subjectIndex = header.indexOf('subject')
    const roleIndex = header.indexOf('role')
    const noteIndex = header.indexOf('note')
    const start = hasHeader ? 1 : 0
    raw = rows.slice(start).map((cells) =>
      hasHeader
        ? {
            subject: subjectIndex >= 0 ? cells[subjectIndex] : undefined,
            role: roleIndex >= 0 ? cells[roleIndex] : undefined,
            note: noteIndex >= 0 ? cells[noteIndex] : undefined,
          }
        : { subject: cells[0], role: cells[1], note: cells[2] },
    )
  }

  if (raw.length === 0) throw new Error('文件中没有可导入的数据行。')
  if (raw.length > MAX_IMPORT_ROWS) {
    throw new Error(`一次最多导入 ${MAX_IMPORT_ROWS} 条角色绑定，请拆分文件后重试。`)
  }

  const seen = new Map<string, number>()
  return raw.map((item, index) => {
    const line = index + 1
    const subject = typeof item.subject === 'string' ? item.subject.trim() : ''
    const roleInput = typeof item.role === 'string' ? item.role.trim() : ''
    const role = parseRoleValue(roleInput)
    const note = typeof item.note === 'string' ? item.note.trim() : ''

    let error: string | undefined
    if (!subject) {
      error = '账号标识不能为空'
    } else if (!DID_PATTERN.test(subject)) {
      error = '账号标识格式不正确'
    } else if (seen.has(subject)) {
      error = `与第 ${seen.get(subject)} 行账号标识重复`
    } else if (!role) {
      error = '角色需填写管理员、运营、只读或对应英文名称'
    } else if (note.length > 200) {
      error = '备注不能超过 200 个字符'
    }

    if (subject && !seen.has(subject)) seen.set(subject, line)

    return {
      line,
      subject,
      role,
      roleInput,
      ...(note ? { note } : {}),
      ...(error ? { error } : {}),
    }
  })
}

export default function RolesPage() {
  const provider = useDataProvider()
  const { identity } = useAuth()
  const { features } = useWorkspace()
  const canWrite = hasPermission(identity, 'role.write')

  const [roles, setRoles] = useState<RoleBinding[]>([])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [listError, setListError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | RoleName>('all')
  const [sort, setSort] = useState<SortValue>('updatedAt:desc')
  const [page, setPage] = useState(1)
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined])
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [columns, setColumns] = useState<Record<ColumnKey, boolean>>(() =>
    typeof window === 'undefined' ? { ...DEFAULT_COLUMNS } : readColumns(),
  )

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

  const [matrixOpen, setMatrixOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  const [importOpen, setImportOpen] = useState(false)
  const [importRows, setImportRows] = useState<ImportRow[]>([])
  const [importFile, setImportFile] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [approvalDraft, setApprovalDraft] = useState<ApprovalRequestDraft | null>(null)

  useEffect(() => {
    const initialSubject = new URLSearchParams(window.location.search).get('subject')?.trim()
    if (!initialSubject) return
    setSearch(initialSubject)
    setDebouncedSearch(initialSubject)
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(columns))
    } catch {
      // Column preferences are a convenience; the table still works without storage.
    }
  }, [columns])

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
    const [sortField, sortOrder] = sort.split(':') as [RoleSort, SortOrder]
    setStatus('loading')
    setListError(null)

    provider
      .listRoles({
        cursor,
        limit: PAGE_SIZE,
        role: roleFilter === 'all' ? undefined : roleFilter,
        search: debouncedSearch.trim() || undefined,
        sort: sortField,
        order: sortOrder,
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
  }, [provider, cursors, page, roleFilter, sort, debouncedSearch, reloadToken])

  function reload() {
    setReloadToken((value) => value + 1)
  }

  function resetPaging() {
    setPage(1)
    setCursors([undefined])
  }

  function openCreate() {
    setEditing(null)
    setSubject(DID_PATTERN.test(debouncedSearch.trim()) ? debouncedSearch.trim() : '')
    setRole('operator')
    setNote('')
    setFormError(null)
    setFormOpen(true)
  }

  function openEdit(binding: RoleBinding) {
    setEditing(binding)
    setSubject(binding.subject)
    setRole(binding.role)
    setNote(binding.note ?? '')
    setFormError(null)
    setFormOpen(true)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextSubject = subject.trim()

    if (!DID_PATTERN.test(nextSubject)) {
      setFormError('请输入合法的账号标识，例如 did:plc:… 或 did:web:…')
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
        toast.success(`已更新 ${truncateDid(editing.subject, 24, 8)} 的角色`)
      } else {
        await provider.createRole({
          subject: nextSubject,
          role,
          note: note.trim() || undefined,
        })
        toast.success(`已授予 ${truncateDid(nextSubject, 24, 8)} ${roleLabels[role]}角色`)
        resetPaging()
      }
      setFormOpen(false)
      reload()
    } catch (error) {
      if (
        error instanceof AdminApiError &&
        error.code === 'ApprovalRequired' &&
        editing &&
        role !== 'admin'
      ) {
        setFormOpen(false)
        setApprovalDraft(
          demoteApprovalDraft(
            editing.subject,
            role,
            note.trim() || undefined,
          ),
        )
      } else {
        setFormError(mutationMessage(error))
      }
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
      toast.success(`已撤销 ${truncateDid(revokeTarget.subject, 24, 8)} 的角色`)
      setRevokeTarget(null)
      reload()
    } catch (error) {
      if (error instanceof AdminApiError && error.code === 'ApprovalRequired') {
        setRevokeTarget(null)
        setApprovalDraft(revokeApprovalDraft(revokeTarget.subject))
      } else {
        setRevokeError(mutationMessage(error))
      }
      if (error instanceof AdminApiError && error.code === 'RoleNotFound') {
        setRevokeTarget(null)
        reload()
      }
    } finally {
      setRevoking(false)
    }
  }

  async function handleExport() {
    setExporting(true)
    try {
      const result = await provider.exportRoles()
      downloadTextFile(
        `roles-${exportTimestamp()}.json`,
        JSON.stringify(
          { exportedAt: result.exportedAt, total: result.total, bindings: result.bindings },
          null,
          2,
        ),
        'application/json',
      )
      toast.success(`已导出 ${result.total} 条角色绑定`)
    } catch (error) {
      toast.error(describeAdminError(error))
    } finally {
      setExporting(false)
    }
  }

  function openImport() {
    setImportRows([])
    setImportFile(null)
    setImportError(null)
    setImportOpen(true)
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setImportError(null)
    setImportFile(file.name)
    try {
      const text = await file.text()
      setImportRows(buildImportRows(text))
    } catch (error) {
      setImportRows([])
      setImportError(
        error instanceof Error ? error.message : '文件解析失败，请检查文件格式后重试。',
      )
    }
  }

  function downloadTemplate() {
    downloadTextFile('roles-template.csv', 'subject,role,note\n', 'text/csv;charset=utf-8')
  }

  async function submitImport() {
    const invalid = importRows.filter((row) => row.error)
    if (importRows.length === 0) {
      setImportError('请先选择包含角色数据的文件。')
      return
    }
    if (invalid.length > 0) {
      setImportError(`共有 ${invalid.length} 行未通过校验，请修正后重新上传。`)
      return
    }

    const bindings: RoleImportItem[] = importRows.map((row) => ({
      subject: row.subject,
      role: row.role as RoleName,
      ...(row.note ? { note: row.note } : {}),
    }))

    setImporting(true)
    setImportError(null)
    try {
      const result = await provider.importRoles(bindings)
      toast.success(`已导入 ${result.imported} 条角色绑定`)
      setImportOpen(false)
      resetPaging()
      reload()
    } catch (error) {
      if (error instanceof AdminApiError && error.code === 'ApprovalRequired') {
        setImportOpen(false)
        setApprovalDraft(importApprovalDraft(bindings))
      } else if (error instanceof AdminApiError && error.code === 'RoleExists') {
        setImportError('导入批次中有账号已存在角色，本次未写入任何数据。请移除重复账号后重试。')
      } else {
        setImportError(mutationMessage(error))
      }
    } finally {
      setImporting(false)
    }
  }

  const pageStart = (page - 1) * PAGE_SIZE
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const showInitialLoading = status === 'loading' && roles.length === 0
  const hasFilters = search.trim() !== '' || roleFilter !== 'all'
  const invalidImportRows = importRows.filter((row) => row.error).length

  return (
    <div className="space-y-5">
      <PageHeader
        title="管理员与角色"
        description="按账号标识授予后台角色；高风险操作由服务端校验并写入审计。"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setMatrixOpen(true)}>
              <ShieldCheckIcon />
              权限矩阵
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
              {exporting ? <LoaderCircleIcon className="animate-spin" /> : <DownloadIcon />}
              导出
            </Button>
            {canWrite ? (
              <>
                {features.roleBulk ? (
                  <Button variant="outline" size="sm" onClick={openImport}>
                    <UploadIcon />
                    批量导入
                  </Button>
                ) : null}
                <Button size="sm" onClick={openCreate}>
                  <PlusIcon />
                  新增角色
                </Button>
              </>
            ) : (
              <Badge variant="outline">只读视图</Badge>
            )}
          </div>
        }
      />

      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative flex-1 sm:max-w-xs">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索账号标识、备注或授权人"
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
            className="sm:w-32"
            aria-label="按角色筛选"
          >
            <option value="all">全部角色</option>
            {(Object.keys(roleLabels) as RoleName[]).map((item) => (
              <option key={item} value={item}>
                {roleLabels[item]}
              </option>
            ))}
          </Select>
          <Select
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as SortValue)
              resetPaging()
            }}
            className="sm:w-40"
            aria-label="排序方式"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" aria-label="列显示">
                <Columns3Icon />
                列显示
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>显示列</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {(Object.keys(COLUMN_LABELS) as ColumnKey[]).map((key) => (
                <DropdownMenuCheckboxItem
                  key={key}
                  checked={columns[key]}
                  onCheckedChange={(checked) =>
                    setColumns((current) => ({ ...current, [key]: checked === true }))
                  }
                >
                  {COLUMN_LABELS[key]}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
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
            icon={ShieldCheckIcon}
            title="没有匹配的角色绑定"
            message="调整搜索词或角色筛选后再试；也可以直接为账号开通角色。"
            action={
              hasFilters ? (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSearch('')
                      setDebouncedSearch('')
                      setRoleFilter('all')
                      setSort('updatedAt:desc')
                      resetPaging()
                    }}
                  >
                    清空筛选
                  </Button>
                  {canWrite ? (
                    <Button size="sm" onClick={openCreate}>
                      <PlusIcon />
                      新增角色
                    </Button>
                  ) : null}
                </div>
              ) : null
            }
          />
        ) : (
          <Table aria-busy={status === 'loading'}>
            <TableHeader>
              <TableRow>
                <TableHead>成员</TableHead>
                {columns.note ? <TableHead>备注</TableHead> : null}
                <TableHead>角色</TableHead>
                {columns.grantedBy ? <TableHead>授权人</TableHead> : null}
                {columns.createdAt ? <TableHead>创建时间</TableHead> : null}
                {columns.updatedAt ? <TableHead>更新时间</TableHead> : null}
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
                          {roleDescriptions[binding.role]}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  {columns.note ? (
                    <TableCell className="max-w-44 truncate text-xs text-muted-foreground">
                      {binding.note ?? '未填写备注'}
                    </TableCell>
                  ) : null}
                  <TableCell>
                    <RoleBadge role={binding.role} />
                  </TableCell>
                  {columns.grantedBy ? (
                    <TableCell
                      className="font-mono text-xs text-muted-foreground"
                      title={binding.grantedBy}
                    >
                      {binding.grantedBy === 'system'
                        ? '系统引导'
                        : truncateDid(binding.grantedBy, 18, 6)}
                    </TableCell>
                  ) : null}
                  {columns.createdAt ? (
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDateTime(binding.createdAt)}
                    </TableCell>
                  ) : null}
                  {columns.updatedAt ? (
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDateTime(binding.updatedAt)}
                    </TableCell>
                  ) : null}
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
                成员账号标识
              </label>
              <Input
                id="role-subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                disabled={Boolean(editing) || saving}
                placeholder="did:plc:… 或 did:web:…"
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                仅支持已存在的 AT Protocol 身份；可在账号目录中复制账号标识。
              </p>
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
                maxLength={200}
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
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
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

      <Dialog open={matrixOpen} onOpenChange={setMatrixOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>权限矩阵</DialogTitle>
            <DialogDescription>
              角色权限由服务端校验；界面隐藏不等于权限控制，越权请求会被拒绝并记入审计。
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-56">权限</TableHead>
                  {(Object.keys(roleLabels) as RoleName[]).map((item) => (
                    <TableHead key={item} className="text-center">
                      {roleLabels[item]}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {allPermissions.map((permission: Permission) => (
                  <TableRow key={permission}>
                    <TableCell>
                      <p className="text-sm font-medium">{permissionLabels[permission]}</p>
                      <p className="text-xs text-muted-foreground">
                        {permissionDescriptions[permission]}
                      </p>
                    </TableCell>
                    {(Object.keys(roleLabels) as RoleName[]).map((item) => {
                      const granted = rolePermissions[item].includes(permission)
                      return (
                        <TableCell key={item} className="text-center">
                          {granted ? (
                            <CheckIcon
                              className="mx-auto size-4 text-success"
                              aria-label={`${roleLabels[item]}拥有此权限`}
                            />
                          ) : (
                            <MinusIcon
                              className="mx-auto size-4 text-muted-foreground"
                              aria-label={`${roleLabels[item]}没有此权限`}
                            />
                          )}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
            {(Object.keys(roleLabels) as RoleName[]).map((item) => (
              <p key={item}>
                <span className="font-medium text-foreground">{roleLabels[item]}：</span>
                {roleDescriptions[item]}
              </p>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMatrixOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={importOpen}
        onOpenChange={(open) => {
          if (!open && !importing) setImportOpen(false)
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>批量导入角色</DialogTitle>
            <DialogDescription>
              整批导入：任一行校验失败或账号已有角色时，本次不会写入任何数据。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.json,text/csv,application/json"
                className="hidden"
                onChange={handleFileChange}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
              >
                <UploadIcon />
                选择文件
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={downloadTemplate}
                disabled={importing}
              >
                <DownloadIcon />
                下载空白模板
              </Button>
              <span className="text-xs text-muted-foreground">
                {importFile ?? '支持 CSV（subject, role, note）或 JSON，最多 500 行。'}
              </span>
            </div>

            {importError ? (
              <p
                role="alert"
                className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                {importError}
              </p>
            ) : null}

            {importRows.length > 0 ? (
              <div className="max-h-64 overflow-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">行</TableHead>
                      <TableHead>账号标识</TableHead>
                      <TableHead className="w-20">角色</TableHead>
                      <TableHead className="w-40">备注</TableHead>
                      <TableHead className="w-48">校验结果</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importRows.map((row) => (
                      <TableRow key={`${row.line}-${row.subject}`}>
                        <TableCell className="text-xs text-muted-foreground">{row.line}</TableCell>
                        <TableCell className="font-mono text-xs break-all">
                          {row.subject || '—'}
                        </TableCell>
                        <TableCell className="text-xs">
                          {row.role ? roleLabels[row.role] : row.roleInput || '—'}
                        </TableCell>
                        <TableCell className="max-w-40 truncate text-xs text-muted-foreground">
                          {row.note ?? '—'}
                        </TableCell>
                        <TableCell className="text-xs">
                          {row.error ? (
                            <span className="text-destructive">{row.error}</span>
                          ) : (
                            <span className="text-success">可导入</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}

            {importRows.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                共 {importRows.length} 行
                {invalidImportRows > 0 ? `，其中 ${invalidImportRows} 行需要修正` : '，校验通过'}
                。
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setImportOpen(false)}
              disabled={importing}
            >
              取消
            </Button>
            <Button
              onClick={submitImport}
              disabled={importing || importRows.length === 0 || invalidImportRows > 0}
            >
              {importing ? <LoaderCircleIcon className="animate-spin" /> : null}
              导入 {importRows.length > 0 ? `${importRows.length} 条` : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
