'use client'

import { useEffect, useRef, useState } from 'react'
import {
  BellIcon,
  InboxIcon,
  LoaderCircleIcon,
  Settings2Icon,
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
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type {
  InboxNotification,
  InboxNotificationPreferences,
  InboxNotificationTarget,
  InboxSection,
  InboxUnreadCounts,
} from '@/lib/data/types'
import { describeAdminError } from '@/lib/errors'
import { formatDateTime, formatNumber, truncateDid } from '@/lib/format'

const PAGE_SIZE = 50

type SectionFilter = 'all' | InboxSection

const SECTION_LABELS: Record<InboxSection, string> = {
  reports: '举报',
  subjects: '处置对象',
  accountStatus: '账号状态',
}

const SECTION_OPTIONS: Array<{ value: SectionFilter; label: string }> = [
  { value: 'all', label: '全部分区' },
  { value: 'reports', label: '举报' },
  { value: 'subjects', label: '处置对象' },
  { value: 'accountStatus', label: '账号状态' },
]

const REASON_LABELS: Record<string, string> = {
  reportResolved: '举报已处理',
  reportReopened: '举报重新打开',
  actionTaken: '已执行处置',
  actionReversed: '处置已撤销',
  appealResolved: '申诉已处理',
  standingChanged: '账号状态变更',
}

function reasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? '其他通知'
}

function sectionLabel(section?: InboxSection): string {
  return section ? SECTION_LABELS[section] : '未标注'
}

function targetSummary(target: InboxNotificationTarget): string {
  switch (target.type) {
    case 'report':
      return target.reportId !== undefined ? `举报 #${target.reportId}` : '举报'
    case 'subject':
      return target.subject ? `对象 ${truncateDid(target.subject)}` : '处置对象'
    case 'standing':
      return target.previousStanding && target.standing
        ? `账号状态由 ${target.previousStanding} 变为 ${target.standing}`
        : '账号状态变更'
    default:
      return '未知对象'
  }
}

function isSectionFilter(value: string): value is SectionFilter {
  return (
    value === 'all' ||
    value === 'reports' ||
    value === 'subjects' ||
    value === 'accountStatus'
  )
}

type SummaryData = {
  counts: InboxUnreadCounts
  preferences: InboxNotificationPreferences
}

type LoadState = 'loading' | 'ready' | 'error'

export function AccountNotificationsPanel({ did }: { did: string }) {
  const provider = useDataProvider()

  const [summaryState, setSummaryState] = useState<LoadState>('loading')
  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [summaryReloadToken, setSummaryReloadToken] = useState(0)

  const [section, setSection] = useState<SectionFilter>('all')
  const [unreadOnly, setUnreadOnly] = useState(false)

  const [listState, setListState] = useState<LoadState>('loading')
  const [notifications, setNotifications] = useState<InboxNotification[]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [listError, setListError] = useState<string | null>(null)
  const [listReloadToken, setListReloadToken] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
  const listVersionRef = useRef(0)

  useEffect(() => {
    let active = true
    setSummaryState('loading')
    setSummaryError(null)

    Promise.all([
      provider.getInboxUnreadCounts(did),
      provider.getInboxNotificationPreferences(did),
    ])
      .then(([counts, preferences]) => {
        if (!active) return
        setSummary({ counts, preferences })
        setSummaryState('ready')
      })
      .catch((cause: unknown) => {
        if (!active) return
        setSummaryError(describeAdminError(cause))
        setSummaryState('error')
      })

    return () => {
      active = false
    }
  }, [provider, did, summaryReloadToken])

  useEffect(() => {
    let active = true
    listVersionRef.current += 1
    setListState('loading')
    setListError(null)
    setLoadMoreError(null)
    setLoadingMore(false)
    setNotifications([])
    setCursor(undefined)

    provider
      .listInboxNotifications({
        did,
        limit: PAGE_SIZE,
        ...(section === 'all' ? {} : { section }),
        ...(unreadOnly ? { unreadOnly: true } : {}),
      })
      .then((result) => {
        if (!active) return
        setNotifications(result.notifications)
        setCursor(result.cursor)
        setListState('ready')
      })
      .catch((cause: unknown) => {
        if (!active) return
        setListError(describeAdminError(cause))
        setListState('error')
      })

    return () => {
      active = false
      listVersionRef.current += 1
    }
  }, [provider, did, section, unreadOnly, listReloadToken])

  async function loadMore() {
    if (!cursor || loadingMore) return
    const version = listVersionRef.current
    setLoadingMore(true)
    setLoadMoreError(null)
    try {
      const result = await provider.listInboxNotifications({
        did,
        limit: PAGE_SIZE,
        cursor,
        ...(section === 'all' ? {} : { section }),
        ...(unreadOnly ? { unreadOnly: true } : {}),
      })
      if (version !== listVersionRef.current) return
      setNotifications((current) => [...current, ...result.notifications])
      setCursor(result.cursor)
    } catch (cause: unknown) {
      if (version !== listVersionRef.current) return
      setLoadMoreError(describeAdminError(cause))
    } finally {
      if (version === listVersionRef.current) {
        setLoadingMore(false)
      }
    }
  }

  const counts = summary?.counts
  const preferences = summary?.preferences

  return (
    <section aria-label="用户通知" className="space-y-4">
      {summaryState === 'loading' ? (
        <Card>
          <LoadingState label="正在加载未读数量与通知偏好…" />
        </Card>
      ) : summaryState === 'error' ? (
        <Card>
          <ErrorState
            title="未读数量与通知偏好加载失败"
            message={summaryError ?? '未读数量与通知偏好加载失败，请稍后重试。'}
            onRetry={() => setSummaryReloadToken((value) => value + 1)}
          />
        </Card>
      ) : counts && preferences ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  <BellIcon className="size-4 text-muted-foreground" />
                  未读数量
                </CardTitle>
                <CardDescription>该账号在审核服务中的未读通知统计。</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-semibold tracking-tight tabular-nums">
                  {formatNumber(counts.total)}
                </span>
                <span className="text-sm text-muted-foreground">条未读通知</span>
              </div>
              <dl className="grid grid-cols-3 gap-3 border-t pt-4">
                <div className="space-y-1">
                  <dt className="text-xs text-muted-foreground">举报</dt>
                  <dd className="text-lg font-medium tabular-nums">
                    {formatNumber(counts.reports ?? 0)}
                  </dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-xs text-muted-foreground">处置对象</dt>
                  <dd className="text-lg font-medium tabular-nums">
                    {formatNumber(counts.subjects ?? 0)}
                  </dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-xs text-muted-foreground">账号状态</dt>
                  <dd className="text-lg font-medium tabular-nums">
                    {formatNumber(counts.accountStatus ?? 0)}
                  </dd>
                </div>
              </dl>
              <p className="border-t pt-3 text-xs leading-relaxed text-muted-foreground">
                未读数量由审核服务统计。
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings2Icon className="size-4 text-muted-foreground" />
                通知偏好
              </CardTitle>
              <CardDescription>该账号在审核服务中的通知接收设置。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-3">
                <li className="flex items-center justify-between gap-4">
                  <span className="text-sm">举报通知</span>
                  <Badge variant={preferences.reports ? 'success' : 'muted'}>
                    {preferences.reports ? '已开启' : '已关闭'}
                  </Badge>
                </li>
                <li className="flex items-center justify-between gap-4">
                  <span className="text-sm">账号通知</span>
                  <Badge variant={preferences.account ? 'success' : 'muted'}>
                    {preferences.account ? '已开启' : '已关闭'}
                  </Badge>
                </li>
                <li className="flex items-center justify-between gap-4">
                  <span className="text-sm">标签通知</span>
                  <Badge variant={preferences.labels ? 'success' : 'muted'}>
                    {preferences.labels ? '已开启' : '已关闭'}
                  </Badge>
                </li>
              </ul>
              <p className="border-t pt-3 text-xs leading-relaxed text-muted-foreground">
                通知偏好由审核服务维护，后台仅展示，不提供修改。
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <InboxIcon className="size-4 text-muted-foreground" />
            通知列表
          </CardTitle>
          <CardDescription>
            只读展示该账号收到的审核通知，可按分节与未读状态筛选。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-1">
              <label
                htmlFor="account-notifications-section"
                className="text-xs font-medium text-muted-foreground"
              >
                通知分区
              </label>
              <Select
                id="account-notifications-section"
                aria-label="通知分区"
                className="w-40"
                value={section}
                onChange={(event) => {
                  const value = event.target.value
                  if (isSectionFilter(value)) setSection(value)
                }}
              >
                {SECTION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-center gap-2 pb-1.5">
              <Switch
                id="account-notifications-unread-only"
                aria-label="仅看未读"
                checked={unreadOnly}
                onCheckedChange={setUnreadOnly}
              />
              <span className="text-sm">仅看未读</span>
            </div>
          </div>

          {listState === 'loading' ? (
            <LoadingState label="正在加载通知…" />
          ) : listState === 'error' ? (
            <ErrorState
              title="通知列表加载失败"
              message={listError ?? '通知列表加载失败，请稍后重试。'}
              onRetry={() => setListReloadToken((value) => value + 1)}
            />
          ) : notifications.length === 0 ? (
            <EmptyState
              icon={InboxIcon}
              title="暂无通知"
              message="该账号当前没有符合条件的通知。可以调整筛选后重试。"
            />
          ) : (
            <div className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>原因</TableHead>
                    <TableHead>分区</TableHead>
                    <TableHead>对象</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {notifications.map((notification) => (
                    <TableRow key={notification.id}>
                      <TableCell className="font-medium whitespace-normal">
                        {reasonLabel(notification.reason)}
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-normal">
                        {sectionLabel(notification.section)}
                      </TableCell>
                      <TableCell className="max-w-[28rem] whitespace-normal">
                        {targetSummary(notification.target)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={notification.isRead ? 'muted' : 'warning'}>
                          {notification.isRead ? '已读' : '未读'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDateTime(notification.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
                <p className="text-xs text-muted-foreground">
                  已加载 {formatNumber(notifications.length)} 条通知。
                </p>
                <div className="flex flex-col items-end gap-1">
                  {loadMoreError ? (
                    <p role="alert" className="text-xs text-destructive">
                      {loadMoreError}
                    </p>
                  ) : null}
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
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
