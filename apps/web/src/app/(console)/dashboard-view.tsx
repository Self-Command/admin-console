'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ActivityIcon,
  ArrowUpRightIcon,
  BookUserIcon,
  CheckCircle2Icon,
  ScrollTextIcon,
  ShieldCheckIcon,
} from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { EmptyState, ErrorState, LoadingState } from '@/components/data-state'
import { useAuth } from '@/components/auth/auth-provider'
import { useWorkspace } from '@/components/layout/workspace-provider'
import { DashboardTrendsCard } from '@/components/dashboard/dashboard-trends-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { hasPermission } from '@/lib/access'
import { indexerHealth, type IndexerHealth } from '@/lib/accounts'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type { AccountListResult, AuditEvent, IndexerStatus } from '@/lib/data/types'
import { describeAdminError } from '@/lib/errors'
import { formatNumber, formatTimestamp, truncateDid } from '@/lib/format'
import { auditActionLabel, auditResultLabels } from '@/lib/audit'
import { roleDescriptions, roleLabels, type RoleName } from '@/lib/roles'

const ROLE_ORDER: RoleName[] = ['admin', 'moderator', 'operator', 'viewer']
const RECENT_AUDIT_LIMIT = 5

const healthMeta: Record<IndexerHealth, { label: string; variant: 'success' | 'warning' | 'muted' }> = {
  healthy: { label: '运行正常', variant: 'success' },
  backfilling: { label: '回填中', variant: 'warning' },
  stale: { label: '可能已中断', variant: 'warning' },
  unknown: { label: '状态未知', variant: 'muted' },
}

type LoadStatus = 'loading' | 'ready' | 'error'

type DashboardData = {
  accounts: AccountListResult
  activeTotal: number
  roleCounts: Record<RoleName, number> | null
  auditToday: { total: number; denied: number } | null
  recentAudits: AuditEvent[] | null
}

function startOfToday(): string {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date.toISOString()
}

function lagText(indexer: IndexerStatus): string {
  if (!indexer.lastIndexedAt) return '未知'
  const indexedAt = new Date(indexer.lastIndexedAt).getTime()
  if (Number.isNaN(indexedAt)) return '未知'
  const seconds = Math.max(0, Math.round((Date.now() - indexedAt) / 1000))
  if (seconds < 60) return `${seconds} 秒`
  if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟`
  if (seconds < 86400) return `${Math.round(seconds / 3600)} 小时`
  return `${Math.round(seconds / 86400)} 天`
}

export function DashboardView() {
  const { identity } = useAuth()
  const { groups, dateFormat, features } = useWorkspace()
  const provider = useDataProvider()
  const canReadRoles = hasPermission(identity, 'role.read')
  const canReadAudit = hasPermission(identity, 'audit.read')

  const [data, setData] = useState<DashboardData | null>(null)
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let active = true
    setStatus('loading')
    setError(null)

    const accountsPromise = provider.listAccounts({ limit: 1 })
    const activeAccountsPromise = provider.listAccounts({ limit: 1, status: 'active' })
    const rolesPromise = canReadRoles
      ? Promise.all(ROLE_ORDER.map((role) => provider.listRoles({ limit: 1, role })))
      : Promise.resolve(null)
    const auditPromise = canReadAudit
      ? Promise.all([
          provider.listAudit({ limit: RECENT_AUDIT_LIMIT }),
          provider.listAudit({ limit: 1, since: startOfToday() }),
          provider.listAudit({ limit: 1, since: startOfToday(), result: 'denied' }),
        ])
      : Promise.resolve(null)

    Promise.all([accountsPromise, activeAccountsPromise, rolesPromise, auditPromise])
      .then(([accounts, activeAccounts, roles, audit]) => {
        if (!active) return
        setData({
          accounts,
          activeTotal: activeAccounts.total,
          roleCounts: roles
            ? ROLE_ORDER.reduce<Record<RoleName, number>>(
                (counts, role, index) => {
                  counts[role] = roles[index]?.total ?? 0
                  return counts
                },
                { admin: 0, moderator: 0, operator: 0, viewer: 0 },
              )
            : null,
          auditToday: audit ? { total: audit[1].total, denied: audit[2].total } : null,
          recentAudits: audit ? audit[0].events : null,
        })
        setStatus('ready')
      })
      .catch((cause: unknown) => {
        if (!active) return
        setError(describeAdminError(cause))
        setStatus('error')
      })

    return () => {
      active = false
    }
  }, [provider, canReadRoles, canReadAudit, reloadToken])

  const indexer = data?.accounts.indexer
  const health = indexerHealth(indexer ?? null)

  return (
    <div className="space-y-6">
      <PageHeader
        title="总览"
        description="账号目录、角色与索引器状态一屏掌握。"
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/directory">
              查看账号目录
              <ArrowUpRightIcon />
            </Link>
          </Button>
        }
      />

      {status === 'loading' ? <LoadingState label="正在加载总览数据" /> : null}
      {status === 'error' ? (
        <ErrorState
          title="总览加载失败"
          message={error ?? '后台服务暂时不可用，请稍后重试。'}
          onRetry={() => setReloadToken((value) => value + 1)}
        />
      ) : null}

      {status === 'ready' && data && indexer ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="py-5">
              <CardContent className="flex items-start justify-between gap-4 px-5">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">账号目录</p>
                  <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
                    {formatNumber(data.accounts.total)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    活跃 {formatNumber(data.activeTotal)} · 只读索引
                  </p>
                </div>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <BookUserIcon className="size-4" />
                </span>
              </CardContent>
            </Card>

            {data.roleCounts ? (
              <Card className="py-5">
                <CardContent className="flex items-start justify-between gap-4 px-5">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">角色绑定</p>
                    <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
                      {formatNumber(
                        data.roleCounts.admin +
                          data.roleCounts.moderator +
                          data.roleCounts.operator +
                          data.roleCounts.viewer,
                      )}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      管理员 {data.roleCounts.admin} · 审核员 {data.roleCounts.moderator} · 运营{' '}
                      {data.roleCounts.operator} · 只读 {data.roleCounts.viewer}
                    </p>
                  </div>
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <ShieldCheckIcon className="size-4" />
                  </span>
                </CardContent>
              </Card>
            ) : (
              <Card className="py-5">
                <CardContent className="flex items-start justify-between gap-4 px-5">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">我的角色</p>
                    <p className="mt-2 text-2xl font-semibold tracking-tight">
                      {identity?.role ? roleLabels[identity.role] : '无角色'}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {identity?.role ? roleDescriptions[identity.role] : '请联系管理员开通权限'}
                    </p>
                  </div>
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <ShieldCheckIcon className="size-4" />
                  </span>
                </CardContent>
              </Card>
            )}

            {data.auditToday ? (
              <Card className="py-5">
                <CardContent className="flex items-start justify-between gap-4 px-5">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">今日审计</p>
                    <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
                      {formatNumber(data.auditToday.total)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      拒绝 {formatNumber(data.auditToday.denied)} · 自 00:00 起
                    </p>
                  </div>
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <ScrollTextIcon className="size-4" />
                  </span>
                </CardContent>
              </Card>
            ) : null}

            <Card className="py-5">
              <CardContent className="flex items-start justify-between gap-4 px-5">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">索引延迟</p>
                  <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
                    {lagText(indexer)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{healthMeta[health].label}</p>
                </div>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <ActivityIcon className="size-4" />
                </span>
              </CardContent>
            </Card>
          </div>

          {features.dashboardTrends ? <DashboardTrendsCard /> : null}

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div className="space-y-1">
                  <CardTitle>账号索引器</CardTitle>
                  <CardDescription>回填与增量订阅状态</CardDescription>
                </div>
                <Badge variant={healthMeta[health].variant}>
                  {health === 'healthy' ? <CheckCircle2Icon /> : null}
                  {healthMeta[health].label}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 text-sm sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-muted-foreground">游标</p>
                    <p className="mt-1 font-mono text-sm">{indexer.cursor ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">最近事件</p>
                    <p className="mt-1">{formatTimestamp(indexer.lastEventAt, dateFormat)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">最近索引</p>
                    <p className="mt-1">{formatTimestamp(indexer.lastIndexedAt, dateFormat)}</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {indexer.backfillComplete
                    ? '初始回填已完成，持续订阅 com.atproto.sync.subscribeRepos 的 #identity 与 #account 事件。'
                    : '初始回填尚未完成，账号目录可能不完整；索引器会从当前游标继续。'}
                </p>
              </CardContent>
            </Card>

            {data.roleCounts ? (
              <Card>
                <CardHeader>
                  <CardTitle>角色分布</CardTitle>
                  <CardDescription>按当前角色绑定统计</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {ROLE_ORDER.map((role) => {
                    const count = data.roleCounts?.[role] ?? 0
                    const total =
                      data.roleCounts
                        ? data.roleCounts.admin +
                          data.roleCounts.moderator +
                          data.roleCounts.operator +
                          data.roleCounts.viewer
                        : 0
                    const percent = total ? Math.round((count / total) * 100) : 0
                    return (
                      <div key={role} className="space-y-1.5">
                        <div className="flex items-center justify-between text-sm">
                          <span>{roleLabels[role]}</span>
                          <span className="text-muted-foreground tabular-nums">{count}</span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </CardContent>
                <CardFooter>
                  <Button asChild variant="ghost" size="sm" className="px-0">
                    <Link href="/roles">
                      管理角色
                      <ArrowUpRightIcon />
                    </Link>
                  </Button>
                </CardFooter>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>访问范围</CardTitle>
                  <CardDescription>当前账号可进入的模块</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2.5">
                  {groups
                    .flatMap((group) => group.items)
                    .filter((item) => item.href !== '/')
                    .map((item) => {
                      const Icon = item.icon
                      return (
                        <Link
                          key={item.id}
                          href={item.href}
                          className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted/60"
                        >
                          <Icon className="size-4 text-muted-foreground" />
                          {item.title}
                        </Link>
                      )
                    })}
                  <p className="pt-1 text-xs leading-relaxed text-muted-foreground">
                    写操作与服务端角色校验由后台服务强制执行，界面隐藏不是权限边界。
                  </p>
                </CardContent>
              </Card>
            )}
          </div>

          {data.recentAudits ? (
            <Card>
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div className="space-y-1">
                  <CardTitle>最近审计事件</CardTitle>
                  <CardDescription>角色变更与访问记录，最新在前</CardDescription>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/audit">查看全部</Link>
                </Button>
              </CardHeader>
              <CardContent>
                {data.recentAudits.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>时间</TableHead>
                        <TableHead>操作者</TableHead>
                        <TableHead>动作</TableHead>
                        <TableHead>对象</TableHead>
                        <TableHead className="text-right">结果</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.recentAudits.map((event) => (
                        <TableRow key={event.id}>
                          <TableCell className="text-xs text-muted-foreground">
                            {formatTimestamp(event.createdAt, dateFormat)}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {truncateDid(event.actor, 18, 6)}
                          </TableCell>
                          <TableCell>{auditActionLabel(event.action)}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {event.target ? truncateDid(event.target, 18, 6) : '—'}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge
                              variant={
                                event.result === 'success'
                                  ? 'success'
                                  : event.result === 'denied'
                                    ? 'warning'
                                    : 'destructive'
                              }
                            >
                              {auditResultLabels[event.result]}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <EmptyState
                    icon={ScrollTextIcon}
                    title="暂无审计事件"
                    message="角色变更与越权访问记录会显示在这里。"
                  />
                )}
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
