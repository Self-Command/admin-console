'use client'

import { useEffect, useState } from 'react'
import {
  DownloadIcon,
  LoaderCircleIcon,
  NotebookPenIcon,
  PauseCircleIcon,
  PlayCircleIcon,
  TagsIcon,
} from 'lucide-react'
import { toast } from 'sonner'
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type { AccountOperation } from '@/lib/data/types'
import { downloadTextFile, exportTimestamp } from '@/lib/download'
import { describeAdminError } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'

const NOTE_LIMIT = 500
const TAG_LIMIT = 10
const TAG_LENGTH = 24

type OperationsState = 'loading' | 'ready' | 'error'

function parseTags(value: string): string[] {
  const seen = new Set<string>()
  const tags: string[] = []
  for (const raw of value.split(/[,\uFF0C\s]+/)) {
    const tag = raw.trim()
    if (!tag) continue
    const key = tag.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
  }
  return tags
}

function validate(note: string, tags: string[]): string | null {
  if (note.length > NOTE_LIMIT) return `运营备注最长 ${NOTE_LIMIT} 个字符。`
  if (tags.length > TAG_LIMIT) return `标签最多 ${TAG_LIMIT} 个，当前有 ${tags.length} 个。`
  const longTag = tags.find((tag) => tag.length > TAG_LENGTH)
  if (longTag) return `标签「${longTag.slice(0, TAG_LENGTH)}…」超过 ${TAG_LENGTH} 个字符。`
  return null
}

export function AccountOperationsCard({
  did,
  handle,
  canWrite,
}: {
  did: string
  handle?: string
  canWrite: boolean
}) {
  const provider = useDataProvider()
  const [state, setState] = useState<OperationsState>('loading')
  const [operation, setOperation] = useState<AccountOperation | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const [note, setNote] = useState('')
  const [tagsText, setTagsText] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [pauseTarget, setPauseTarget] = useState<boolean | null>(null)
  const [togglingSync, setTogglingSync] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let active = true
    setState('loading')
    setLoadError(null)
    provider
      .getAccountProfile(did)
      .then((result) => {
        if (!active) return
        setOperation(result.operation)
        setNote(result.operation.note ?? '')
        setTagsText(result.operation.tags.join('，'))
        setState('ready')
      })
      .catch((cause: unknown) => {
        if (!active) return
        setLoadError(describeAdminError(cause))
        setState('error')
      })
    return () => {
      active = false
    }
  }, [provider, did, reloadToken])

  const tags = parseTags(tagsText)
  const noteChanged = (operation?.note ?? '') !== note.trim()
  const tagsChanged = (operation?.tags ?? []).join('|') !== tags.join('|')
  const changed = noteChanged || tagsChanged
  const validation = validate(note.trim(), tags)
  const syncPaused = operation?.syncPaused ?? false

  async function save() {
    if (!canWrite || saving) return
    const trimmedNote = note.trim()
    const problem = validate(trimmedNote, tags)
    if (problem) {
      setFormError(problem)
      return
    }
    setFormError(null)
    setSaving(true)
    try {
      const next = await provider.updateAccountProfile({
        did,
        note: trimmedNote,
        tags,
      })
      setOperation(next)
      setNote(next.note ?? '')
      setTagsText(next.tags.join('，'))
      toast.success('运营记录已保存。')
    } catch (cause) {
      toast.error(describeAdminError(cause))
    } finally {
      setSaving(false)
    }
  }

  async function confirmSyncToggle() {
    if (pauseTarget === null || togglingSync) return
    setTogglingSync(true)
    try {
      const next = await provider.updateAccountProfile({
        did,
        syncPaused: pauseTarget,
      })
      setOperation(next)
      toast.success(pauseTarget ? '已暂停该账号的目录同步。' : '已恢复该账号的目录同步。')
      setPauseTarget(null)
    } catch (cause) {
      toast.error(describeAdminError(cause))
    } finally {
      setTogglingSync(false)
    }
  }

  async function exportRecord() {
    if (exporting) return
    setExporting(true)
    try {
      const result = await provider.exportAccount(did)
      const label = (handle ?? did).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 40)
      downloadTextFile(
        `account-${label}-${exportTimestamp()}.json`,
        JSON.stringify(result.document, null, 2),
        'application/json;charset=utf-8',
      )
      toast.success('已导出该账号的运营记录。')
    } catch (cause) {
      toast.error(describeAdminError(cause))
    } finally {
      setExporting(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <NotebookPenIcon className="size-4 text-muted-foreground" />
            运营记录
          </CardTitle>
          <CardDescription>
            备注、标签与同步状态仅保存在管理后台，不会改变社区中的账号资料。
          </CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {syncPaused ? <Badge variant="warning">目录同步已暂停</Badge> : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void exportRecord()}
            disabled={exporting}
          >
            {exporting ? <LoaderCircleIcon className="animate-spin" /> : <DownloadIcon />}
            导出记录
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {state === 'loading' ? (
          <p className="text-sm text-muted-foreground">正在读取运营记录…</p>
        ) : state === 'error' ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-destructive">
              {loadError ?? '运营记录加载失败，请稍后重试。'}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReloadToken((value) => value + 1)}
            >
              重试
            </Button>
          </div>
        ) : (
          <>
            {!canWrite ? (
              <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-relaxed">
                当前账号没有账号运营权限，只能查看运营记录；如需修改，请联系管理员开通。
              </p>
            ) : null}

            <div className="grid gap-5 lg:grid-cols-2">
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium" htmlFor="account-note">
                  <NotebookPenIcon className="size-3.5 text-muted-foreground" />
                  运营备注
                </label>
                <Textarea
                  id="account-note"
                  value={note}
                  onChange={(event) => {
                    setNote(event.target.value)
                    setFormError(null)
                  }}
                  maxLength={NOTE_LIMIT}
                  rows={4}
                  placeholder="记录与该账号相关的运营背景、沟通结果或处置说明。"
                  disabled={!canWrite || saving}
                />
                <p className="text-right text-xs text-muted-foreground tabular-nums">
                  {note.length} / {NOTE_LIMIT}
                </p>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium" htmlFor="account-tags">
                  <TagsIcon className="size-3.5 text-muted-foreground" />
                  标签
                </label>
                <Input
                  id="account-tags"
                  value={tagsText}
                  onChange={(event) => {
                    setTagsText(event.target.value)
                    setFormError(null)
                  }}
                  placeholder="用逗号分隔，例如：重点客户，已回访"
                  disabled={!canWrite || saving}
                />
                <p className="text-xs text-muted-foreground">
                  最多 {TAG_LIMIT} 个，每个不超过 {TAG_LENGTH} 个字符；已识别 {tags.length} 个。
                </p>
                {tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {tags.map((tag) => (
                      <Badge key={tag} variant="secondary">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            {formError ?? validation ? (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {formError ?? validation}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => void save()}
                disabled={!canWrite || !changed || saving || validation !== null}
              >
                {saving ? <LoaderCircleIcon className="animate-spin" /> : null}
                保存运营记录
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setNote(operation?.note ?? '')
                  setTagsText((operation?.tags ?? []).join('，'))
                  setFormError(null)
                }}
                disabled={!canWrite || !changed || saving}
              >
                放弃更改
              </Button>
              {operation?.updatedAt ? (
                <span className="text-xs text-muted-foreground">
                  最近更新：{formatDateTime(operation.updatedAt)}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">尚未填写运营记录</span>
              )}
            </div>

            <Separator />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium">目录同步</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {syncPaused
                    ? `该账号的后续事件暂不写入目录，目录保留暂停前的数据。${
                        operation?.syncPausedAt
                          ? `暂停时间：${formatDateTime(operation.syncPausedAt)}。`
                          : ''
                      }`
                    : '目录会持续应用该账号的账号事件。暂停后社区账号本身不受影响。'}
                </p>
              </div>
              <Button
                variant={syncPaused ? 'default' : 'outline'}
                size="sm"
                onClick={() => setPauseTarget(!syncPaused)}
                disabled={!canWrite || togglingSync}
              >
                {syncPaused ? <PlayCircleIcon /> : <PauseCircleIcon />}
                {syncPaused ? '恢复目录同步' : '暂停目录同步'}
              </Button>
            </div>

            <p className="border-t pt-3 text-xs leading-relaxed text-muted-foreground">
              运营记录与目录同步设置只影响管理后台的展示与索引，不会封禁、停用或修改社区账号；
              账号状态处置请在官方账号服务或审核后台完成。
            </p>
          </>
        )}
      </CardContent>

      <Dialog
        open={pauseTarget !== null}
        onOpenChange={(open) => {
          if (!open && !togglingSync) setPauseTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pauseTarget ? '暂停目录同步' : '恢复目录同步'}</DialogTitle>
            <DialogDescription>
              {pauseTarget
                ? '暂停后，该账号的后续事件不会写入目录，目录保留暂停前的数据；社区账号本身不受影响。恢复后从后续事件继续同步。'
                : '恢复后，该账号的后续事件会重新写入目录。暂停期间缺失的事件不会补写。'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPauseTarget(null)}
              disabled={togglingSync}
            >
              取消
            </Button>
            <Button onClick={() => void confirmSyncToggle()} disabled={togglingSync}>
              {togglingSync ? <LoaderCircleIcon className="animate-spin" /> : null}
              {pauseTarget ? '确认暂停' : '确认恢复'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}