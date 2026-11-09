'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  ArrowLeftIcon,
  CopyIcon,
  ExternalLinkIcon,
  SearchXIcon,
  ShieldCheckIcon,
  UserRoundIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/page-header'
import { EmptyState, ErrorState, LoadingState } from '@/components/data-state'
import { useAuth } from '@/components/auth/auth-provider'
import { useWorkspace } from '@/components/layout/workspace-provider'
import { AccountAdminPanel } from '@/components/directory/account-admin-panel'
import { AccountNotificationsPanel } from '@/components/directory/account-notifications-panel'
import { AccountOperationsCard } from '@/components/directory/account-operations-card'
import { AccountPostsPanel } from '@/components/directory/account-posts-panel'
import { AccountRelatedSignatures } from '@/components/directory/account-related-signatures'
import { AccountRelationshipPanel } from '@/components/directory/account-relationship-panel'
import { ChatModerationPanel } from '@/components/moderation/chat-moderation-panel'
import {
  AccountEventsPanel,
  AccountModerationOverviewCard,
  AccountReportsPanel,
  AccountStatusPanel,
} from '@/components/directory/account-moderation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  accountStatusLabels,
  accountStatusVariants,
  indexerHealth,
  type IndexerHealth,
} from '@/lib/accounts'
import { AdminApiError } from '@/lib/api/admin-client'
import { hasPermission } from '@/lib/access'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type { Account, IndexerStatus, RoleBinding } from '@/lib/data/types'
import { describeAdminError } from '@/lib/errors'
import { formatDateTime, truncateDid } from '@/lib/format'
import { roleLabels } from '@/lib/roles'
import type { IntegrationSettings, SettingsGetResult } from '@/lib/runtime/types'

const SETTINGS_NSID = 'com.selfcommand.admin.settings.get'

const DID_PATTERN = /^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/

const healthLabels: Record<IndexerHealth, string> = {
  healthy: '同步正常',
  backfilling: '回填中',
  stale: '同步延迟',
  unknown: '状态未知',
}

const healthVariants: Record<IndexerHealth, 'success' | 'warning' | 'outline'> = {
  healthy: 'success',
  backfilling: 'warning',
  stale: 'warning',
  unknown: 'outline',
}

type LoadState = 'loading' | 'ready' | 'not-found' | 'error'
type RoleState = 'idle' | 'loading' | 'ready' | 'none' | 'forbidden' | 'error'

function validDid(value: string): boolean {
  return value.length > 0 && value.length <= 2048 && DID_PATTERN.test(value)
}

export default function AccountDetailPage() {
  const params = useParams<{ did: string }>()
  const rawDid = Array.isArray(params.did) ? params.did[0] : params.did
  let did = rawDid ?? ''
  try {
    did = decodeURIComponent(did)
  } catch {
    // A malformed escape sequence is handled by the DID format check below.
  }
  const isValid = validDid(did)

  const provider = useDataProvider()
  const { identity, callAdmin } = useAuth()
  const { features } = useWorkspace()
  const canReadRole = hasPermission(identity, 'role.read')
  const canReadSettings = hasPermission(identity, 'settings.read')
  const canReadModeration = hasPermission(identity, 'moderation.read')
  const canReadContent = hasPermission(identity, 'content.read')
  const canWriteAccount = hasPermission(identity, 'account.write')
  const canManageAccount = hasPermission(identity, 'account.admin')
  const showOperations = features.accountOperations

  const [state, setState] = useState<LoadState>('loading')
  const [account, setAccount] = useState<Account | null>(null)
  const [indexer, setIndexer] = useState<IndexerStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const [roleState, setRoleState] = useState<RoleState>('idle')
  const [role, setRole] = useState<RoleBinding | null>(null)
  const [roleError, setRoleError] = useState<string | null>(null)

  const [integrations, setIntegrations] = useState<IntegrationSettings | null>(null)
  const [integrationsAvailable, setIntegrationsAvailable] = useState(false)

  useEffect(() => {
    if (!isValid) {
      setState('not-found')
      return
    }
    let active = true
    setState('loading')
    setError(null)

    provider
      .getAccount(did)
      .then((result) => {
        if (!active) return
        setAccount(result.account)
        setIndexer(result.indexer)
        setState('ready')
      })
      .catch((cause: unknown) => {
        if (!active) return
        if (cause instanceof AdminApiError && cause.kind === 'not_found') {
          setState('not-found')
          return
        }
        setError(describeAdminError(cause))
        setState('error')
      })

    return () => {
      active = false
    }
  }, [provider, did, isValid, reloadToken])

  useEffect(() => {
    if (!isValid || !canReadRole) return
    let active = true
    setRoleState('loading')
    setRoleError(null)

    provider
      .getRole(did)
      .then((result) => {
        if (!active) return
        setRole(result)
        setRoleState('ready')
      })
      .catch((cause: unknown) => {
        if (!active) return
        if (cause instanceof AdminApiError) {
          if (cause.kind === 'not_found') {
            setRole(null)
            setRoleState('none')
            return
          }
          if (cause.kind === 'forbidden' || cause.kind === 'unauthorized') {
            setRoleState('forbidden')
            return
          }
        }
        setRoleError(describeAdminError(cause))
        setRoleState('error')
      })

    return () => {
      active = false
    }
  }, [provider, did, isValid, canReadRole, reloadToken])

  useEffect(() => {
    if (!isValid || !canReadSettings) return
    let active = true

    callAdmin<SettingsGetResult>(SETTINGS_NSID)
      .then((result) => {
        if (!active) return
        setIntegrations(result.settings.integrations)
        setIntegrationsAvailable(true)
      })
      .catch(() => {
        if (!active) return
        setIntegrationsAvailable(false)
      })

    return () => {
      active = false
    }
  }, [callAdmin, isValid, canReadSettings, reloadToken])

  function reload() {
    setReloadToken((value) => value + 1)
  }

  async function copyDid() {
    try {
      await navigator.clipboard.writeText(did)
      toast.success('已复制账号标识')
    } catch {
      toast.error('复制失败，请手动选择账号标识复制。')
    }
  }

  const health = indexerHealth(indexer)

  const backButton = (
    <Button variant="outline" asChild>
      <Link href="/directory">
        <ArrowLeftIcon className="size-4" />
        返回账号目录
      </Link>
    </Button>
  )

  if (!isValid) {
    return (
      <div className="space-y-5">
        <PageHeader title="账号详情" description="查看账号目录中的单个账号。" actions={backButton} />
        <Card className="py-0">
          <EmptyState
            icon={SearchXIcon}
            title="账号标识格式不正确"
            message="地址中的账号标识无法识别，无法查询账号信息。请返回账号目录重新选择账号。"
            action={backButton}
          />
        </Card>
      </div>
    )
  }

  if (state === 'loading') {
    return (
      <div className="space-y-5">
        <PageHeader title="账号详情" actions={backButton} />
        <Card className="py-0">
          <LoadingState label="正在加载账号详情…" />
        </Card>
      </div>
    )
  }

  if (state === 'not-found') {
    return (
      <div className="space-y-5">
        <PageHeader title="账号详情" actions={backButton} />
        <Card className="py-0">
          <EmptyState
            icon={SearchXIcon}
            title="未找到该账号"
            message="该账号不在账号目录中，可能尚未同步或已被删除。可以稍后重试，或返回账号目录重新选择。"
            action={backButton}
          />
        </Card>
      </div>
    )
  }

  if (state === 'error' || !account) {
    return (
      <div className="space-y-5">
        <PageHeader title="账号详情" actions={backButton} />
        <Card className="py-0">
          <ErrorState
            title="账号详情加载失败"
            message={error ?? '操作失败，请稍后重试。'}
            onRetry={reload}
          />
        </Card>
      </div>
    )
  }

  const ozoneUrl = integrations?.ozoneUrl
  const pdsUrl = integrations?.pdsUrl

  return (
    <div className="space-y-5">
      <PageHeader
        title={account.handle ?? truncateDid(account.did, 18, 8)}
        description="目录数据来自账号目录索引；具备账号管理权限的管理员可以在“账号管理”页签中调整账号资料。"
        actions={backButton}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={accountStatusVariants[account.status]}>
          {accountStatusLabels[account.status]}
        </Badge>
        <Badge variant={healthVariants[health]}>{healthLabels[health]}</Badge>
        <Badge variant="outline">目录索引</Badge>
      </div>

      <Tabs defaultValue="overview" className="gap-4">
        <TabsList>
          <TabsTrigger value="overview">概览</TabsTrigger>
          {canReadModeration ? <TabsTrigger value="related">关联账号</TabsTrigger> : null}
          <TabsTrigger value="relationship">社交关系</TabsTrigger>
          {canReadContent ? <TabsTrigger value="posts">帖子</TabsTrigger> : null}
          {canReadModeration ? (
            <TabsTrigger value="notifications">用户通知</TabsTrigger>
          ) : null}
          {canReadModeration ? <TabsTrigger value="events">处置记录</TabsTrigger> : null}
          {canReadModeration ? <TabsTrigger value="reports">举报记录</TabsTrigger> : null}
          {canReadModeration ? <TabsTrigger value="status">处置对象</TabsTrigger> : null}
          <TabsTrigger value="management">账号管理</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {canReadModeration ? <AccountModerationOverviewCard did={account.did} /> : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UserRoundIcon className="size-4 text-muted-foreground" />
                  账号信息
                </CardTitle>
                <CardDescription>账号在目录中的基础信息与时间记录。</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-4 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">句柄</dt>
                    <dd className="mt-1">{account.handle ?? '未解析句柄'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">账号标识</dt>
                    <dd className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs break-all">{account.did}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={copyDid}
                      >
                        <CopyIcon className="size-3.5" />
                        复制
                      </Button>
                    </dd>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-muted-foreground">最近事件</dt>
                      <dd className="mt-1 text-xs">{formatDateTime(account.lastEventAt)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">索引时间</dt>
                      <dd className="mt-1 text-xs">{formatDateTime(account.indexedAt)}</dd>
                    </div>
                  </div>
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheckIcon className="size-4 text-muted-foreground" />
                  后台角色
                </CardTitle>
                <CardDescription>角色决定该账号可以访问的后台功能。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {!canReadRole ? (
                  <p className="text-xs text-muted-foreground">
                    当前账号没有查看角色绑定的权限。如需核实该账号的后台角色，请联系管理员。
                  </p>
                ) : roleState === 'loading' ? (
                  <p className="text-xs text-muted-foreground">正在读取角色绑定…</p>
                ) : roleState === 'error' ? (
                  <div className="space-y-2">
                    <p role="alert" className="text-xs text-destructive">
                      {roleError ?? '角色绑定加载失败，请稍后重试。'}
                    </p>
                    <Button variant="outline" size="sm" onClick={reload}>
                      重试
                    </Button>
                  </div>
                ) : roleState === 'forbidden' ? (
                  <p className="text-xs text-muted-foreground">
                    当前账号没有查看角色绑定的权限。如需核实该账号的后台角色，请联系管理员。
                  </p>
                ) : role ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Badge variant={role.role === 'admin' ? 'default' : 'secondary'}>
                        {roleLabels[role.role]}
                      </Badge>
                      <span className="text-xs text-muted-foreground">已开通后台访问</span>
                    </div>
                    <dl className="grid gap-3 text-xs sm:grid-cols-2">
                      <div>
                        <dt className="text-muted-foreground">授予人</dt>
                        <dd className="mt-1 font-mono break-all">{role.grantedBy}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">更新时间</dt>
                        <dd className="mt-1">{formatDateTime(role.updatedAt)}</dd>
                      </div>
                    </dl>
                    {role.note ? (
                      <div>
                        <p className="text-xs text-muted-foreground">备注</p>
                        <p className="mt-1 text-xs">{role.note}</p>
                      </div>
                    ) : null}
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/roles?subject=${encodeURIComponent(account.did)}`}>
                        在角色管理中查看
                      </Link>
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="font-medium">未绑定后台角色</p>
                    <p className="text-xs text-muted-foreground">
                      该账号可以登录账号服务，但在开通角色前无法使用管理后台。如需开通，请联系管理员。
                    </p>
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/roles?subject=${encodeURIComponent(account.did)}`}>
                        在角色管理中开通
                      </Link>
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>索引状态</CardTitle>
                <CardDescription>账号目录的同步进度与最近写入时间。</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-4 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">索引器状态</dt>
                    <dd className="mt-1">
                      <Badge variant={healthVariants[health]}>{healthLabels[health]}</Badge>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">回填状态</dt>
                    <dd className="mt-1 text-xs">
                      {indexer?.backfillComplete ? '已完成' : '进行中，目录数据可能不完整'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">最近索引</dt>
                    <dd className="mt-1 text-xs">{formatDateTime(indexer?.lastIndexedAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">同步游标</dt>
                    <dd className="mt-1 font-mono text-xs break-all">
                      {indexer?.cursor ?? '—'}
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          </div>

          <ChatModerationPanel />
        </TabsContent>

        {canReadModeration ? (
          <TabsContent value="related">
            <AccountRelatedSignatures did={account.did} />
          </TabsContent>
        ) : null}

        <TabsContent value="relationship">
          <AccountRelationshipPanel did={account.did} />
        </TabsContent>

        {canReadContent ? (
          <TabsContent value="posts">
            <AccountPostsPanel did={account.did} />
          </TabsContent>
        ) : null}

        {canReadModeration ? (
          <TabsContent value="notifications">
            <AccountNotificationsPanel did={account.did} />
          </TabsContent>
        ) : null}

        {canReadModeration ? (
          <TabsContent value="events">
            <AccountEventsPanel did={account.did} />
          </TabsContent>
        ) : null}

        {canReadModeration ? (
          <TabsContent value="reports">
            <AccountReportsPanel did={account.did} />
          </TabsContent>
        ) : null}

        {canReadModeration ? (
          <TabsContent value="status">
            <AccountStatusPanel did={account.did} />
          </TabsContent>
        ) : null}

        <TabsContent value="management" className="space-y-4">
          {canManageAccount ? (
            <AccountAdminPanel did={account.did} handle={account.handle} canManage />
          ) : null}

          {showOperations ? (
            <AccountOperationsCard
              did={account.did}
              handle={account.handle}
              canWrite={canWriteAccount}
            />
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>外部管理入口</CardTitle>
                <CardDescription>在审核后台或账号服务中查看该账号的运营信息。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {!canReadSettings ? (
                  <p className="text-xs text-muted-foreground">
                    外部管理入口由系统设置维护，当前账号没有查看系统设置的权限。
                  </p>
                ) : !integrationsAvailable ? (
                  <p className="text-xs text-muted-foreground">正在读取外部管理入口配置…</p>
                ) : ozoneUrl || pdsUrl ? (
                  <div className="flex flex-col gap-2">
                    {ozoneUrl ? (
                      <Button variant="outline" size="sm" className="w-fit" asChild>
                        <a
                          href={`${ozoneUrl.replace(/\/$/, '')}/search?term=${encodeURIComponent(account.did)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLinkIcon className="size-3.5" />
                          在 Ozone 审核后台中查找
                        </a>
                      </Button>
                    ) : null}
                    {pdsUrl ? (
                      <Button variant="outline" size="sm" className="w-fit" asChild>
                        <a href={pdsUrl} target="_blank" rel="noreferrer">
                          <ExternalLinkIcon className="size-3.5" />
                          打开账号服务
                        </a>
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      尚未在系统设置中配置审核后台或账号服务地址。
                    </p>
                    <Button variant="outline" size="sm" asChild>
                      <Link href="/settings?section=integrations">前往系统设置</Link>
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <Separator />
      <p className="text-xs text-muted-foreground">
        账号目录由索引器写入，账号资料以账号服务为准。账号资料修改与删除需要相应权限，并写入审计日志。
      </p>
    </div>
  )
}
