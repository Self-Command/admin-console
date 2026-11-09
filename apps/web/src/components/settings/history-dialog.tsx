'use client'

import { useEffect, useState } from 'react'
import { HistoryIcon, LoaderCircleIcon, RotateCcwIcon } from 'lucide-react'
import { EmptyState } from '@/components/data-state'
import { useAuth } from '@/components/auth/auth-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { describeAdminError } from '@/lib/errors'
import { formatTimestamp, truncateDid } from '@/lib/format'
import type {
  DateFormat,
  SettingRevision,
  SettingSectionKey,
  SettingsHistoryResult,
} from '@/lib/runtime/types'
import { describeChangedFields, sectionLabel } from './settings-utils'

const HISTORY_NSID = 'com.selfcommand.admin.settings.history'
const PAGE_SIZE = 20

type LoadStatus = 'loading' | 'ready' | 'error'

export function HistoryDialog({
  open,
  onOpenChange,
  section,
  dateFormat,
  canWrite,
  onRestore,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  section: SettingSectionKey
  dateFormat: DateFormat
  canWrite: boolean
  onRestore: (revision: SettingRevision) => Promise<boolean>
}) {
  const { callAdmin } = useAuth()
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [data, setData] = useState<SettingsHistoryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [detail, setDetail] = useState<SettingRevision | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!open) return
    let active = true
    setStatus('loading')
    setData(null)
    setError(null)
    setDetail(null)

    callAdmin<SettingsHistoryResult>(HISTORY_NSID, {
      params: { section, limit: String(PAGE_SIZE) },
    })
      .then((result) => {
        if (!active) return
        setData(result)
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
  }, [open, section, callAdmin, reloadToken])

  async function loadMore() {
    const cursor = data?.cursor
    if (!cursor) return
    setLoadingMore(true)
    setError(null)
    try {
      const next = await callAdmin<SettingsHistoryResult>(HISTORY_NSID, {
        params: { section, limit: String(PAGE_SIZE), cursor },
      })
      setData((current) =>
        current
          ? {
              ...next,
              revisions: [...current.revisions, ...next.revisions],
            }
          : next,
      )
    } catch (cause) {
      setError(describeAdminError(cause))
    } finally {
      setLoadingMore(false)
    }
  }

  async function restore() {
    if (!detail) return
    setRestoring(true)
    const restored = await onRestore(detail)
    setRestoring(false)
    if (restored) {
      setDetail(null)
      onOpenChange(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>版本历史 · {sectionLabel(section)}</DialogTitle>
            <DialogDescription>
              每次保存都会生成一条记录，最多保留最近 50 次。恢复操作会写入新的版本与审计日志。
            </DialogDescription>
          </DialogHeader>

          {status === 'loading' ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <LoaderCircleIcon className="size-4 animate-spin" />
              正在加载版本历史
            </div>
          ) : status === 'error' ? (
            <div className="space-y-3 py-8 text-center">
              <p role="alert" className="text-sm text-muted-foreground">
                {error ?? '版本历史加载失败，请稍后重试。'}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReloadToken((token) => token + 1)}
              >
                重试
              </Button>
            </div>
          ) : data && data.revisions.length === 0 ? (
            <EmptyState
              icon={HistoryIcon}
              title="暂无版本记录"
              message="保存此分区的设置后，版本历史会显示在这里。"
            />
          ) : data ? (
            <div className="space-y-3">
              <ScrollArea className="max-h-[24rem] pr-2">
                <div className="space-y-2">
                  {data.revisions.map((revision) => {
                    const changes = describeChangedFields(
                      section,
                      revision.before,
                      revision.after,
                    )
                    return (
                      <div key={revision.id} className="rounded-lg border p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">版本 {revision.version}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {formatTimestamp(revision.createdAt, dateFormat)}
                          </span>
                          <span
                            className="max-w-48 truncate font-mono text-[11px] text-muted-foreground"
                            title={revision.actor}
                          >
                            {truncateDid(revision.actor, 16, 6)}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="ml-auto h-7 px-2 text-xs"
                            onClick={() => setDetail(revision)}
                          >
                            查看详情
                          </Button>
                        </div>
                        {revision.reason ? (
                          <p className="mt-2 text-xs text-muted-foreground">
                            原因：{revision.reason}
                          </p>
                        ) : null}
                        <p className="mt-1 text-xs">
                          <span className="text-muted-foreground">变更：</span>
                          {changes.length > 0 ? changes.join('、') : '内容与上一版本相同'}
                        </p>
                      </div>
                    )
                  })}
                </div>
              </ScrollArea>

              {error ? (
                <p role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              ) : null}

              <div className="flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
                <span>
                  共 {data.total} 条记录，已显示 {data.revisions.length} 条
                </span>
                {data.cursor ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={loadMore}
                    disabled={loadingMore}
                  >
                    {loadingMore ? <LoaderCircleIcon className="animate-spin" /> : null}
                    加载更多
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={detail !== null}
        onOpenChange={(next) => {
          if (!next && !restoring) setDetail(null)
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>版本 {detail?.version} 的变更内容</DialogTitle>
            <DialogDescription>
              恢复会把此分区改回该次修改之前的内容。恢复前请确认当前草稿已保存或不再需要。
            </DialogDescription>
          </DialogHeader>
          {detail ? (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">修改前</p>
                <pre className="max-h-64 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
                  {JSON.stringify(detail.before, null, 2)}
                </pre>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">修改后</p>
                <pre className="max-h-64 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
                  {JSON.stringify(detail.after, null, 2)}
                </pre>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetail(null)} disabled={restoring}>
              关闭
            </Button>
            {canWrite ? (
              <Button onClick={restore} disabled={restoring}>
                {restoring ? (
                  <LoaderCircleIcon className="animate-spin" />
                ) : (
                  <RotateCcwIcon />
                )}
                恢复到此次修改前
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
