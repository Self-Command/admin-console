'use client'

import { useEffect, useRef, useState } from 'react'
import {
  LoaderCircleIcon,
  MessageSquareIcon,
  RefreshCwIcon,
} from 'lucide-react'
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
import { Select } from '@/components/ui/select'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type { AccountPost, AccountPostsFilter } from '@/lib/data/types'
import { describeAdminError } from '@/lib/errors'
import { formatDateTime, formatNumber } from '@/lib/format'

const PAGE_LIMIT = 50

const FILTER_OPTIONS: Array<{ value: AccountPostsFilter; label: string }> = [
  { value: 'posts', label: '全部帖子' },
  { value: 'withReplies', label: '包含回复' },
  { value: 'withMedia', label: '包含媒体' },
]

type BadgeVariant = 'success' | 'muted' | 'warning' | 'outline'

const VISIBILITY_META: Record<
  AccountPost['visibility'],
  { label: string; variant: BadgeVariant }
> = {
  available: { label: '可见', variant: 'success' },
  notFound: { label: '内容不存在', variant: 'muted' },
  blocked: { label: '已屏蔽', variant: 'warning' },
  unavailable: { label: '不可用', variant: 'outline' },
}

export function AccountPostsPanel({ did }: { did: string }) {
  const provider = useDataProvider()
  const [filter, setFilter] = useState<AccountPostsFilter>('posts')
  const [posts, setPosts] = useState<AccountPost[]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const requestId = useRef(0)

  useEffect(() => {
    let active = true
    const currentRequest = ++requestId.current
    setStatus('loading')
    setError(null)
    setLoadMoreError(null)
    setLoadingMore(false)
    setPosts([])
    setCursor(undefined)

    provider
      .getAccountPosts({ did, filter, limit: PAGE_LIMIT })
      .then((result) => {
        if (!active || requestId.current !== currentRequest) return
        setPosts(result.posts)
        setCursor(result.cursor)
        setStatus('ready')
      })
      .catch((cause: unknown) => {
        if (!active || requestId.current !== currentRequest) return
        setError(describeAdminError(cause))
        setStatus('error')
      })

    return () => {
      active = false
    }
  }, [provider, did, filter, reloadToken])

  async function loadMore() {
    if (!cursor || loadingMore) return
    const currentRequest = requestId.current
    setLoadingMore(true)
    setLoadMoreError(null)

    try {
      const result = await provider.getAccountPosts({
        did,
        filter,
        cursor,
        limit: PAGE_LIMIT,
      })
      if (requestId.current !== currentRequest) return
      setPosts((current) => [...current, ...result.posts])
      setCursor(result.cursor)
    } catch (cause) {
      if (requestId.current !== currentRequest) return
      setLoadMoreError(describeAdminError(cause))
    } finally {
      if (requestId.current === currentRequest) {
        setLoadingMore(false)
      }
    }
  }

  function reload() {
    setReloadToken((value) => value + 1)
  }

  const loading = status === 'loading'

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <MessageSquareIcon className="size-4 text-muted-foreground" />
            账号帖子
          </CardTitle>
          <CardDescription>
            帖子内容来自账号服务，仅展示文本摘要与可用状态。
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={reload}
          disabled={loading}
        >
          {loading ? (
            <LoaderCircleIcon className="animate-spin" />
          ) : (
            <RefreshCwIcon />
          )}
          刷新
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <label htmlFor="account-posts-filter" className="text-sm font-medium">
              帖子筛选
            </label>
            <Select
              id="account-posts-filter"
              aria-label="帖子筛选"
              value={filter}
              onChange={(event) =>
                setFilter(event.target.value as AccountPostsFilter)
              }
              className="w-40"
            >
              {FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">按页加载，每页最多 {PAGE_LIMIT} 条。</p>
        </div>

        {status === 'error' ? (
          <ErrorState
            title="帖子加载失败"
            message={error ?? '帖子加载失败，请稍后重试。'}
            onRetry={reload}
          />
        ) : loading ? (
          <LoadingState label="正在加载帖子…" />
        ) : posts.length === 0 ? (
          <EmptyState
            icon={MessageSquareIcon}
            title="暂无帖子"
            message="该账号目前没有可展示的公开帖子。可以调整帖子筛选后再试。"
          />
        ) : (
          <div className="space-y-3">
            <ul className="divide-y rounded-lg border" aria-busy={loadingMore}>
              {posts.map((post) => {
                const visibility = VISIBILITY_META[post.visibility]
                return (
                  <li key={`${post.uri}:${post.cid}`} className="space-y-2 px-4 py-4">
                    <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">
                      {post.text.trim() ? post.text : '该帖子没有正文内容。'}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant={visibility.variant}>{visibility.label}</Badge>
                      <span>{formatDateTime(post.indexedAt)}</span>
                      {post.replyParentUri ? (
                        <Badge variant="outline">回复其他帖子</Badge>
                      ) : null}
                      {post.embedType ? (
                        <Badge variant="outline">包含引用内容</Badge>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>

            {loadMoreError ? (
              <p
                role="alert"
                className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                {loadMoreError}
              </p>
            ) : null}

            <div className="flex flex-col gap-2 border-t pt-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span>已加载 {formatNumber(posts.length)} 条帖子</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadMore()}
                disabled={!cursor || loadingMore}
              >
                {loadingMore ? <LoaderCircleIcon className="animate-spin" /> : null}
                {cursor ? '加载更多' : '已加载全部'}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
