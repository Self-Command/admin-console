import type { Metadata } from 'next'
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
import { formatDateTime, formatNumber, truncateDid } from '@/lib/format'
import { auditActionLabel, auditResultLabels } from '@/lib/audit'
import {
  previewAuditEvents,
  previewIndexer,
  previewRoles,
  previewStats,
  roleLabels,
  type RoleName,
} from '@/lib/preview-data'

export const metadata: Metadata = {
  title: '总览',
}

export default function DashboardPage() {
  const roleCounts = previewRoles.reduce<Record<RoleName, number>>(
    (counts, binding) => {
      counts[binding.role] += 1
      return counts
    },
    { admin: 0, operator: 0, viewer: 0 },
  )

  const stats = [
    {
      label: '账号目录',
      value: formatNumber(previewStats.accounts),
      note: `活跃 ${formatNumber(previewStats.activeAccounts)} · 样例快照`,
      icon: BookUserIcon,
    },
    {
      label: '角色绑定',
      value: String(previewRoles.length),
      note: `管理员 ${roleCounts.admin} · 运营 ${roleCounts.operator} · 只读 ${roleCounts.viewer}`,
      icon: ShieldCheckIcon,
    },
    {
      label: '今日审计',
      value: String(previewStats.auditsToday),
      note: '成功 16 · 失败 2',
      icon: ScrollTextIcon,
    },
    {
      label: '索引延迟',
      value: previewStats.indexerLag,
      note: '游标持续前进',
      icon: ActivityIcon,
    },
  ]

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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <Card key={stat.label} className="py-5">
              <CardContent className="flex items-start justify-between gap-4 px-5">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">{stat.label}</p>
                  <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
                    {stat.value}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{stat.note}</p>
                </div>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-4" />
                </span>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle>账号索引器</CardTitle>
              <CardDescription>回填与增量订阅状态</CardDescription>
            </div>
            <Badge variant="success">
              <CheckCircle2Icon />
              回填完成
            </Badge>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">游标</p>
                <p className="mt-1 font-mono text-sm">{previewIndexer.cursor}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">最近事件</p>
                <p className="mt-1">{formatDateTime(previewIndexer.lastEventAt)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">最近索引</p>
                <p className="mt-1">{formatDateTime(previewIndexer.lastIndexedAt)}</p>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">回填进度</span>
                <span className="tabular-nums">100%</span>
              </div>
              <div className="mt-2 h-2 w-full rounded-full bg-muted">
                <div className="h-full w-full rounded-full bg-success" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              订阅 com.atproto.sync.subscribeRepos，仅处理 #identity 与 #account 事件。
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>角色分布</CardTitle>
            <CardDescription>按当前角色绑定统计</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {(Object.keys(roleLabels) as RoleName[]).map((role) => {
              const count = roleCounts[role]
              const percent = previewRoles.length
                ? Math.round((count / previewRoles.length) * 100)
                : 0
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
      </div>

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
              {previewAuditEvents.slice(0, 5).map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDateTime(event.createdAt)}
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
        </CardContent>
      </Card>
    </div>
  )
}
