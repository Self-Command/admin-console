'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  ActivityIcon,
  DatabaseIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  PauseIcon,
  PlayIcon,
  PlugZapIcon,
  RefreshCwIcon,
  RouteIcon,
  ServerIcon,
  ShieldCheckIcon,
  WifiIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/page-header'
import { ErrorState, LoadingState } from '@/components/data-state'
import { useAuth } from '@/components/auth/auth-provider'
import { useWorkspace } from '@/components/layout/workspace-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { hasPermission } from '@/lib/access'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type {
  ExternalServiceStatus,
  IndexerStatus,
  SystemComponent,
  SystemServiceStatus,
  SystemStatus,
} from '@/lib/data/types'
import { describeAdminError } from '@/lib/errors'
import { formatTimestamp } from '@/lib/format'

type LoadStatus = 'loading' | 'ready' | 'error'

const COMPONENT_LABELS = {
  ok: '正常',
  degraded: '受限',
  unavailable: '不可用',
} as const

function componentVariant(status: SystemStatus['database']['status']) {
  if (status === 'ok') return 'success' as const
  if (status === 'degraded') return 'warning' as const
  return 'destructive' as const
}

function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 60) return `${Math.max(0, Math.round(seconds))} 秒`
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days} 天 ${hours} 小时`
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`
  return `${minutes} 分钟`
}

function indexerSummary(status: IndexerStatus): string {
  if (status.enabled === false) return '索引器已停用'
  if (status.paused) return '索引器已暂停'
  if (!status.connected) return '尚未连接账号服务，正在等待重连'
  if (!status.backfillComplete) return '正在回填历史账号'
  return '运行正常，持续接收账号变更'
}

const EXTERNAL_STATUS_LABELS: Record<SystemServiceStatus, string> = {
  ok: '正常',
  degraded: '受限',
  unavailable: '不可用',
  disabled: '未启用',
  unknown: '待检查',
}

function externalVariant(status: SystemServiceStatus) {
  if (status === 'ok') return 'success' as const
  if (status === 'degraded' || status === 'unknown') return 'warning' as const
  if (status === 'disabled') return 'muted' as const
  return 'destructive' as const
}

const LABELER_STATUS_LABELS: Partial<Record<SystemServiceStatus, string>> = {
  ok: '可用',
  unavailable: '不可用',
  disabled: '未启用',
}

function labelerVariant(status: SystemServiceStatus) {
  if (status === 'ok') return 'success' as const
  if (status === 'unavailable') return 'warning' as const
  if (status === 'disabled') return 'muted' as const
  return externalVariant(status)
}

function LabelerServiceRow({
  service,
  dateFormat,
}: {
  service: ExternalServiceStatus
  dateFormat: 'date-time' | 'date'
}) {
  const detail = service.detail?.trim()
  let description: string
  let guidance: string | null = null

  if (service.status === 'ok') {
    description = detail || '标签服务连接正常。'
  } else if (service.status === 'disabled') {
    description = '尚未配置审核服务凭据，无法探测标签服务。请在系统设置中完成审核服务配置。'
  } else {
    description = detail ?? ''
    guidance = '标签服务暂时无法连接，请检查审核服务配置与网络后重试。'
  }

  return (
    <div
      data-testid="labeler-service-row"
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm"
    >
      <div>
        <p className="font-medium">{service.name || '标签服务'}</p>
        {description ? (
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
        {guidance ? (
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{guidance}</p>
        ) : null}
        <p className="mt-0.5 text-xs text-muted-foreground">
          最近检查：{formatTimestamp(service.checkedAt, dateFormat)}
        </p>
      </div>
      <Badge variant={labelerVariant(service.status)}>
        {LABELER_STATUS_LABELS[service.status] ?? EXTERNAL_STATUS_LABELS[service.status]}
      </Badge>
    </div>
  )
}

function ComponentBadge({ status }: { status: SystemStatus['database']['status'] }) {
  return <Badge variant={componentVariant(status)}>{COMPONENT_LABELS[status]}</Badge>
}

function ServiceStatusCard({
  title,
  description,
  icon,
  component,
  dateFormat,
}: {
  title: string
  description: string
  icon: ReactNode
  component: SystemComponent
  dateFormat: 'date-time' | 'date'
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">连接状态</span>
          <ComponentBadge status={component.status} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">响应延迟</span>
          <span>{typeof component.latencyMs === 'number' ? `${component.latencyMs} 毫秒` : '—'}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">检查时间</span>
          <span>{formatTimestamp(component.checkedAt, dateFormat)}</span>
        </div>
        {component.detail ? (
          <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            {component.detail}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

export default function SystemPage() {
  const { identity } = useAuth()
  const { features, dateFormat } = useWorkspace()
  const provider = useDataProvider()
  const canWrite = hasPermission(identity, 'settings.write')

  const [status, setStatus] = useState<LoadStatus>('loading')
  const [data, setData] = useState<SystemStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const [pauseOpen, setPauseOpen] = useState(false)
  const [pauseReason, setPauseReason] = useState('')
  const [mutating, setMutating] = useState(false)

  useEffect(() => {
    let active = true
    setStatus('loading')
    setError(null)
    provider
      .getSystemStatus()
      .then((result) => {
        if (!active) return
        setData(result)
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
  }, [provider, reloadToken])

  const reload = useCallback(() => setReloadToken((value) => value + 1), [])

  async function confirmPause() {
    if (mutating) return
    setMutating(true)
    try {
      const next = await provider.pauseIndexer(pauseReason.trim() || undefined)
      setData((current) => (current ? { ...current, indexer: next } : current))
      setPauseOpen(false)
      setPauseReason('')
      toast.success('账号索引器已暂停，恢复后将从当前游标继续。')
      reload()
    } catch (cause) {
      toast.error(describeAdminError(cause))
    } finally {
      setMutating(false)
    }
  }

  async function resume() {
    if (mutating) return
    setMutating(true)
    try {
      const next = await provider.resumeIndexer()
      setData((current) => (current ? { ...current, indexer: next } : current))
      toast.success('账号索引器已恢复，正在从上次游标继续同步。')
      reload()
    } catch (cause) {
      toast.error(describeAdminError(cause))
    } finally {
      setMutating(false)
    }
  }

  const indexer = data?.indexer
  const paused = indexer?.paused === true
  const indexerEnabled = indexer?.enabled !== false
  const controlsEnabled = canWrite && features.indexerControls && indexerEnabled
  const externalServices = data?.externalServices ?? []
  const labelerService = externalServices.find((service) => service.key === 'labeler')
  const otherExternalServices = externalServices.filter((service) => service.key !== 'labeler')

  return (
    <div className="space-y-5">
      <PageHeader
        title="系统状态"
        description="查看后台服务、数据库、上游服务与举报路由的实时状态，以及外部能力的配置情况；异常时会标明受影响的范围。"
        actions={
          <Button variant="outline" size="sm" onClick={reload} disabled={status === 'loading'}>
            <RefreshCwIcon className={status === 'loading' ? 'animate-spin' : undefined} />
            刷新状态
          </Button>
        }
      />

      {status === 'error' ? (
        <Card>
          <ErrorState
            title="系统状态加载失败"
            message={error ?? '操作失败，请稍后重试。'}
            onRetry={reload}
          />
        </Card>
      ) : status === 'loading' && !data ? (
        <Card>
          <LoadingState label="正在读取系统状态…" />
        </Card>
      ) : data ? (
        <>
          {paused ? (
            <div className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
              <p className="font-medium">账号索引器已暂停</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                暂停期间不会接收新的账号变更，账号目录保持最后同步的快照。恢复后从当前游标继续，不会丢失数据。
              </p>
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ServerIcon className="size-4 text-muted-foreground" />
                  服务版本
                </CardTitle>
                <CardDescription>当前后台服务的构建信息与运行时长</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">版本</span>
                  <span className="font-mono">{data.version}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">提交</span>
                  <span className="font-mono">{data.commit?.slice(0, 12) ?? '—'}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">启动时间</span>
                  <span>{formatTimestamp(data.startedAt, dateFormat)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">运行时长</span>
                  <span>{formatUptime(data.uptimeSeconds)}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DatabaseIcon className="size-4 text-muted-foreground" />
                  数据库
                </CardTitle>
                <CardDescription>后台服务与数据库之间的连接状态</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">连接状态</span>
                  <ComponentBadge status={data.database.status} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">响应延迟</span>
                  <span>{typeof data.database.latencyMs === 'number' ? `${data.database.latencyMs} 毫秒` : '—'}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">检查时间</span>
                  <span>{formatTimestamp(data.database.checkedAt, dateFormat)}</span>
                </div>
                {data.database.detail ? (
                  <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                    {data.database.detail}
                  </p>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ActivityIcon className="size-4 text-muted-foreground" />
                  数据库迁移
                </CardTitle>
                <CardDescription>已执行与待执行的数据库结构版本</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">已执行</span>
                  <span>{data.migrations.executed.length} 个版本</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">待执行</span>
                  <span>{data.migrations.pending.length} 个版本</span>
                </div>
                {data.migrations.pending.length > 0 ? (
                  <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-relaxed">
                    存在待执行的迁移，部分功能可能不可用。请联系运维人员在发布窗口执行数据库迁移。
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">数据库结构已是最新版本。</p>
                )}
              </CardContent>
            </Card>

            <ServiceStatusCard
              title="账号服务"
              description="上游账号数据服务的可达性与延迟"
              icon={<WifiIcon className="size-4 text-muted-foreground" />}
              component={data.pds}
              dateFormat={dateFormat}
            />

            <ServiceStatusCard
              title="审核服务"
              description="举报、处置与认证数据的来源服务"
              icon={<ShieldCheckIcon className="size-4 text-muted-foreground" />}
              component={data.ozone}
              dateFormat={dateFormat}
            />

            <ServiceStatusCard
              title="内容服务"
              description="内容检索与帖子浏览的查询服务"
              icon={<MessageSquareIcon className="size-4 text-muted-foreground" />}
              component={data.appview}
              dateFormat={dateFormat}
            />

            <ServiceStatusCard
              title="举报路由"
              description="将举报事件送入举报队列的守护进程"
              icon={<RouteIcon className="size-4 text-muted-foreground" />}
              component={data.ozoneDaemon}
              dateFormat={dateFormat}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PlugZapIcon className="size-4 text-muted-foreground" />
                外部能力
              </CardTitle>
              <CardDescription>
                依赖外部服务或凭据的能力及其状态；未启用的能力不影响账号管理与审核处置
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {externalServices.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无外部能力配置信息。</p>
              ) : (
                <>
                  {labelerService ? (
                    <LabelerServiceRow service={labelerService} dateFormat={dateFormat} />
                  ) : null}
                  {otherExternalServices.map((service) => (
                    <div
                      key={service.key}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm"
                    >
                      <div>
                        <p className="font-medium">{service.name}</p>
                        {service.detail ? (
                          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                            {service.detail}
                          </p>
                        ) : null}
                      </div>
                      <Badge variant={externalVariant(service.status)}>
                        {EXTERNAL_STATUS_LABELS[service.status]}
                      </Badge>
                    </div>
                  ))}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div className="space-y-1">
                <CardTitle>账号索引器</CardTitle>
                <CardDescription>{indexer ? indexerSummary(indexer) : '尚未取得索引器状态'}</CardDescription>
              </div>
              {controlsEnabled && indexer ? (
                paused ? (
                  <Button size="sm" onClick={() => void resume()} disabled={mutating}>
                    {mutating ? <LoaderCircleIcon className="animate-spin" /> : <PlayIcon />}
                    恢复同步
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPauseOpen(true)}
                    disabled={mutating}
                  >
                    <PauseIcon />
                    暂停同步
                  </Button>
                )
              ) : null}
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <p className="text-xs text-muted-foreground">连接状态</p>
                  <p className="mt-1">
                    {indexerEnabled ? (indexer?.connected ? '已连接' : '未连接') : '未启用'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">回填状态</p>
                  <p className="mt-1">
                    {indexerEnabled ? (indexer?.backfillComplete ? '已完成' : '进行中') : '未启用'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">最近事件</p>
                  <p className="mt-1">{formatTimestamp(indexer?.lastEventAt, dateFormat)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">最近写入</p>
                  <p className="mt-1">{formatTimestamp(indexer?.lastIndexedAt, dateFormat)}</p>
                </div>
              </div>
              {indexer?.paused && indexer.pausedAt ? (
                <p className="mt-4 text-xs text-muted-foreground">
                  暂停于 {formatTimestamp(indexer.pausedAt, dateFormat)}
                  {indexer.pausedBy ? `，操作者 ${indexer.pausedBy}` : ''}。
                </p>
              ) : null}
              {indexer?.enabled === false ? (
                <p className="mt-4 text-xs text-muted-foreground">
                  账号索引器当前未启用，账号目录不会接收新数据。如需启用，请联系运维人员在服务配置中开启后重启后台服务。
                </p>
              ) : null}
            </CardContent>
          </Card>
        </>
      ) : null}

      <AlertDialog
        open={pauseOpen}
        onOpenChange={(open) => {
          if (!mutating) setPauseOpen(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>暂停账号索引器？</AlertDialogTitle>
            <AlertDialogDescription>
              暂停后不再接收账号变更，账号目录将保持当前快照；恢复后从已保存的游标继续，不会丢失数据。该操作会写入审计日志。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="pause-reason">暂停原因（可选）</Label>
            <Input
              id="pause-reason"
              value={pauseReason}
              onChange={(event) => setPauseReason(event.target.value)}
              maxLength={200}
              placeholder="例如：账号服务升级维护"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutating}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void confirmPause()
              }}
              disabled={mutating}
            >
              {mutating ? <LoaderCircleIcon className="animate-spin" /> : null}
              确认暂停
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
