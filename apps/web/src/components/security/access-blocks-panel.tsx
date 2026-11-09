'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { LoaderCircleIcon, ShieldCheckIcon, ShieldOffIcon } from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState, ErrorState, LoadingState } from '@/components/data-state'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type { AccessBlock } from '@/lib/data/types'
import { describeAdminError } from '@/lib/errors'
import { formatDateTime, truncateDid } from '@/lib/format'

type LoadStatus = 'loading' | 'ready' | 'error'

type Props = {
  canWrite: boolean
  selfDid?: string
  onChanged: () => void
}

const PAGE_SIZE = 20

export function AccessBlocksPanel({ canWrite, selfDid, onChanged }: Props) {
  const provider = useDataProvider()

  const [blocks, setBlocks] = useState<AccessBlock[]>([])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [listError, setListError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const [page, setPage] = useState(1)
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined])
  const [nextCursor, setNextCursor] = useState<string | undefined>()

  const [unblockTarget, setUnblockTarget] = useState<AccessBlock | null>(null)
  const [unblockError, setUnblockError] = useState<string | null>(null)
  const [unblocking, setUnblocking] = useState(false)

  useEffect(() => {
    let active = true
    const cursor = cursors[page - 1]
    setStatus('loading')
    setListError(null)

    provider
      .listBlocked({ cursor, limit: PAGE_SIZE })
      .then((result) => {
        if (!active) return
        setBlocks(result.blocks)
        setTotal(result.total)
        setNextCursor(result.cursor)
        setStatus('ready')
        const maxPage = Math.max(1, Math.ceil(result.total / PAGE_SIZE))
        if (page > maxPage) {
          setPage(maxPage)
          setCursors((current) => current.slice(0, maxPage))
        }
      })
      .catch((cause: unknown) => {
        if (!active) return
        setListError(describeAdminError(cause))
        setStatus('error')
      })

    return () => {
      active = false
    }
  }, [provider, cursors, page, reloadToken])

  function reload() {
    setReloadToken((value) => value + 1)
    onChanged()
  }

  async function confirmUnblock() {
    if (!unblockTarget) return
    setUnblocking(true)
    setUnblockError(null)
    try {
      await provider.unblockAccess(unblockTarget.did)
      toast.success(`已解除 ${truncateDid(unblockTarget.did, 24, 8)} 的后台访问封锁`)
      setUnblockTarget(null)
      reload()
    } catch (cause) {
      setUnblockError(describeAdminError(cause))
    } finally {
      setUnblocking(false)
    }
  }

  const pageStart = (page - 1) * PAGE_SIZE
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const showInitialLoading = status === 'loading' && blocks.length === 0

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card px-4 py-3">
        <p className="text-sm font-medium">已封锁的后台访问</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          封锁只拒绝该账号调用管理后台接口，不影响其在社区中的登录、发布与互动；解除后立即恢复。
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        {status === 'error' ? (
          <ErrorState
            title="访问封锁列表加载失败"
            message={listError ?? '操作失败，请稍后重试。'}
            onRetry={() => setReloadToken((value) => value + 1)}
          />
        ) : showInitialLoading ? (
          <LoadingState label="正在加载访问封锁列表…" />
        ) : blocks.length === 0 ? (
          <EmptyState
            icon={ShieldCheckIcon}
            title="当前没有封锁记录"
            message="如需限制某个账号的后台访问，可在“访问活动”页签中选择该账号并执行封锁。"
          />
        ) : (
          <Table aria-busy={status === 'loading'}>
            <TableHeader>
              <TableRow>
                <TableHead>账号</TableHead>
                <TableHead>封锁原因</TableHead>
                <TableHead>操作人</TableHead>
                <TableHead>封锁时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {blocks.map((block) => {
                const self = selfDid !== undefined && block.did === selfDid
                return (
                  <TableRow key={block.did}>
                    <TableCell>
                      <Link
                        href={`/directory/${encodeURIComponent(block.did)}`}
                        className="block max-w-56 truncate font-mono text-xs text-primary hover:underline"
                        title={block.did}
                      >
                        {truncateDid(block.did, 22, 8)}
                      </Link>
                      {self ? (
                        <Badge variant="outline" className="mt-1">
                          当前账号
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="max-w-64 text-xs text-muted-foreground">
                      {block.reason ?? '未填写原因'}
                    </TableCell>
                    <TableCell
                      className="font-mono text-xs text-muted-foreground"
                      title={block.blockedBy}
                    >
                      {truncateDid(block.blockedBy, 16, 6)}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                      {formatDateTime(block.blockedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setUnblockError(null)
                          setUnblockTarget(block)
                        }}
                        disabled={!canWrite || self}
                        title={
                          self
                            ? '不能解除自己的后台封锁，请联系其他管理员'
                            : canWrite
                              ? undefined
                              : '当前账号没有管理后台安全的权限'
                        }
                      >
                        <ShieldOffIcon />
                        解除封锁
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}

        <div className="flex flex-col gap-2 border-t px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            共 {total} 条
            {total > 0 ? `，第 ${pageStart + 1}–${pageStart + blocks.length} 条` : ''}
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
      </div>

      <Dialog
        open={unblockTarget !== null}
        onOpenChange={(open) => {
          if (!open && !unblocking) setUnblockTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>解除后台访问封锁</DialogTitle>
            <DialogDescription>
              解除后该账号可以重新调用管理后台接口；操作会写入审计日志。
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-muted/40 p-3 font-mono text-xs break-all">
            {unblockTarget?.did}
          </div>
          {unblockError ? (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {unblockError}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnblockTarget(null)} disabled={unblocking}>
              取消
            </Button>
            <Button onClick={confirmUnblock} disabled={unblocking}>
              {unblocking ? <LoaderCircleIcon className="animate-spin" /> : null}
              确认解除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}