'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { LoaderCircleIcon, SearchIcon, SearchXIcon } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState } from '@/components/data-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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
import type { SignatureAccount } from '@/lib/data/types'
import { describeAdminError } from '@/lib/errors'
import { formatDateTime, truncateDid } from '@/lib/format'

const MAX_SIGNATURE_VALUES = 10
const MAX_SIGNATURE_LENGTH = 2048
const SIGNATURE_PAGE_SIZE = 50
const VISIBLE_SIGNATURES = 6

const SEARCH_HINT =
  '签名检索结果由审核服务实时计算，可能不包含全部匹配账号；可继续加载更多结果。'

type SearchStatus = 'idle' | 'loading' | 'ready' | 'error'

export function parseSignatureValues(input: string): string[] {
  const seen = new Set<string>()
  const values: string[] = []
  for (const line of input.split(/\r?\n/)) {
    const value = line.trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    values.push(value)
  }
  return values
}

function validateSignatureValues(values: string[]): string | null {
  if (values.length === 0) return '请输入至少一个签名值。'
  if (values.length > MAX_SIGNATURE_VALUES) {
    return `一次最多检索 ${MAX_SIGNATURE_VALUES} 个签名值，请精简后重试。`
  }
  if (values.some((value) => value.length > MAX_SIGNATURE_LENGTH)) {
    return `单个签名值不能超过 ${MAX_SIGNATURE_LENGTH} 个字符。`
  }
  return null
}

function appendAccounts(
  current: SignatureAccount[],
  incoming: SignatureAccount[],
): SignatureAccount[] {
  const seen = new Set(current.map((account) => account.did))
  return [...current, ...incoming.filter((account) => !seen.has(account.did))]
}

export function SignatureSearchPanel() {
  const provider = useDataProvider()

  const [input, setInput] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<SignatureAccount[]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [appliedValues, setAppliedValues] = useState<string[] | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
  const requestSequence = useRef(0)

  useEffect(
    () => () => {
      requestSequence.current += 1
    },
    [],
  )

  async function runSearch(values: string[]) {
    const requestId = requestSequence.current + 1
    requestSequence.current = requestId
    setStatus('loading')
    setError(null)
    setLoadMoreError(null)
    setAppliedValues(values)
    setAccounts([])
    setCursor(undefined)
    setLoadingMore(false)

    try {
      const result = await provider.searchSignatureAccounts({
        values,
        limit: SIGNATURE_PAGE_SIZE,
      })
      if (requestSequence.current !== requestId) return
      setAccounts(result.accounts)
      setCursor(result.cursor)
      setStatus('ready')
    } catch (caught) {
      if (requestSequence.current !== requestId) return
      setError(describeAdminError(caught))
      setStatus('error')
    }
  }

  async function loadMore() {
    if (!cursor || !appliedValues || loadingMore) return
    const requestId = requestSequence.current
    setLoadingMore(true)
    setLoadMoreError(null)

    try {
      const result = await provider.searchSignatureAccounts({
        values: appliedValues,
        cursor,
        limit: SIGNATURE_PAGE_SIZE,
      })
      if (requestSequence.current !== requestId) return
      setAccounts((current) => appendAccounts(current, result.accounts))
      setCursor(result.cursor)
    } catch (caught) {
      if (requestSequence.current !== requestId) return
      setLoadMoreError(describeAdminError(caught))
    } finally {
      if (requestSequence.current === requestId) setLoadingMore(false)
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = parseSignatureValues(input)
    const validation = validateSignatureValues(values)
    if (validation) {
      setFormError(validation)
      return
    }
    setFormError(null)
    void runSearch(values)
  }

  const searching = status === 'loading'

  return (
    <Card className="gap-0 py-0">
      <form className="space-y-3 border-b p-4" onSubmit={submitSearch}>
        <div className="space-y-2">
          <label htmlFor="signature-search-values" className="text-sm font-medium">
            威胁签名值
          </label>
          <Textarea
            id="signature-search-values"
            aria-label="威胁签名值"
            placeholder="每行一个签名值，例如邮箱、域名或链接。最多 10 个。"
            value={input}
            onChange={(event) => {
              setInput(event.target.value)
              setFormError(null)
            }}
            rows={5}
            className="font-mono text-xs"
            aria-invalid={formError ? true : undefined}
          />
          <p
            role={formError ? 'alert' : undefined}
            className={
              formError ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'
            }
          >
            {formError ?? SEARCH_HINT}
          </p>
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={searching}>
            {searching ? <LoaderCircleIcon className="animate-spin" /> : <SearchIcon />}
            开始检索
          </Button>
        </div>
      </form>

      {status === 'error' ? (
        <ErrorState
          title="签名检索失败"
          message={error ?? '操作失败，请稍后重试。'}
          onRetry={() => {
            if (appliedValues) void runSearch(appliedValues)
          }}
        />
      ) : status === 'loading' ? (
        <LoadingState label="正在按威胁签名检索账号…" />
      ) : status === 'idle' ? (
        <p className="px-4 py-10 text-center text-xs text-muted-foreground">
          输入签名值并开始检索后，匹配账号将在此处显示。
        </p>
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={SearchXIcon}
          title="未找到匹配账号"
          message="审核服务未返回使用该签名值的账号。可以调整签名值后重试。"
        />
      ) : (
        <>
          <Table aria-busy={loadingMore}>
            <TableHeader>
              <TableRow>
                <TableHead>账号</TableHead>
                <TableHead>账号标识</TableHead>
                <TableHead>威胁签名</TableHead>
                <TableHead>索引时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((account) => {
                const signatures = account.threatSignatures ?? []
                const visible = signatures.slice(0, VISIBLE_SIGNATURES)
                const hiddenCount = signatures.length - visible.length
                return (
                  <TableRow key={account.did}>
                    <TableCell>
                      <p className="text-sm font-medium">{account.handle}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {account.deactivatedAt ? (
                          <Badge variant="destructive">已停用</Badge>
                        ) : null}
                        {account.invitesDisabled ? (
                          <Badge variant="outline">邀请已暂停</Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span
                        className="font-mono text-xs text-muted-foreground"
                        title={account.did}
                      >
                        {truncateDid(account.did, 22, 8)}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <div className="flex max-w-md flex-wrap gap-1.5">
                        {visible.map((signature) => (
                          <Badge
                            key={`${signature.property}:${signature.value}`}
                            variant="secondary"
                            className="max-w-72 truncate font-mono text-[11px]"
                            title={`${signature.property}: ${signature.value}`}
                          >
                            {signature.property}: {signature.value}
                          </Badge>
                        ))}
                        {hiddenCount > 0 ? (
                          <span className="self-center text-xs text-muted-foreground">
                            另有 {hiddenCount} 条
                          </span>
                        ) : null}
                        {signatures.length === 0 ? (
                          <span className="text-xs text-muted-foreground">
                            未返回签名详情
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDateTime(account.indexedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/directory/${encodeURIComponent(account.did)}`}>
                          查看账号
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>

          {loadMoreError ? (
            <p role="alert" className="border-t px-4 py-2 text-xs text-destructive">
              加载更多失败：{loadMoreError}
            </p>
          ) : null}

          <div className="flex flex-col gap-2 border-t px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>
              已加载 {accounts.length} 个账号
              {cursor ? '，可继续加载' : '，已加载全部'}
            </span>
            {cursor ? (
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2"
                onClick={() => void loadMore()}
                disabled={loadingMore}
              >
                {loadingMore ? <LoaderCircleIcon className="animate-spin" /> : null}
                加载更多
              </Button>
            ) : null}
          </div>
        </>
      )}
    </Card>
  )
}
