'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { LoaderCircleIcon, MonitorIcon, SearchXIcon, ShieldBanIcon } from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState, ErrorState, LoadingState } from '@/components/data-state'
import { useAuth } from '@/components/auth/auth-provider'
import { useWorkspace } from '@/components/layout/workspace-provider'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { hasPermission } from '@/lib/access'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type { AccessRecord } from '@/lib/data/types'
import { describeAdminError } from '@/lib/errors'
import { formatDateTime, formatNumber, truncateDid } from '@/lib/format'

const DID_PATTERN = /^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/

type LoadStatus = 'loading' | 'ready' | 'error'

export function AccessActivityPanel() {
  const provider = useDataProvider()
  const { identity } = useAuth()
  const { pageSize } = useWorkspace()
  const canWrite = hasPermission(identity, 'security.write')

  const [records, setRecords] = useState<AccessRecord[]>([])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [listError, setListError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const [didInput, setDidInput] = useState('')
  const [appliedDid, setAppliedDid] = useState<string | undefined>()
  const [didError, setDidError] = useState<string | null>(null)

  const [page, setPage] = useState(1)
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined])
  const [nextCursor, setNextCursor] = useState<string | undefined>()

  const [blockTarget, setBlockTarget] = useState<AccessRecord | null>(null)
  const [blockReason, setBlockReason] = useState('')
  const [blockError, setBlockError] = useState<string | null>(null)
  const [blocking, setBlocking] = useState(false)

  useEffect(() => {
    let active = true
    const cursor = cursors[page - 1]
    setStatus('loading')
    setListError(null)

    provider
      .listAccess({ cursor, limit: pageSize, did: appliedDid })
      .then((result) => {
        if (!active) return
        setRecords(result.records)
        setTotal(result.total)
        setNextCursor(result.cursor)
        setStatus('ready')
        const maxPage = Math.max(1, Math.ceil(result.total / pageSize))
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
  }, [provider, cursors, page, pageSize, appliedDid, reloadToken])

  function reload() {
    setReloadToken((value) => value + 1)
  }

  function resetPaging() {
    setPage(1)
    setCursors([undefined])
  }

  function applyFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = didInput.trim()
    if (value && !DID_PATTERN.test(value)) {
      setDidError('请输入完整的账号标识，例如 did:plc:… 或 did:web:…')
      return
    }
    setDidError(null)
    setAppliedDid(value || undefined)
    resetPaging()
  }

  function openBlock(record: AccessRecord) {
    setBlockTarget(record)
    setBlockReason('')
    setBlockError(null)
  }

  async function confirmBlock() {
    if (!blockTarget) return
    if (blockReason.trim().length > 200) {
      setBlockError('原因不能超过 200 个字符。')
      return
    }
    setBlocking(true)
    setBlockError(null)
    try {
      await provider.blockAccess(blockTarget.did, blockReason.trim() || undefined)
      toast.success(`已封锁 ${truncateDid(blockTarget.did, 24, 8)} 的后台访问`)
      setBlockTarget(null)
      reload()
    } catch (cause) {
      setBlockError(describeAdminError(cause))
    } finally {
      setBlocking(false)
    }
  }

  const pageStart = (page - 1) * pageSize
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const showInitialLoading = status === 'loading' && records.length === 0
  const hasFilter = didInput.trim() !== '' || appliedDid !== undefined

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-start sm:justify-between">
        <form className="flex flex-1 flex-col gap-1.5 sm:max-w-xl sm:flex-row sm:items-start" onSubmit={applyFilter}>
          <div className="flex flex-1 items-center gap-2">
            <Input
              value={didInput}
              onChange={(event) => {
                setDidInput(event.target.value)
                setDidError(null)
              }}
              placeholder="按账号标识（DID）精确筛选"
              className="font-mono text-xs"
              aria-label="按账号标识筛选访问记录"
              aria-invalid={didError ? true : undefined}
            />
            <Button type="submit" variant="secondary" size="sm" className="h-9">
              应用
            </Button>
          </div>
          <p
            className={`text-[11px] sm:max-w-48 ${didError ? 'text-destructive' : 'text-muted-foreground'}`}
          >
            {didError ?? '账号标识是 AT Protocol 身份的唯一编号，可在账号详情中复制。'}
          </p>
        </form>
        <p className="text-xs text-muted-foreground">共 {formatNumber(total)} 条访问记录</p>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        {status === 'error' ? (
          <ErrorState
            title="访问记录加载失败"
            message={listError ?? '操作失败，请稍后重试。'}
            onRetry={reload}
          />
        ) : showInitialLoading ? (
          <LoadingState label="正在加载后台访问记录…" />
        ) : records.length === 0 ? (
          <EmptyState
            icon={SearchXIcon}
            title="没有匹配的访问记录"
            message="后台访问记录按账号、来源地址与客户端汇总保留 90 天；调整筛选条件后再试。"
            action={
              hasFilter ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDidInput('')
                    setAppliedDid(undefined)
                    setDidError(null)
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
                <TableHead>账号</TableHead>
                <TableHead>来源地址</TableHead>
                <TableHead>客户端</TableHead>
                <TableHead>首次访问</TableHead>
                <TableHead>最近访问</TableHead>
                <TableHead className="text-right">请求次数</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((record) => (
                <TableRow key={`${record.did}-${record.ip}-${record.userAgent ?? ''}`}>
                  <TableCell>
                    <Link
                      href={`/directory/${encodeURIComponent(record.did)}`}
                      className="block max-w-48 truncate font-mono text-xs text-primary hover:underline"
                      title={record.did}
                    >
                      {truncateDid(record.did, 20, 8)}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{record.ip}</TableCell>
                  <TableCell className="max-w-56">
                    <span className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <MonitorIcon className="mt-0.5 size-3.5 shrink-0" />
                      <span className="line-clamp-2 break-all">
                        {record.userAgent ?? '未记录客户端'}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                    {formatDateTime(record.firstSeenAt)}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                    {formatDateTime(record.lastSeenAt)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {formatNumber(record.requestCount)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openBlock(record)}
                      disabled={!canWrite}
                      title={canWrite ? undefined : '当前账号没有管理后台安全的权限'}
                    >
                      <ShieldBanIcon />
                      封锁访问
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <div className="flex flex-col gap-2 border-t px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            共 {formatNumber(total)} 条
            {total > 0 ? `，第 ${pageStart + 1}–${pageStart + records.length} 条` : ''}
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
        open={blockTarget !== null}
        onOpenChange={(open) => {
          if (!open && !blocking) setBlockTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>封锁后台访问</DialogTitle>
            <DialogDescription>
              封锁只作用于管理后台：该账号无法再调用后台接口，但社区账号、内容与社交功能不受影响。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border bg-muted/40 p-3 font-mono text-xs break-all">
              {blockTarget?.did}
            </div>
            <div className="space-y-1.5">
              <label htmlFor="block-reason" className="text-sm font-medium">
                封锁原因（可选）
              </label>
              <Input
                id="block-reason"
                value={blockReason}
                onChange={(event) => setBlockReason(event.target.value)}
                placeholder="例如：账号疑似泄露，等待本人确认"
                maxLength={200}
                disabled={blocking}
              />
              <p className="text-xs text-muted-foreground">
                原因会显示在被封锁账号的提示中，便于其联系管理员。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">不可封锁自己</Badge>
              <Badge variant="outline">操作写入审计</Badge>
            </div>
            {blockError ? (
              <p
                role="alert"
                className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                {blockError}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBlockTarget(null)} disabled={blocking}>
              取消
            </Button>
            <Button variant="destructive" onClick={confirmBlock} disabled={blocking}>
              {blocking ? <LoaderCircleIcon className="animate-spin" /> : null}
              确认封锁
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}