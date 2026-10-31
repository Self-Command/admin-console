'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowUpRightIcon,
  ChartColumnIcon,
  CircleCheckIcon,
  ClockIcon,
  DownloadIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  ShuffleIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/page-header'
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
import { useAuth } from '@/components/auth/auth-provider'
import { hasPermission } from '@/lib/access'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type {
  AccountOverview,
  AnalyticsDay,
  ModerationAnalyticsResult,
} from '@/lib/data/types'
import { accountStatusLabels, accountStatusVariants } from '@/lib/accounts'
import { AdminApiError } from '@/lib/api/admin-client'
import { downloadTextFile } from '@/lib/download'
import { describeAdminError } from '@/lib/errors'
import { formatNumber } from '@/lib/format'

type LoadState = 'loading' | 'ready' | 'error'
type RangeDays = 7 | 30 | 90
type RandomState = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

const RANGES: Array<{ value: RangeDays; label: string }> = [
  { value: 7, label: '近 7 天' },
  { value: 30, label: '近 30 天' },
  { value: 90, label: '近 90 天' },
]

function percent(value: number | undefined): string {
  if (value === undefined) return '—'
  return `${value}%`
}

function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint: string
}) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

const DAY_COLUMNS: Array<{
  key: keyof Pick<
    AnalyticsDay,
    'inboundCount' | 'pendingCount' | 'closedCount' | 'escalatedCount' | 'actionedCount' | 'acknowledgedCount'
  >
  label: string
}> = [
  { key: 'inboundCount', label: '新增举报' },
  { key: 'pendingCount', label: '待处理' },
  { key: 'closedCount', label: '已结案' },
  { key: 'escalatedCount', label: '升级处理' },
  { key: 'actionedCount', label: '已处置' },
  { key: 'acknowledgedCount', label: '已确认' },
]

export default function ModerationAnalyticsPage() {
  const provider = useDataProvider()
  const { identity } = useAuth()
  const canRead = hasPermission(identity, 'analytics.read')

  const [range, setRange] = useState<RangeDays>(7)
  const [state, setState] = useState<LoadState>('loading')
  const [analytics, setAnalytics] = useState<ModerationAnalyticsResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [exporting, setExporting] = useState(false)

  const [randomState, setRandomState] = useState<RandomState>('idle')
  const [randomAccount, setRandomAccount] = useState<AccountOverview | null>(null)
  const [randomError, setRandomError] = useState<string | null>(null)

  useEffect(() => {
    if (!canRead) return
    let active = true
    setState('loading')
    setError(null)
    provider
      .getModerationAnalytics(range)
      .then((result) => {
        if (!active) return
        setAnalytics(result)
        setState('ready')
      })
      .catch((cause: unknown) => {
        if (!active) return
        setError(describeAdminError(cause))
        setState('error')
      })
    return () => {
      active = false
    }
  }, [provider, canRead, range, reloadToken])

  async function handleExport() {
    if (exporting) return
    setExporting(true)
    try {
      const result = await provider.exportAnalytics(range)
      downloadTextFile(result.filename, result.content, result.contentType)
      toast.success(`已导出最近 ${range} 天的审核统计数据。`)
    } catch (cause) {
      toast.error(describeAdminError(cause))
    } finally {
      setExporting(false)
    }
  }

  async function pickRandomAccount() {
    if (randomState === 'loading') return
    setRandomState('loading')
    setRandomError(null)
    try {
      const overview = await provider.getRandomAccount()
      setRandomAccount(overview)
      setRandomState('ready')
    } catch (cause) {
      if (cause instanceof AdminApiError && cause.kind === 'not_found') {
        setRandomAccount(null)
        setRandomState('empty')
        return
      }
      setRandomError(describeAdminError(cause))
      setRandomState('error')
    }
  }

  if (!canRead) {
    return (
      <div className="space-y-5">
        <PageHeader title="审核分析" description="查看举报处理量、结案情况与趋势。" />
        <Card className="py-0">
          <EmptyState
            icon={ChartColumnIcon}
            title="没有查看审核分析的权限"
            message="当前账号无法查看审核分析数据。如需使用该页面，请联系管理员开通“查看审核分析”权限。"
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="审核分析"
        description="查看举报处理量、结案情况与趋势，并从账号目录中随机抽取账号进行人工复核。"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border bg-card p-1">
              {RANGES.map((item) => (
                <Button
                  key={item.value}
                  size="sm"
                  variant={range === item.value ? 'secondary' : 'ghost'}
                  onClick={() => setRange(item.value)}
                >
                  {item.label}
                </Button>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleExport()}
              disabled={exporting || state !== 'ready'}
              title="导出当前时间范围的每日审核数据（CSV）"
            >
              {exporting ? <LoaderCircleIcon className="animate-spin" /> : <DownloadIcon />}
              导出数据
            </Button>
          </div>
        }
      />

      {state === 'loading' ? (
        <Card className="py-0">
          <LoadingState label="正在汇总审核数据…" />
        </Card>
      ) : state === 'error' || !analytics ? (
        <Card className="py-0">
          <ErrorState
            title="审核分析加载失败"
            message={error ?? '操作失败，请稍后重试。'}
            onRetry={() => setReloadToken((value) => value + 1)}
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              label="待处理举报"
              value={formatNumber(analytics.summary.pendingCount)}
              hint="当前仍处于待处理状态的举报"
            />
            <SummaryCard
              label="已结案举报"
              value={formatNumber(analytics.summary.closedCount)}
              hint="已完成处理并结案的举报"
            />
            <SummaryCard
              label="升级处理"
              value={formatNumber(analytics.summary.escalatedCount)}
              hint="已升级至更高处理级别的举报"
            />
            <SummaryCard
              label="新增举报"
              value={formatNumber(analytics.summary.inboundCount)}
              hint="统计周期内新增的举报"
            />
            <SummaryCard
              label="已处置"
              value={formatNumber(analytics.summary.actionedCount)}
              hint="统计周期内执行处置的举报"
            />
            <SummaryCard
              label="已确认"
              value={formatNumber(analytics.summary.acknowledgedCount)}
              hint="统计周期内确认已查看的举报"
            />
            <SummaryCard
              label="按时结案率"
              value={percent(analytics.summary.closureTargetMetRate)}
              hint="在目标时间内完成结案的举报占比"
            />
            <SummaryCard
              label="超时未结案"
              value={formatNumber(analytics.summary.closureTargetOverdueCount ?? 0)}
              hint="超过目标时间仍未结案的举报"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ChartColumnIcon className="size-4 text-muted-foreground" />
                每日审核数据
              </CardTitle>
              <CardDescription>
                按处理时区统计最近 {range} 天的举报数量与处理进度。
              </CardDescription>
            </CardHeader>
            <CardContent>
              {analytics.days.length === 0 ? (
                <p className="rounded-md bg-muted px-3 py-6 text-center text-xs text-muted-foreground">
                  所选时间范围内没有审核数据。举报产生后，统计数据会随审核操作更新。
                </p>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>日期</TableHead>
                        {DAY_COLUMNS.map((column) => (
                          <TableHead key={column.key}>{column.label}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {analytics.days.map((day) => (
                        <TableRow key={day.day}>
                          <TableCell className="text-xs">{day.day}</TableCell>
                          {DAY_COLUMNS.map((column) => (
                            <TableCell key={column.key} className="tabular-nums">
                              {formatNumber(day[column.key] ?? 0)}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShuffleIcon className="size-4 text-muted-foreground" />
            随机抽查
          </CardTitle>
          <CardDescription>
            从账号目录中随机抽取一个账号，用于人工复核账号状态与近期处置记录。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            size="sm"
            onClick={() => void pickRandomAccount()}
            disabled={randomState === 'loading'}
          >
            {randomState === 'loading' ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              <ShuffleIcon />
            )}
            随机抽查账号
          </Button>

          {randomState === 'empty' ? (
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              账号目录中暂无可抽查的账号，请等待目录同步完成后再试。
            </p>
          ) : null}

          {randomState === 'error' ? (
            <p role="alert" className="text-xs text-destructive">
              {randomError ?? '随机抽查失败，请稍后重试。'}
            </p>
          ) : null}

          {randomState === 'ready' && randomAccount ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-3">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={accountStatusVariants[randomAccount.status ?? 'unknown']}>
                    {accountStatusLabels[randomAccount.status ?? 'unknown']}
                  </Badge>
                  <span className="text-sm font-medium">
                    {randomAccount.handle ?? randomAccount.did}
                  </span>
                </div>
                {randomAccount.handle ? (
                  <p className="font-mono text-xs break-all text-muted-foreground">
                    {randomAccount.did}
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void pickRandomAccount()}
                >
                  <RefreshCwIcon className="size-3.5" />
                  换一个
                </Button>
                <Button size="sm" asChild>
                  <Link href={`/directory/${encodeURIComponent(randomAccount.did)}`}>
                    查看账号详情
                    <ArrowUpRightIcon className="size-3.5" />
                  </Link>
                </Button>
              </div>
            </div>
          ) : null}

          {randomState === 'idle' ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <CircleCheckIcon className="size-3.5" />
              抽查不会改变账号状态，仅用于人工复核。
            </p>
          ) : null}

          {randomState === 'loading' ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <ClockIcon className="size-3.5" />
              正在抽取账号…
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
