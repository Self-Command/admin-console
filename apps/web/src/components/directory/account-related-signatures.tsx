'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { FingerprintIcon, LoaderCircleIcon, RefreshCwIcon } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState } from '@/components/data-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
import type { RelatedSignatureAccount, SignatureDetail } from '@/lib/data/types'
import { describeAdminError } from '@/lib/errors'
import { truncateDid } from '@/lib/format'

const PAGE_SIZE = 50
const MAX_COMPARE = 25
const SIGNATURE_PREVIEW = 6

type ListState = 'loading' | 'ready' | 'error'
type CorrelationState = 'idle' | 'loading' | 'ready' | 'error'

function SignatureTags({ details }: { details?: SignatureDetail[] }) {
  if (!details || details.length === 0) return null
  const shown = details.slice(0, SIGNATURE_PREVIEW)
  const remaining = details.length - shown.length
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((detail, index) => (
        <Badge
          key={`${detail.property}-${index}`}
          variant="secondary"
          className="max-w-64 truncate font-mono"
          title={`${detail.property}: ${detail.value}`}
        >
          {detail.property}: {detail.value}
        </Badge>
      ))}
      {remaining > 0 ? (
        <span className="text-xs text-muted-foreground">另有 {remaining} 条</span>
      ) : null}
    </div>
  )
}

export function AccountRelatedSignatures({ did }: { did: string }) {
  const provider = useDataProvider()
  const [state, setState] = useState<ListState>('loading')
  const [accounts, setAccounts] = useState<RelatedSignatureAccount[]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const [dialogOpen, setDialogOpen] = useState(false)
  const [correlationState, setCorrelationState] = useState<CorrelationState>('idle')
  const [correlationDetails, setCorrelationDetails] = useState<SignatureDetail[]>([])
  const [correlationError, setCorrelationError] = useState<string | null>(null)
  const generationRef = useRef(0)
  const correlationTokenRef = useRef(0)

  useEffect(() => {
    let active = true
    generationRef.current += 1
    correlationTokenRef.current += 1
    setState('loading')
    setAccounts([])
    setCursor(undefined)
    setError(null)
    setLoadMoreError(null)
    setLoadingMore(false)
    setSelected(new Set())
    setDialogOpen(false)
    setCorrelationState('idle')
    setCorrelationDetails([])
    setCorrelationError(null)

    provider
      .findRelatedSignatureAccounts({ did, limit: PAGE_SIZE })
      .then((result) => {
        if (!active) return
        setAccounts(result.accounts)
        setCursor(result.cursor)
        setState('ready')
      })
      .catch((cause: unknown) => {
        if (!active) return
        setError(describeAdminError(cause))
        setState('error')
      })

    return () => {
      active = false
      generationRef.current += 1
      correlationTokenRef.current += 1
    }
  }, [provider, did, reloadToken])

  function reload() {
    setReloadToken((value) => value + 1)
  }

  async function loadMore() {
    if (loadingMore || !cursor) return
    const generation = generationRef.current
    setLoadingMore(true)
    setLoadMoreError(null)
    try {
      const result = await provider.findRelatedSignatureAccounts({
        did,
        cursor,
        limit: PAGE_SIZE,
      })
      if (generation !== generationRef.current) return
      setAccounts((current) => {
        const known = new Set(current.map((entry) => entry.account.did))
        return [
          ...current,
          ...result.accounts.filter((entry) => !known.has(entry.account.did)),
        ]
      })
      setCursor(result.cursor)
    } catch (cause) {
      if (generation !== generationRef.current) return
      setLoadMoreError(describeAdminError(cause))
    } finally {
      if (generation === generationRef.current) setLoadingMore(false)
    }
  }

  function toggleAccount(accountDid: string, checked: boolean) {
    setSelected((current) => {
      if (checked) {
        if (current.size >= MAX_COMPARE || current.has(accountDid)) return current
        const next = new Set(current)
        next.add(accountDid)
        return next
      }
      if (!current.has(accountDid)) return current
      const next = new Set(current)
      next.delete(accountDid)
      return next
    })
  }

  async function runCorrelation() {
    const dids = Array.from(selected)
    if (dids.length < 2) return
    const token = correlationTokenRef.current + 1
    correlationTokenRef.current = token
    setCorrelationState('loading')
    setCorrelationError(null)
    setCorrelationDetails([])
    try {
      const result = await provider.findSignatureCorrelation(dids)
      if (token !== correlationTokenRef.current) return
      setCorrelationDetails(result.details)
      setCorrelationState('ready')
    } catch (cause) {
      if (token !== correlationTokenRef.current) return
      setCorrelationError(describeAdminError(cause))
      setCorrelationState('error')
    }
  }

  function openCorrelation() {
    if (selected.size < 2 || selected.size > MAX_COMPARE) return
    setDialogOpen(true)
    void runCorrelation()
  }

  const selectedCount = selected.size
  const selectionHint =
    selectedCount < 2
      ? '至少选择两个账号才能比较签名相关性。'
      : selectedCount >= MAX_COMPARE
        ? `最多选择 ${MAX_COMPARE} 个账号进行比较，请取消部分选择后再添加。`
        : `已选择 ${selectedCount} 个账号。`
  const correlationButtonDisabled =
    selectedCount < 2 || selectedCount > MAX_COMPARE || correlationState === 'loading'

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <FingerprintIcon className="size-4 text-muted-foreground" />
            关联账号与威胁签名
          </CardTitle>
          <CardDescription>
            根据审核服务记录的威胁签名，查找与该账号特征相同的其他账号。结果由审核服务计算，可能不完整。
          </CardDescription>
        </div>
        {state === 'ready' ? (
          <Button
            variant="outline"
            size="sm"
            onClick={reload}
            disabled={loadingMore}
            className="shrink-0"
          >
            <RefreshCwIcon className="size-3.5" />
            刷新
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {state === 'loading' ? (
          <LoadingState label="正在加载关联账号…" />
        ) : state === 'error' ? (
          <ErrorState
            title="关联账号加载失败"
            message={error ?? '操作失败，请稍后重试。'}
            onRetry={reload}
          />
        ) : accounts.length === 0 ? (
          <EmptyState
            icon={FingerprintIcon}
            title="未发现关联账号"
            message="审核服务未返回与该账号签名特征相同的其他账号。可以稍后重试。"
            action={
              <Button variant="outline" size="sm" onClick={reload}>
                <RefreshCwIcon className="size-3.5" />
                重新加载
              </Button>
            }
          />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium">签名相关性比较</p>
                <p className="text-xs text-muted-foreground" aria-live="polite">
                  {selectionHint}
                </p>
              </div>
              <Button
                size="sm"
                onClick={openCorrelation}
                disabled={correlationButtonDisabled}
                className="shrink-0"
              >
                {correlationState === 'loading' ? (
                  <LoaderCircleIcon className="animate-spin" />
                ) : null}
                查看签名相关性
              </Button>
            </div>

            <ul className="divide-y">
              {accounts.map(({ account, similarities }) => {
                const isSelected = selected.has(account.did)
                const similarityCount = similarities?.length ?? 0
                return (
                  <li
                    key={account.did}
                    className="flex items-start gap-3 py-4 first:pt-0 last:pb-0"
                  >
                    <Checkbox
                      id={`related-account-${account.did}`}
                      checked={isSelected}
                      onCheckedChange={(checked) =>
                        toggleAccount(account.did, checked === true)
                      }
                      aria-label={`选择账号 ${account.handle}`}
                      disabled={!isSelected && selectedCount >= MAX_COMPARE}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <label
                          htmlFor={`related-account-${account.did}`}
                          className="text-sm font-medium"
                        >
                          {account.handle}
                        </label>
                        {similarityCount > 0 ? (
                          <Badge variant="secondary">相似签名 {similarityCount} 条</Badge>
                        ) : (
                          <Badge variant="outline">未发现共同签名</Badge>
                        )}
                        {account.deactivatedAt ? (
                          <Badge variant="warning">账号已停用</Badge>
                        ) : null}
                      </div>
                      <p
                        className="font-mono text-xs text-muted-foreground"
                        title={account.did}
                      >
                        {truncateDid(account.did)}
                      </p>
                      {similarityCount > 0 ? (
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">共同签名</p>
                          <SignatureTags details={similarities} />
                        </div>
                      ) : null}
                      {account.threatSignatures && account.threatSignatures.length > 0 ? (
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">账号威胁签名</p>
                          <SignatureTags details={account.threatSignatures} />
                        </div>
                      ) : null}
                    </div>
                    <Button variant="outline" size="sm" asChild className="shrink-0">
                      <Link href={`/directory/${encodeURIComponent(account.did)}`}>
                        查看账号
                      </Link>
                    </Button>
                  </li>
                )
              })}
            </ul>

            {cursor ? (
              <div className="border-t pt-4">
                {loadMoreError ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <p role="alert" className="text-xs text-destructive">
                      {loadMoreError}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void loadMore()}
                      disabled={loadingMore}
                    >
                      {loadingMore ? <LoaderCircleIcon className="animate-spin" /> : null}
                      重试
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                  >
                    {loadingMore ? <LoaderCircleIcon className="animate-spin" /> : null}
                    加载更多
                  </Button>
                )}
              </div>
            ) : null}
          </div>
        )}
      </CardContent>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>签名相关性</DialogTitle>
            <DialogDescription>
              所选账号之间共同的签名特征，结果由审核服务计算，可能不完整。
            </DialogDescription>
          </DialogHeader>

          {correlationState === 'loading' ? (
            <LoadingState label="正在比较签名相关性…" />
          ) : correlationState === 'error' ? (
            <div className="space-y-2">
              <p role="alert" className="text-sm text-destructive">
                {correlationError ?? '签名相关性查询失败，请稍后重试。'}
              </p>
              <p className="text-xs text-muted-foreground">
                可以点击“重试”再次查询，或关闭窗口后稍后再试。
              </p>
            </div>
          ) : correlationDetails.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              所选账号之间没有共同的签名特征。
            </p>
          ) : (
            <div className="max-h-80 overflow-y-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-40 pl-4">签名属性</TableHead>
                    <TableHead className="pr-4">签名值</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {correlationDetails.map((detail, index) => (
                    <TableRow key={`${detail.property}-${index}`}>
                      <TableCell className="pl-4 font-mono text-xs">
                        {detail.property}
                      </TableCell>
                      <TableCell className="pr-4 font-mono text-xs break-all">
                        {detail.value}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              关闭
            </Button>
            {correlationState === 'error' ? (
              <Button onClick={() => void runCorrelation()} disabled={selectedCount < 2}>
                重试
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
