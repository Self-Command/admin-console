'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { LoaderCircleIcon, RefreshCwIcon, UsersIcon } from 'lucide-react'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type {
  AccountGraphKind,
  AccountListSummary,
  AccountSummary,
} from '@/lib/data/types'
import { describeAdminError } from '@/lib/errors'
import { formatDateTime, formatNumber, truncateDid } from '@/lib/format'

const PAGE_LIMIT = 50

const KINDS: AccountGraphKind[] = ['follows', 'followers', 'blocks', 'lists']

const KIND_LABELS: Record<AccountGraphKind, string> = {
  follows: '关注',
  followers: '粉丝',
  blocks: '屏蔽',
  lists: '列表',
}

const LOADING_LABELS: Record<AccountGraphKind, string> = {
  follows: '正在加载关注账号…',
  followers: '正在加载粉丝…',
  blocks: '正在加载屏蔽账号…',
  lists: '正在加载列表…',
}

const ERROR_TITLES: Record<AccountGraphKind, string> = {
  follows: '关注列表加载失败',
  followers: '粉丝列表加载失败',
  blocks: '屏蔽列表加载失败',
  lists: '列表加载失败',
}

const EMPTY_STATES: Record<AccountGraphKind, { title: string; message: string }> = {
  follows: {
    title: '暂无关注账号',
    message: '该账号目前没有公开的关注账号。',
  },
  followers: {
    title: '暂无粉丝',
    message: '该账号目前没有公开的粉丝。',
  },
  blocks: {
    title: '暂无屏蔽账号',
    message: '该账号目前没有屏蔽任何账号。',
  },
  lists: {
    title: '暂无列表',
    message: '该账号目前没有创建或加入公开列表。',
  },
}

type GraphStatus = 'idle' | 'loading' | 'ready' | 'error'

type GraphEntry = {
  status: GraphStatus
  accounts: AccountSummary[]
  lists: AccountListSummary[]
  cursor?: string
  error: string | null
  loadMoreError: string | null
  loadingMore: boolean
}

type GraphState = Record<AccountGraphKind, GraphEntry>

function createIdleEntry(): GraphEntry {
  return {
    status: 'idle',
    accounts: [],
    lists: [],
    cursor: undefined,
    error: null,
    loadMoreError: null,
    loadingMore: false,
  }
}

function createInitialState(): GraphState {
  return {
    follows: { ...createIdleEntry(), status: 'loading' },
    followers: createIdleEntry(),
    blocks: createIdleEntry(),
    lists: createIdleEntry(),
  }
}

function updateEntry(
  state: GraphState,
  kind: AccountGraphKind,
  entry: GraphEntry,
): GraphState {
  return { ...state, [kind]: entry }
}

function listPurposeLabel(purpose: string): string {
  const normalized = purpose.split('#').pop()?.toLocaleLowerCase() ?? ''
  if (normalized === 'curatelist') return '内容列表'
  if (normalized === 'modlist') return '审核列表'
  return '其他列表'
}

function RelationshipTabContent({
  kind,
  entry,
  onRetry,
  onLoadMore,
}: {
  kind: AccountGraphKind
  entry: GraphEntry
  onRetry: () => void
  onLoadMore: () => void
}) {
  if (entry.status === 'idle' || entry.status === 'loading') {
    return <LoadingState label={LOADING_LABELS[kind]} />
  }

  if (entry.status === 'error') {
    return (
      <ErrorState
        title={ERROR_TITLES[kind]}
        message={entry.error ?? '社交关系加载失败，请稍后重试。'}
        onRetry={onRetry}
      />
    )
  }

  if (kind === 'lists') {
    if (entry.lists.length === 0) {
      return (
        <EmptyState
          title={EMPTY_STATES.lists.title}
          message={EMPTY_STATES.lists.message}
        />
      )
    }

    return (
      <div className="space-y-3">
        <div className="overflow-hidden rounded-lg border">
          <Table aria-busy={entry.loadingMore}>
            <TableHeader>
              <TableRow>
                <TableHead>列表名称</TableHead>
                <TableHead className="w-28">用途</TableHead>
                <TableHead className="w-24">成员数</TableHead>
                <TableHead className="w-40">索引时间</TableHead>
                <TableHead>列表标识</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entry.lists.map((list) => (
                <TableRow key={list.uri}>
                  <TableCell className="max-w-64 whitespace-normal">
                    <p className="truncate text-sm font-medium" title={list.name}>
                      {list.name}
                    </p>
                    {list.description ? (
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {list.description}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{listPurposeLabel(list.purpose)}</Badge>
                  </TableCell>
                  <TableCell className="text-xs tabular-nums text-muted-foreground">
                    {list.listItemCount !== undefined
                      ? formatNumber(list.listItemCount)
                      : '—'}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                    {formatDateTime(list.indexedAt)}
                  </TableCell>
                  <TableCell className="max-w-56">
                    <span
                      className="block truncate font-mono text-[11px] text-muted-foreground"
                      title={list.uri}
                    >
                      {list.uri}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {entry.loadMoreError ? (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {entry.loadMoreError}
          </p>
        ) : null}

        <div className="flex flex-col gap-2 border-t pt-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>已加载 {formatNumber(entry.lists.length)} 个列表</span>
          <Button
            variant="outline"
            size="sm"
            onClick={onLoadMore}
            disabled={!entry.cursor || entry.loadingMore}
          >
            {entry.loadingMore ? <LoaderCircleIcon className="animate-spin" /> : null}
            {entry.cursor ? '加载更多' : '已加载全部'}
          </Button>
        </div>
      </div>
    )
  }

  if (entry.accounts.length === 0) {
    return (
      <EmptyState
        title={EMPTY_STATES[kind].title}
        message={EMPTY_STATES[kind].message}
      />
    )
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y rounded-lg border" aria-busy={entry.loadingMore}>
        {entry.accounts.map((account) => (
          <li
            key={account.did}
            className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="min-w-0 space-y-1">
              <p className="truncate text-sm font-medium">
                {account.displayName || account.handle}
              </p>
              <p className="truncate text-xs text-muted-foreground">@{account.handle}</p>
              <p className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
                <span className="shrink-0">账号标识：</span>
                <span className="truncate font-mono" title={account.did}>
                  {truncateDid(account.did)}
                </span>
              </p>
              {account.description ? (
                <p className="line-clamp-2 max-w-xl text-xs leading-relaxed text-muted-foreground">
                  {account.description}
                </p>
              ) : null}
            </div>
            <Button variant="outline" size="sm" className="shrink-0" asChild>
              <Link href={`/directory/${encodeURIComponent(account.did)}`}>
                查看账号
              </Link>
            </Button>
          </li>
        ))}
      </ul>

      {entry.loadMoreError ? (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {entry.loadMoreError}
        </p>
      ) : null}

      <div className="flex flex-col gap-2 border-t pt-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>已加载 {formatNumber(entry.accounts.length)} 个账号</span>
        <Button
          variant="outline"
          size="sm"
          onClick={onLoadMore}
          disabled={!entry.cursor || entry.loadingMore}
        >
          {entry.loadingMore ? <LoaderCircleIcon className="animate-spin" /> : null}
          {entry.cursor ? '加载更多' : '已加载全部'}
        </Button>
      </div>
    </div>
  )
}

export function AccountRelationshipPanel({ did }: { did: string }) {
  const provider = useDataProvider()
  const [kind, setKind] = useState<AccountGraphKind>('follows')
  const [graph, setGraph] = useState<GraphState>(createInitialState)
  const requestCounter = useRef(0)
  const latestRequest = useRef<Record<AccountGraphKind, number>>({
    follows: 0,
    followers: 0,
    blocks: 0,
    lists: 0,
  })

  const loadKind = useCallback(
    async (target: AccountGraphKind) => {
      const requestId = ++requestCounter.current
      latestRequest.current[target] = requestId
      setGraph((current) =>
        updateEntry(current, target, {
          status: 'loading',
          accounts: [],
          lists: [],
          cursor: undefined,
          error: null,
          loadMoreError: null,
          loadingMore: false,
        }),
      )

      try {
        const result = await provider.getAccountGraph({
          did,
          kind: target,
          limit: PAGE_LIMIT,
        })
        if (latestRequest.current[target] !== requestId) return
        setGraph((current) =>
          updateEntry(current, target, {
            status: 'ready',
            accounts: result.accounts ?? [],
            lists: result.lists ?? [],
            cursor: result.cursor,
            error: null,
            loadMoreError: null,
            loadingMore: false,
          }),
        )
      } catch (cause) {
        if (latestRequest.current[target] !== requestId) return
        setGraph((current) =>
          updateEntry(current, target, {
            status: 'error',
            accounts: [],
            lists: [],
            cursor: undefined,
            error: describeAdminError(cause),
            loadMoreError: null,
            loadingMore: false,
          }),
        )
      }
    },
    [did, provider],
  )

  const loadKindRef = useRef(loadKind)
  useEffect(() => {
    loadKindRef.current = loadKind
  }, [loadKind])

  useEffect(() => {
    setGraph(createInitialState())
    setKind('follows')
    void loadKindRef.current('follows')
  }, [did])

  async function loadMore(target: AccountGraphKind) {
    const entry = graph[target]
    if (entry.status !== 'ready' || !entry.cursor || entry.loadingMore) return

    const requestId = latestRequest.current[target]
    setGraph((current) =>
      updateEntry(current, target, {
        ...current[target],
        loadingMore: true,
        loadMoreError: null,
      }),
    )

    try {
      const result = await provider.getAccountGraph({
        did,
        kind: target,
        cursor: entry.cursor,
        limit: PAGE_LIMIT,
      })
      if (latestRequest.current[target] !== requestId) return
      setGraph((current) =>
        updateEntry(current, target, {
          ...current[target],
          accounts: [...current[target].accounts, ...(result.accounts ?? [])],
          lists: [...current[target].lists, ...(result.lists ?? [])],
          cursor: result.cursor,
          loadingMore: false,
          loadMoreError: null,
        }),
      )
    } catch (cause) {
      if (latestRequest.current[target] !== requestId) return
      setGraph((current) =>
        updateEntry(current, target, {
          ...current[target],
          loadingMore: false,
          loadMoreError: describeAdminError(cause),
        }),
      )
    }
  }

  function handleKindChange(value: string) {
    const next = value as AccountGraphKind
    setKind(next)
    const entry = graph[next]
    if (entry.status === 'idle' || entry.status === 'error') {
      void loadKind(next)
    }
  }

  const activeEntry = graph[kind]

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <UsersIcon className="size-4 text-muted-foreground" />
            社交关系
          </CardTitle>
          <CardDescription>
            社交关系数据来自账号服务，按页加载，可能随时间变化。
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => void loadKind(kind)}
          disabled={activeEntry.status === 'loading'}
        >
          {activeEntry.status === 'loading' ? (
            <LoaderCircleIcon className="animate-spin" />
          ) : (
            <RefreshCwIcon />
          )}
          刷新
        </Button>
      </CardHeader>
      <CardContent>
        <Tabs value={kind} onValueChange={handleKindChange}>
          <TabsList>
            {KINDS.map((value) => (
              <TabsTrigger key={value} value={value}>
                {KIND_LABELS[value]}
              </TabsTrigger>
            ))}
          </TabsList>
          {KINDS.map((value) => (
            <TabsContent key={value} value={value}>
              <RelationshipTabContent
                kind={value}
                entry={graph[value]}
                onRetry={() => void loadKind(value)}
                onLoadMore={() => void loadMore(value)}
              />
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  )
}
