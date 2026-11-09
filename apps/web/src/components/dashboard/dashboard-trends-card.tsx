'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChartColumnIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useWorkspace } from '@/components/layout/workspace-provider'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type { DailyMetric, DashboardDays, DashboardSeriesResult } from '@/lib/data/types'
import { describeAdminError } from '@/lib/errors'
import { formatNumber, formatTimestamp } from '@/lib/format'

type TrendMetric = 'accountsTotal' | 'accountsNew' | 'accountsActive24h' | 'auditTotal' | 'auditDenied'

const METRICS: Array<{ key: TrendMetric; label: string; hint: string }> = [
  { key: 'accountsTotal', label: '账号总量', hint: '截至当日目录中的账号总数' },
  { key: 'accountsNew', label: '新增账号', hint: '当日首次进入目录的账号数' },
  { key: 'accountsActive24h', label: '活跃账号', hint: '最近 24 小时内有账号事件的账号数' },
  { key: 'auditTotal', label: '后台操作', hint: '当日后台操作审计事件数' },
  { key: 'auditDenied', label: '拒绝请求', hint: '当日因权限或封锁被拒绝的请求数' },
]

const RANGES: Array<{ value: DashboardDays; label: string }> = [
  { value: 7, label: '近 7 天' },
  { value: 30, label: '近 30 天' },
  { value: 90, label: '近 90 天' },
]

type LoadState = 'loading' | 'ready' | 'error'

function shortDay(day: string): string {
  const [, month, date] = day.split('-')
  if (!month || !date) return day
  return `${Number(month)}月${Number(date)}日`
}

function TrendChart({
  points,
  metric,
  label,
}: {
  points: DailyMetric[]
  metric: TrendMetric
  label: string
}) {
  const width = 640
  const height = 180
  const padding = { top: 12, right: 12, bottom: 24, left: 12 }
  const innerWidth = width - padding.left - padding.right
  const innerHeight = height - padding.top - padding.bottom
  const values = points.map((point) => point[metric])
  const first = points.at(0)
  const last = points.at(-1)
  const max = Math.max(1, ...values)
  const step = points.length > 1 ? innerWidth / (points.length - 1) : 0
  const coords = values.map((value, index) => {
    const x = padding.left + step * index
    const y = padding.top + innerHeight - (value / max) * innerHeight
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const area = `${padding.left},${padding.top + innerHeight} ${coords.join(' ')} ${padding.left + innerWidth},${padding.top + innerHeight}`

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-44 w-full"
      role="img"
      aria-label={`${label}趋势，共 ${points.length} 个自然日，最高 ${max}`}
    >
      <line
        x1={padding.left}
        y1={padding.top + innerHeight}
        x2={padding.left + innerWidth}
        y2={padding.top + innerHeight}
        className="stroke-border"
        strokeWidth="1"
      />
      <polygon points={area} className="fill-primary/10" />
      <polyline
        points={coords.join(' ')}
        className="fill-none stroke-primary"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {first && last ? (
        <>
          <text
            x={padding.left}
            y={height - 6}
            className="fill-muted-foreground text-[11px]"
          >
            {shortDay(first.day)}
          </text>
          <text
            x={padding.left + innerWidth}
            y={height - 6}
            textAnchor="end"
            className="fill-muted-foreground text-[11px]"
          >
            {shortDay(last.day)}
          </text>
        </>
      ) : null}
    </svg>
  )
}

export function DashboardTrendsCard() {
  const provider = useDataProvider()
  const { dateFormat } = useWorkspace()
  const [days, setDays] = useState<DashboardDays>(30)
  const [metric, setMetric] = useState<TrendMetric>('accountsTotal')
  const [series, setSeries] = useState<DashboardSeriesResult | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let active = true
    setState('loading')
    setError(null)
    provider
      .getDashboardSeries(days)
      .then((result) => {
        if (!active) return
        setSeries(result)
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
  }, [provider, days, reloadToken])

  const metricMeta =
    METRICS.find((item) => item.key === metric) ?? {
      key: 'accountsTotal',
      label: '账号总量',
      hint: '截至当日目录中的账号总数',
    }
  const points = series?.points ?? []
  const latest = points.at(-1)
  const current = latest ? latest[metric] : 0
  const earliest = points[0]
  const change = earliest && latest ? latest[metric] - earliest[metric] : 0
  const average = useMemo(() => {
    if (points.length === 0) return 0
    return Math.round(points.reduce((sum, point) => sum + point[metric], 0) / points.length)
  }, [points, metric])

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <ChartColumnIcon className="size-4 text-muted-foreground" />
            运营趋势
          </CardTitle>
          <CardDescription>
            按自然日汇总，每日生成一次快照；最近一天的数据会随当天请求更新。
          </CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-1 rounded-lg border p-1">
          {RANGES.map((range) => (
            <Button
              key={range.value}
              size="sm"
              variant={days === range.value ? 'default' : 'ghost'}
              className="h-7 px-2.5"
              onClick={() => setDays(range.value)}
              aria-pressed={days === range.value}
            >
              {range.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {state === 'loading' ? (
          <p className="py-10 text-center text-sm text-muted-foreground">正在加载趋势数据…</p>
        ) : state === 'error' ? (
          <div className="space-y-2 py-6 text-center">
            <p role="alert" className="text-sm text-destructive">
              {error ?? '趋势数据加载失败，请稍后重试。'}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReloadToken((value) => value + 1)}
            >
              重试
            </Button>
          </div>
        ) : (
          <>
            {series && !series.indexerEnabled ? (
              <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-relaxed">
                账号目录同步当前未启用，账号相关指标显示为 0；后台操作与拒绝请求仍按实际记录统计。
              </p>
            ) : null}

            <div className="flex flex-wrap gap-1.5">
              {METRICS.map((item) => (
                <Button
                  key={item.key}
                  size="sm"
                  variant={metric === item.key ? 'secondary' : 'ghost'}
                  className="h-7 px-2.5"
                  onClick={() => setMetric(item.key)}
                  aria-pressed={metric === item.key}
                  title={item.hint}
                >
                  {item.label}
                </Button>
              ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">最近一日</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
                  {formatNumber(current)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {latest ? shortDay(latest.day) : '暂无数据'}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">区间变化</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
                  {change > 0 ? `+${formatNumber(change)}` : formatNumber(change)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">相对区间首日</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">日均</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
                  {formatNumber(average)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">按区间内全部自然日计算</p>
              </div>
            </div>

            {points.length === 0 ? (
              <p className="rounded-lg border border-dashed px-3 py-10 text-center text-sm text-muted-foreground">
                暂无可用的每日指标。系统会在启动后补算最近 30 天的快照，请稍后刷新。
              </p>
            ) : (
              <TrendChart points={points} metric={metric} label={metricMeta.label} />
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
              <span>统计口径：{metricMeta.hint}；按自然日汇总，不插值补齐缺失日期。</span>
              <span>
                数据截止：
                {series?.generatedAt ? formatTimestamp(series.generatedAt, dateFormat) : '—'}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}