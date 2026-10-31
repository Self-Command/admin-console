'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { LoaderCircleIcon, MailPlusIcon, PencilIcon, Trash2Icon } from 'lucide-react'
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
import { useDataProvider } from '@/lib/data/use-data-provider'
import type { NotificationTemplate } from '@/lib/data/types'
import { describeAdminError } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'

type LoadStatus = 'loading' | 'ready' | 'error'
type EditorState =
  | { mode: 'create' }
  | { mode: 'edit'; template: NotificationTemplate }
  | null

type Props = {
  canWrite: boolean
}

export function TemplatePanel({ canWrite }: Props) {
  const provider = useDataProvider()

  const [templates, setTemplates] = useState<NotificationTemplate[]>([])
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [listError, setListError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const [editor, setEditor] = useState<EditorState>(null)
  const [name, setName] = useState('')
  const [subject, setSubject] = useState('')
  const [content, setContent] = useState('')
  const [lang, setLang] = useState('')
  const [disabled, setDisabled] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<NotificationTemplate | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    let active = true
    setStatus('loading')
    setListError(null)
    provider
      .listTemplates()
      .then((value) => {
        if (!active) return
        setTemplates(value.templates)
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
  }, [provider, reloadToken])

  function reload() {
    setReloadToken((value) => value + 1)
  }

  function openCreate() {
    setEditor({ mode: 'create' })
    setName('')
    setSubject('')
    setContent('')
    setLang('')
    setDisabled(false)
    setFormError(null)
  }

  function openEdit(template: NotificationTemplate) {
    setEditor({ mode: 'edit', template })
    setName(template.name)
    setSubject(template.subject)
    setContent(template.contentMarkdown)
    setLang(template.lang ?? '')
    setDisabled(template.disabled)
    setFormError(null)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editor) return
    const trimmedName = name.trim()
    const trimmedSubject = subject.trim()
    const trimmedContent = content.trim()
    if (!trimmedName) {
      setFormError('请填写模板名称。')
      return
    }
    if (!trimmedSubject) {
      setFormError('请填写邮件主题。')
      return
    }
    if (!trimmedContent) {
      setFormError('请填写模板内容。')
      return
    }
    if (trimmedContent.length > 20000) {
      setFormError('模板内容不能超过 20000 个字符。')
      return
    }

    setSaving(true)
    setFormError(null)
    try {
      if (editor.mode === 'create') {
        await provider.actOnTemplate({
          action: 'create',
          name: trimmedName,
          subject: trimmedSubject,
          contentMarkdown: trimmedContent,
          ...(lang.trim() ? { lang: lang.trim() } : {}),
        })
        toast.success('通知模板已创建。')
      } else {
        await provider.actOnTemplate({
          action: 'update',
          id: editor.template.id,
          name: trimmedName,
          subject: trimmedSubject,
          contentMarkdown: trimmedContent,
          ...(lang.trim() ? { lang: lang.trim() } : {}),
          disabled,
        })
        toast.success('通知模板已更新。')
      }
      setEditor(null)
      reload()
    } catch (cause) {
      setFormError(describeAdminError(cause))
    } finally {
      setSaving(false)
    }
  }

  async function toggleDisabled(template: NotificationTemplate) {
    try {
      await provider.actOnTemplate({
        action: 'update',
        id: template.id,
        disabled: !template.disabled,
      })
      toast.success(template.disabled ? '模板已启用。' : '模板已停用。')
      reload()
    } catch (cause) {
      toast.error(describeAdminError(cause))
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await provider.actOnTemplate({ action: 'delete', id: deleteTarget.id })
      toast.success('通知模板已删除。')
      setDeleteTarget(null)
      reload()
    } catch (cause) {
      setDeleteError(describeAdminError(cause))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium">通知模板</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            模板用于统一通知的主题与正文格式；停用的模板不会出现在发送页的模板列表中。
          </p>
        </div>
        <Button size="sm" onClick={openCreate} disabled={!canWrite}>
          <MailPlusIcon />
          新建模板
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        {status === 'error' ? (
          <ErrorState
            title="通知模板加载失败"
            message={listError ?? '操作失败，请稍后重试。'}
            onRetry={reload}
          />
        ) : status === 'loading' && templates.length === 0 ? (
          <LoadingState label="正在加载通知模板…" />
        ) : templates.length === 0 ? (
          <EmptyState
            icon={MailPlusIcon}
            title="尚未创建通知模板"
            message="创建模板后，可以在发送通知时选择模板并自动填入主题与正文。"
            action={
              canWrite ? (
                <Button variant="outline" size="sm" onClick={openCreate}>
                  新建模板
                </Button>
              ) : null
            }
          />
        ) : (
          <Table aria-busy={status === 'loading'}>
            <TableHeader>
              <TableRow>
                <TableHead>模板名称</TableHead>
                <TableHead>邮件主题</TableHead>
                <TableHead>语言</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>最近更新</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((template) => (
                <TableRow key={template.id}>
                  <TableCell className="text-sm font-medium">{template.name}</TableCell>
                  <TableCell className="max-w-64 truncate text-xs text-muted-foreground">
                    {template.subject || '未设置主题'}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {template.lang ?? '未设置'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={template.disabled ? 'muted' : 'success'}>
                      {template.disabled ? '已停用' : '使用中'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                    {formatDateTime(template.updatedAt ?? template.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(template)}
                        disabled={!canWrite}
                      >
                        <PencilIcon />
                        编辑
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleDisabled(template)}
                        disabled={!canWrite}
                      >
                        {template.disabled ? '启用' : '停用'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          setDeleteError(null)
                          setDeleteTarget(template)
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
              <DialogTitle>{editor?.mode === 'edit' ? '编辑通知模板' : '新建通知模板'}</DialogTitle>
              <DialogDescription>
                模板内容支持 Markdown；保存后可在发送通知时选用。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="template-name">模板名称</Label>
                <Input
                  id="template-name"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value)
                    setFormError(null)
                  }}
                  maxLength={200}
                  disabled={saving}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="template-subject">邮件主题</Label>
                <Input
                  id="template-subject"
                  value={subject}
                  onChange={(event) => {
                    setSubject(event.target.value)
                    setFormError(null)
                  }}
                  maxLength={500}
                  disabled={saving}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="template-content">模板内容</Label>
                <Textarea
                  id="template-content"
                  value={content}
                  onChange={(event) => {
                    setContent(event.target.value)
                    setFormError(null)
                  }}
                  className="min-h-40"
                  maxLength={20000}
                  disabled={saving}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="template-lang">语言代码（可选）</Label>
                  <Input
                    id="template-lang"
                    value={lang}
                    onChange={(event) => {
                      setLang(event.target.value)
                      setFormError(null)
                    }}
                    placeholder="例如：zh-CN"
                    maxLength={16}
                    disabled={saving}
                  />
                </div>
                {editor?.mode === 'edit' ? (
                  <div className="flex items-end justify-between gap-2 rounded-lg border px-3 py-2">
                    <div>
                      <p className="text-sm font-medium">启用模板</p>
                      <p className="text-xs text-muted-foreground">停用后不在发送页显示。</p>
                    </div>
                    <Switch
                      checked={!disabled}
                      aria-label="启用模板"
                      onCheckedChange={(checked) => setDisabled(!checked)}
                      disabled={saving}
                    />
                  </div>
                ) : null}
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
                {editor?.mode === 'edit' ? '保存修改' : '创建模板'}
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
            <AlertDialogTitle>删除通知模板</AlertDialogTitle>
            <AlertDialogDescription>
              删除后“{deleteTarget?.name}”将无法在发送通知时选用，已发送的通知不受影响。
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
              删除模板
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
