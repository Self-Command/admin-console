'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import {
  DownloadIcon,
  ImageIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
  SearchIcon,
  ShieldAlertIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/page-header'
import { EmptyState, ErrorState, LoadingState } from '@/components/data-state'
import { ContentDetailDialog } from '@/components/content/content-detail-dialog'
import {
  ModerationActionDialog,
  type ModerationActionRequest,
} from '@/components/moderation/moderation-action-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/components/auth/auth-provider'
import { useWorkspace } from '@/components/layout/workspace-provider'
import { hasPermission } from '@/lib/access'
import { AdminApiError } from '@/lib/api/admin-client'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type { ContentView, ImageResult, ModerationAction } from '@/lib/data/types'
import { downloadTextFile } from '@/lib/download'
import { describeAdminError } from '@/lib/errors'
import { formatDateTime, formatNumber, truncateDid } from '@/lib/format'

type SearchStatus = 'idle' | 'loading' | 'ready' | 'error'
type ImageStatus = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'

function isNotConfigured(error: unknown): boolean {
  return error instanceof AdminApiError && error.status === 503 && error.code === 'NotConfigured'
}

export default function ContentSearchPage() {
  const provider = useDataProvider()
  const { pageSize } = useWorkspace()
  const { identity } = useAuth()
  const canRead = hasPermission(identity, 'content.read')
  const canWrite = hasPermission(identity, 'moderation.write')

  const initialUri =
    typeof window === 'undefined'
      ? ''
      : (new URLSearchParams(window.location.search).get('uri') ?? '').trim()

  const [qInput, setQInput] = useState('')
  const [authorInput, setAuthorInput] = useState('')
  const [sort, setSort] = useState<'latest' | 'top'>('latest')
  const [appliedQuery, setAppliedQuery] = useState<string | null>(null)
  const [searchToken, setSearchToken] = useState(0)
  const [queryError, setQueryError] = useState<string | null>(null)

  const [results, setResults] = useState<ContentView[]>([])
  const [moderationAvailable, setModerationAvailable] = useState(true)
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [cursor, setCursor] = useState<string | undefined>()
  const [loadingMore, setLoadingMore] = useState(false)
  const [exporting, setExporting] = useState(false)

  const [detailUri, setDetailUri] = useState<string | null>(initialUri || null)

  const [selected, setSelected] = useState<string[]>([])
  const [batchAction, setBatchAction] = useState<ModerationAction>('takedown')
  const [batchRequest, setBatchRequest] = useState<ModerationActionRequest | null>(null)

  const [imageQuery, setImageQuery] = useState('')
  const [imageApplied, setImageApplied] = useState<string | null>(null)
  const [imageToken, setImageToken] = useState(0)
  const [imageStatus, setImageStatus] = useState<ImageStatus>('idle')
  const [imageError, setImageError] = useState<string | null>(null)
  const [images, setImages] = useState<ImageResult[]>([])
  const [imageTotal, setImageTotal] = useState(0)
  const [imageCursor, setImageCursor] = useState<string | undefined>()
  const [imageLoadingMore, setImageLoadingMore] = useState(false)
  const [imageQueryError, setImageQueryError] = useState<string | null>(null)

  useEffect(() => {
    if (!initialUri || !canRead) return
    setDetailUri(initialUri)
  }, [initialUri, canRead])

  useEffect(() => {
    if (!appliedQuery) return
    let active = true
    setStatus('loading')
    setError(null)
    provider
      .searchContent({
        q: appliedQuery,
        limit: pageSize,
        author: authorInput.trim() || undefined,
        sort,
      })
      .then((result) => {
        if (!active) return
        setResults(result.content)
        setCursor(result.cursor)
        setModerationAvailable(result.moderationAvailable)
        setStatus('ready')
      })
      .catch((cause: unknown) => {
        if (!active) return
        setError(
          isNotConfigured(cause)
            ? '内容检索依赖的服务尚未配置，暂时无法查询内容。请联系部署管理员完成配置。'
            : describeAdminError(cause),
        )
        setStatus('error')
      })
    return () => {
      active = false
    }
  }, [provider, appliedQuery, authorInput, sort, pageSize, searchToken])

  useEffect(() => {
    if (!imageApplied) return
    let active = true
    setImageStatus('loading')
    setImageError(null)
    provider
      .searchImages({ q: imageApplied, limit: pageSize })
      .then((result) => {
        if (!active) return
        setImages(result.results)
        setImageCursor(result.cursor)
        setImageTotal(result.total)
        setImageStatus('ready')
      })
      .catch((cause: unknown) => {
        if (!active) return
        if (isNotConfigured(cause)) {
          setImageStatus('unavailable')
          return
        }
        setImageError(describeAdminError(cause))
        setImageStatus('error')
      })
    return () => {
      active = false
    }
  }, [provider, imageApplied, pageSize, imageToken])

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = qInput.trim()
    if (!value) {
      setQueryError('请输入检索关键词。')
      return
    }
    setQueryError(null)
    setResults([])
    setCursor(undefined)
    setSelected([])
    setAppliedQuery(value)
    setSearchToken((token) => token + 1)
  }

  function resetSearch() {
    setQInput('')
    setAuthorInput('')
    setSort('latest')
    setAppliedQuery(null)
    setQueryError(null)
    setResults([])
    setCursor(undefined)
    setSelected([])
    setStatus('idle')
  }

  async function loadMore() {
    if (!appliedQuery || !cursor || loadingMore) return
    setLoadingMore(true)
    try {
      const result = await provider.searchContent({
        q: appliedQuery,
        limit: pageSize,
        cursor,
        author: authorInput.trim() || undefined,
        sort,
      })
      setResults((current) => [...current, ...result.content])
      setCursor(result.cursor)
      setModerationAvailable(result.moderationAvailable)
    } catch (cause) {
      setError(describeAdminError(cause))
    } finally {
      setLoadingMore(false)
    }
  }

  async function handleExport() {
    if (!appliedQuery || exporting) return
    setExporting(true)
    try {
      const result = await provider.exportContent({
        q: appliedQuery,
        ...(authorInput.trim() ? { author: authorInput.trim() } : {}),
        sort,
      })
      downloadTextFile(result.filename, result.content, result.contentType)
      if (result.truncated) {
        toast.warning(
          `已导出 ${formatNumber(result.rows)} 条内容，达到 ${formatNumber(result.limit)} 行上限并截断。请缩小筛选范围后重新导出。`,
        )
      } else {
        toast.success(`已导出 ${formatNumber(result.rows)} 条内容。`)
      }
    } catch (cause) {
      toast.error(describeAdminError(cause))
    } finally {
      setExporting(false)
    }
  }

  function submitImageSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = imageQuery.trim()
    if (!value) {
      setImageQueryError('请输入图片检索关键词。')
      return
    }
    setImageQueryError(null)
    setImages([])
    setImageCursor(undefined)
    setImageApplied(value)
    setImageToken((token) => token + 1)
  }

  function toggleSelected(uri: string) {
    setSelected((current) =>
      current.includes(uri) ? current.filter((value) => value !== uri) : [...current, uri],
    )
  }

  const allSelected =
    results.length > 0 && results.every((item) => selected.includes(item.uri))

  function toggleAllSelected() {
    setSelected(allSelected ? [] : results.map((item) => item.uri))
  }

  async function loadMoreImages() {
    if (!imageApplied || !imageCursor || imageLoadingMore) return
    setImageLoadingMore(true)
    try {
      const result = await provider.searchImages({
        q: imageApplied,
        limit: pageSize,
        cursor: imageCursor,
      })
      setImages((current) => [...current, ...result.results])
      setImageCursor(result.cursor)
      setImageTotal(result.total)
    } catch (cause) {
      if (isNotConfigured(cause)) {
        setImageStatus('unavailable')
      } else {
        setImageError(describeAdminError(cause))
      }
    } finally {
      setImageLoadingMore(false)
    }
  }

  if (!canRead) {
    return (
      <div className="space-y-5">
        <PageHeader title="内容检索" description="检索公开内容并查看审核状态。" />
        <Card className="py-0">
          <EmptyState
            icon={SearchIcon}
            title="没有查看内容的权限"
            message="如需检索内容与查看审核状态，请联系管理员开通内容查看权限。"
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="内容检索"
        description="检索社区公开内容，核对审核状态并直接发起处置；图片检索依赖部署时的图片服务配置。"
      />

      <Tabs defaultValue="content">
        <TabsList>
          <TabsTrigger value="content">
            <SearchIcon />
            内容检索
          </TabsTrigger>
          <TabsTrigger value="images">
            <ImageIcon />
            图片检索
          </TabsTrigger>
        </TabsList>

        <TabsContent value="content" className="space-y-4">
          <Card className="gap-0 py-0">
            <form className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-start" onSubmit={submitSearch}>
              <div className="flex-1 space-y-1">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={qInput}
                    onChange={(event) => {
                      setQInput(event.target.value)
                      setQueryError(null)
                    }}
                    placeholder="检索关键词"
                    aria-label="检索关键词"
                    aria-invalid={queryError ? true : undefined}
                    className="sm:max-w-md"
                  />
                  <Input
                    value={authorInput}
                    onChange={(event) => setAuthorInput(event.target.value)}
                    placeholder="作者账号标识（可选）"
                    aria-label="作者账号标识"
                    className="font-mono text-xs sm:max-w-64"
                  />
                  <Select
                    value={sort}
                    onChange={(event) => setSort(event.target.value as 'latest' | 'top')}
                    className="shrink-0 sm:w-32"
                    aria-label="排序方式"
                  >
                    <option value="latest">最新发布</option>
                    <option value="top">互动最多</option>
                  </Select>
                  <Button type="submit" disabled={status === 'loading'}>
                    {status === 'loading' ? <LoaderCircleIcon className="animate-spin" /> : <SearchIcon />}
                    检索
                  </Button>
                </div>
                <p
                  className={
                    queryError
                      ? 'text-[11px] text-destructive'
                      : 'text-[11px] text-muted-foreground'
                  }
                >
                  {queryError ?? '按关键词检索公开内容；可按作者账号标识缩小范围。'}
                </p>
              </div>
              <div className="flex items-center gap-2 lg:ml-auto">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  onClick={() => void handleExport()}
                  disabled={!appliedQuery || exporting}
                  title="导出当前检索结果为 CSV 文件"
                >
                  {exporting ? (
                    <LoaderCircleIcon className="size-3.5 animate-spin" />
                  ) : (
                    <DownloadIcon className="size-3.5" />
                  )}
                  导出结果
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  onClick={resetSearch}
                  disabled={status === 'idle' && qInput === '' && authorInput === ''}
                >
                  <RotateCcwIcon className="size-3.5" />
                  重置
                </Button>
              </div>
            </form>

            {canWrite ? (
              <div className="space-y-1 border-b bg-muted/30 px-4 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    已选择 {selected.length} 条内容
                  </span>
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    <Select
                      value={batchAction}
                      onChange={(event) =>
                        setBatchAction(event.target.value as ModerationAction)
                      }
                      className="w-36"
                      aria-label="批量处置动作"
                    >
                      <option value="takedown">批量下架</option>
                      <option value="mute">批量禁言</option>
                      <option value="label">批量添加标签</option>
                    </Select>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={selected.length === 0}
                      onClick={() =>
                        setBatchRequest({
                          subjects: selected,
                          action: batchAction,
                          subjectType: 'record',
                        })
                      }
                    >
                      批量处置
                    </Button>
                  </div>
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  批量下架、禁言与打标属于高风险动作，提交后需要另一位管理员审批才会执行。
                </p>
              </div>
            ) : null}

            {!moderationAvailable && status === 'ready' ? (
              <p className="flex items-start gap-2 border-b bg-warning/10 px-4 py-2 text-xs leading-relaxed">
                <ShieldAlertIcon className="mt-0.5 size-3.5 shrink-0" />
                审核服务尚未配置，当前只能查看公开内容，无法执行下架等处置。请联系部署管理员完成审核服务配置。
              </p>
            ) : null}

            {status === 'idle' ? (
              <EmptyState
                icon={SearchIcon}
                title="输入关键词开始检索"
                message="检索结果来自社区公开接口，展示内容正文、作者与审核状态。"
              />
            ) : status === 'error' ? (
              <ErrorState
                title="内容检索失败"
                message={error ?? '操作失败，请稍后重试。'}
                onRetry={() => {
                  if (appliedQuery) setSearchToken((token) => token + 1)
                }}
              />
            ) : status === 'loading' && results.length === 0 ? (
              <LoadingState label="正在检索内容…" />
            ) : results.length === 0 ? (
              <EmptyState
                icon={SearchIcon}
                title="没有匹配的内容"
                message="没有检索到符合条件的内容。可以更换关键词或调整作者与排序后再试。"
                action={
                  <Button variant="outline" size="sm" onClick={resetSearch}>
                    清空检索条件
                  </Button>
                }
              />
            ) : (
              <Table aria-busy={status === 'loading'}>
                <TableHeader>
                  <TableRow>
                    {canWrite ? (
                      <TableHead className="w-10">
                        <Checkbox
                          checked={allSelected}
                          onCheckedChange={() => toggleAllSelected()}
                          aria-label="选择全部内容"
                        />
                      </TableHead>
                    ) : null}
                    <TableHead>内容摘要</TableHead>
                    <TableHead className="w-40">作者</TableHead>
                    <TableHead className="w-40">索引时间</TableHead>
                    <TableHead className="w-40">审核状态</TableHead>
                    <TableHead className="w-32 text-right">互动</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((item) => (
                    <TableRow key={item.uri}>
                      {canWrite ? (
                        <TableCell>
                          <Checkbox
                            checked={selected.includes(item.uri)}
                            onCheckedChange={() => toggleSelected(item.uri)}
                            aria-label={`选择内容 ${item.uri}`}
                          />
                        </TableCell>
                      ) : null}
                      <TableCell>
                        <p className="max-w-xl truncate text-sm">{item.text ?? '—'}</p>
                        <p className="mt-0.5 max-w-xl truncate font-mono text-[11px] text-muted-foreground">
                          {item.uri}
                        </p>
                      </TableCell>
                      <TableCell className="text-xs">
                        {item.authorHandle ?? truncateDid(item.author)}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                        {formatDateTime(item.indexedAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          {item.hidden ? (
                            <Badge variant="destructive">已隐藏</Badge>
                          ) : (
                            <Badge variant="success">可见</Badge>
                          )}
                          {(item.labels ?? []).slice(0, 2).map((label) => (
                            <Badge key={label} variant="secondary">
                              {label}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                        赞 {formatNumber(item.likeCount ?? 0)} · 转{' '}
                        {formatNumber(item.repostCount ?? 0)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => setDetailUri(item.uri)}>
                          详情
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {status === 'ready' && results.length > 0 ? (
              <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
                <span>已显示 {results.length} 条结果</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => void loadMore()}
                  disabled={!cursor || loadingMore}
                >
                  {loadingMore ? <LoaderCircleIcon className="animate-spin" /> : null}
                  {cursor ? '加载更多' : '已加载全部'}
                </Button>
              </div>
            ) : null}
          </Card>
        </TabsContent>

        <TabsContent value="images" className="space-y-4">
          <Card className="gap-0 py-0">
            <form
              className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-start"
              onSubmit={submitImageSearch}
            >
              <div className="flex-1 space-y-1">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={imageQuery}
                    onChange={(event) => {
                      setImageQuery(event.target.value)
                      setImageQueryError(null)
                    }}
                    placeholder="图片检索关键词"
                    aria-label="图片检索关键词"
                    aria-invalid={imageQueryError ? true : undefined}
                    className="sm:max-w-md"
                  />
                  <Button type="submit" disabled={imageStatus === 'loading'}>
                    {imageStatus === 'loading' ? (
                      <LoaderCircleIcon className="animate-spin" />
                    ) : (
                      <ImageIcon />
                    )}
                    检索图片
                  </Button>
                </div>
                <p
                  className={
                    imageQueryError
                      ? 'text-[11px] text-destructive'
                      : 'text-[11px] text-muted-foreground'
                  }
                >
                  {imageQueryError ?? '图片检索使用部署时配置的图片服务，仅用于审核排查。'}
                </p>
              </div>
            </form>

            {imageStatus === 'idle' ? (
              <EmptyState
                icon={ImageIcon}
                title="输入关键词检索图片"
                message="图片检索用于定位疑似违规图片，结果包含来源内容与匹配度。"
              />
            ) : imageStatus === 'unavailable' ? (
              <EmptyState
                icon={ImageIcon}
                title="图片检索服务尚未配置"
                message="当前部署没有启用图片检索。若要使用该功能，请联系部署管理员配置图片检索服务地址与访问凭据。"
              />
            ) : imageStatus === 'error' ? (
              <ErrorState
                title="图片检索失败"
                message={imageError ?? '操作失败，请稍后重试。'}
                onRetry={() => {
                  if (imageApplied) setImageToken((token) => token + 1)
                }}
              />
            ) : imageStatus === 'loading' && images.length === 0 ? (
              <LoadingState label="正在检索图片…" />
            ) : images.length === 0 ? (
              <EmptyState
                icon={ImageIcon}
                title="没有匹配的图片"
                message="没有检索到符合条件的图片，可以更换关键词后再试。"
              />
            ) : (
              <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
                {images.map((image) => (
                  <div key={image.imageUrl} className="overflow-hidden rounded-lg border">
                    <a
                      href={image.imageUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="block bg-muted"
                    >
                      <img
                        src={image.thumbnailUrl ?? image.imageUrl}
                        alt={image.description ?? '检索到的图片'}
                        loading="lazy"
                        className="h-40 w-full object-cover"
                      />
                    </a>
                    <div className="space-y-1 p-3">
                      <p className="line-clamp-2 text-xs">
                        {image.description ?? '无图片说明'}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {image.author ? truncateDid(image.author) : '来源未知'}
                        {image.score !== undefined
                          ? ` · 匹配度 ${image.score.toFixed(2)}`
                          : ''}
                      </p>
                      {image.postUri ? (
                        <Button
                          variant="link"
                          size="sm"
                          className="h-auto px-0 text-xs"
                          onClick={() => setDetailUri(image.postUri ?? null)}
                        >
                          查看来源内容
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {imageStatus === 'ready' && images.length > 0 ? (
              <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
                <span>
                  已显示 {images.length} / {formatNumber(Math.max(imageTotal, images.length))} 张
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => void loadMoreImages()}
                  disabled={!imageCursor || imageLoadingMore}
                >
                  {imageLoadingMore ? <LoaderCircleIcon className="animate-spin" /> : null}
                  {imageCursor ? '加载更多' : '已加载全部'}
                </Button>
              </div>
            ) : null}
          </Card>
        </TabsContent>
      </Tabs>

      <ContentDetailDialog
        uri={detailUri}
        onClose={() => setDetailUri(null)}
        onChanged={() => {
          if (appliedQuery) setSearchToken((token) => token + 1)
        }}
      />

      <ModerationActionDialog
        request={batchRequest}
        onClose={() => setBatchRequest(null)}
        onCompleted={() => {
          setSelected([])
          if (appliedQuery) setSearchToken((token) => token + 1)
        }}
      />

      <p className="text-xs text-muted-foreground">
        内容检索结果来自社区公开接口；处置状态与审核记录来自审核服务。
        如需核对账号层面的审核信息，可前往{' '}
        <Link href="/moderation/events" className="text-primary hover:underline">
          处置记录
        </Link>
        。
      </p>
    </div>
  )
}
