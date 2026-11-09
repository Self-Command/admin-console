'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  CheckIcon,
  CircleUserRoundIcon,
  LoaderCircleIcon,
  LogOutIcon,
  MonitorSmartphoneIcon,
  SettingsIcon,
  ShieldAlertIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/page-header'
import { useAuth } from '@/components/auth/auth-provider'
import { useWorkspace } from '@/components/layout/workspace-provider'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { hasPermission } from '@/lib/access'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type { SelfAccess } from '@/lib/data/types'
import { describeAdminError } from '@/lib/errors'
import { formatTimestamp, truncateDid } from '@/lib/format'
import {
  allPermissions,
  permissionDescriptions,
  permissionLabels,
  roleDescriptions,
  roleLabels,
} from '@/lib/roles'
import type { DateFormat, Density, ThemeMode } from '@/lib/runtime/types'

type FormState = {
  themeMode: ThemeMode
  density: Density
  pageSize: number
  dateFormat: DateFormat
}

const PAGE_SIZES = [10, 20, 50, 100]

function initialOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || '账'
}

export default function ProfilePage() {
  const { identity, session, displayName, signOut } = useAuth()
  const provider = useDataProvider()
  const {
    preferences,
    density,
    pageSize,
    dateFormat,
    savingPreferences,
    savePreferences,
  } = useWorkspace()

  const [form, setForm] = useState<FormState>({
    themeMode: preferences.themeMode ?? 'system',
    density,
    pageSize,
    dateFormat,
  })
  const [signingOut, setSigningOut] = useState(false)

  const [accessState, setAccessState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [selfAccess, setSelfAccess] = useState<SelfAccess | null>(null)
  const [accessError, setAccessError] = useState<string | null>(null)
  const [accessReloadToken, setAccessReloadToken] = useState(0)

  useEffect(() => {
    setForm({
      themeMode: preferences.themeMode ?? 'system',
      density,
      pageSize,
      dateFormat,
    })
  }, [preferences.themeMode, density, pageSize, dateFormat])

  useEffect(() => {
    if (!identity) return
    let active = true
    setAccessState('loading')
    setAccessError(null)
    provider
      .getSelfAccess()
      .then((result) => {
        if (!active) return
        setSelfAccess(result)
        setAccessState('ready')
      })
      .catch((cause: unknown) => {
        if (!active) return
        setAccessError(describeAdminError(cause))
        setAccessState('error')
      })
    return () => {
      active = false
    }
  }, [provider, identity, accessReloadToken])

  if (!identity || !session) return null

  const role = identity.role
  const roleLabel = role ? roleLabels[role] : '未分配角色'
  const granted = role ? allPermissions.filter((item) => identity.permissions.includes(item)) : []
  const missing = allPermissions.filter((item) => !identity.permissions.includes(item))

  async function handleSave() {
    const saved = await savePreferences({
      themeMode: form.themeMode,
      density: form.density,
      pageSize: form.pageSize,
      dateFormat: form.dateFormat,
    })
    if (saved) toast.success('显示偏好已保存，将在所有页面生效。')
    else toast.error('显示偏好未能同步到账号，已在本机保留。')
  }

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await signOut()
    } finally {
      setSigningOut(false)
    }
  }

  const changed =
    form.themeMode !== (preferences.themeMode ?? 'system') ||
    form.density !== density ||
    form.pageSize !== pageSize ||
    form.dateFormat !== dateFormat

  return (
    <div className="space-y-5">
      <PageHeader
        title="个人资料"
        description="查看当前账号的身份与权限，并调整只影响本人的显示偏好。"
        actions={
          hasPermission(identity, 'settings.read') ? (
            <Button variant="outline" size="sm" asChild>
              <Link href="/settings">
                <SettingsIcon />
                系统设置
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Avatar className="size-12">
                  <AvatarFallback className="bg-primary/10 text-sm text-primary">
                    {initialOf(displayName ?? session.did)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 space-y-1">
                  <p className="truncate font-medium">{displayName ?? '当前账号'}</p>
                  <p className="truncate text-xs text-muted-foreground" title={session.did}>
                    {truncateDid(session.did, 20, 8)}
                  </p>
                </div>
              </div>

              <Separator />

              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">账号标识</span>
                  <span className="max-w-56 truncate font-mono text-xs" title={session.did}>
                    {session.did}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">账号服务</span>
                  <span className="max-w-56 truncate font-mono text-xs" title={session.service}>
                    {session.service}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">后台角色</span>
                  <Badge variant={role === 'admin' ? 'default' : role ? 'secondary' : 'muted'}>
                    {roleLabel}
                  </Badge>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">当前会话</span>
                  <span className="flex items-center gap-1.5 text-xs">
                    <span className="size-1.5 rounded-full bg-success" />
                    已验证
                  </span>
                </div>
              </div>

              {role ? (
                <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                  {roleDescriptions[role]}
                </p>
              ) : (
                <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-relaxed">
                  该账号尚未分配后台角色，只能查看个人资料。如需进入业务页面，请联系管理员开通角色。
                </p>
              )}

              <Button variant="outline" className="w-full" onClick={() => void handleSignOut()} disabled={signingOut}>
                {signingOut ? <LoaderCircleIcon className="animate-spin" /> : <LogOutIcon />}
                退出登录
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CircleUserRoundIcon className="size-4 text-muted-foreground" />
                权限说明
              </CardTitle>
              <CardDescription>权限由后台服务校验，界面隐藏不等于拥有权限</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {granted.length === 0 ? (
                <p className="text-sm text-muted-foreground">当前账号没有业务权限。</p>
              ) : (
                <ul className="space-y-2.5">
                  {granted.map((permission) => (
                    <li key={permission} className="flex items-start gap-2 text-sm">
                      <CheckIcon className="mt-0.5 size-4 shrink-0 text-success" />
                      <span>
                        <span className="font-medium">{permissionLabels[permission]}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {permissionDescriptions[permission]}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {missing.length > 0 ? (
                <p className="border-t pt-3 text-xs text-muted-foreground">
                  未开通：{missing.map((item) => permissionLabels[item]).join('、')}。
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MonitorSmartphoneIcon className="size-4 text-muted-foreground" />
                后台访问记录
              </CardTitle>
              <CardDescription>
                仅显示你自己的最近访问；如遇封锁，需要其他管理员解除。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {accessState === 'loading' ? (
                <p className="text-sm text-muted-foreground">正在读取访问记录…</p>
              ) : accessState === 'error' ? (
                <div className="space-y-2">
                  <p role="alert" className="text-sm text-destructive">
                    {accessError ?? '访问记录加载失败，请稍后重试。'}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAccessReloadToken((value) => value + 1)}
                  >
                    重试
                  </Button>
                </div>
              ) : selfAccess?.blocked ? (
                <>
                  <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <ShieldAlertIcon className="size-4" />
                      后台访问已被封锁
                    </p>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      封锁期间你的后台请求会被拒绝；账号服务登录与社区使用不受影响。解除需由其他管理员操作。
                    </p>
                    <dl className="grid gap-2 pt-1 text-xs sm:grid-cols-2">
                      <div>
                        <dt className="text-muted-foreground">封锁时间</dt>
                        <dd className="mt-0.5">
                          {formatTimestamp(selfAccess.blockedAt, dateFormat)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">操作人</dt>
                        <dd className="mt-0.5 font-mono break-all">
                          {selfAccess.blockedBy
                            ? truncateDid(selfAccess.blockedBy, 18, 6)
                            : '—'}
                        </dd>
                      </div>
                      {selfAccess.reason ? (
                        <div className="sm:col-span-2">
                          <dt className="text-muted-foreground">原因</dt>
                          <dd className="mt-0.5">{selfAccess.reason}</dd>
                        </div>
                      ) : null}
                    </dl>
                  </div>
                </>
              ) : (
                <p className="flex items-center gap-2 text-sm">
                  <span className="size-1.5 rounded-full bg-success" />
                  当前未被封锁，后台访问正常。
                </p>
              )}

              {accessState === 'ready' ? (
                selfAccess && selfAccess.records.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>来源地址</TableHead>
                        <TableHead>客户端</TableHead>
                        <TableHead>最近访问</TableHead>
                        <TableHead className="text-right">请求次数</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selfAccess.records.map((record) => (
                        <TableRow key={`${record.ip}-${record.userAgent ?? ''}`}>
                          <TableCell className="font-mono text-xs">{record.ip}</TableCell>
                          <TableCell
                            className="max-w-40 truncate text-xs text-muted-foreground"
                            title={record.userAgent ?? ''}
                          >
                            {record.userAgent ?? '未提供'}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {formatTimestamp(record.lastSeenAt, dateFormat)}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {record.requestCount}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    暂无访问记录；成功调用后台接口后会记录来源地址与客户端。
                  </p>
                )
              ) : null}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>显示偏好</CardTitle>
            <CardDescription>只影响你自己的界面，不改变其他管理员看到的内容与权限。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="preference-theme">
                  主题模式
                </label>
                <Select
                  id="preference-theme"
                  value={form.themeMode}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      themeMode: event.target.value as ThemeMode,
                    }))
                  }
                >
                  <option value="system">跟随系统</option>
                  <option value="light">浅色</option>
                  <option value="dark">深色</option>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="preference-density">
                  界面密度
                </label>
                <Select
                  id="preference-density"
                  value={form.density}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      density: event.target.value as Density,
                    }))
                  }
                >
                  <option value="comfortable">舒适</option>
                  <option value="compact">紧凑</option>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="preference-page-size">
                  每页条数
                </label>
                <Select
                  id="preference-page-size"
                  value={String(form.pageSize)}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      pageSize: Number(event.target.value),
                    }))
                  }
                >
                  {PAGE_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size} 条
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="preference-date-format">
                  日期格式
                </label>
                <Select
                  id="preference-date-format"
                  value={form.dateFormat}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      dateFormat: event.target.value as DateFormat,
                    }))
                  }
                >
                  <option value="date-time">日期与时间</option>
                  <option value="date">仅日期</option>
                </Select>
              </div>
            </div>

            <div className="rounded-lg border bg-muted/30 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
              偏好会同步到你的账号，换设备登录后仍然生效。主题切换同时可在顶部工具栏快速调整。
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">
                上次同步：{preferences.themeMode ? '已从账号读取' : '使用系统默认值'}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setForm({
                      themeMode: preferences.themeMode ?? 'system',
                      density,
                      pageSize,
                      dateFormat,
                    })
                  }
                  disabled={!changed || savingPreferences}
                >
                  放弃更改
                </Button>
                <Button size="sm" onClick={() => void handleSave()} disabled={!changed || savingPreferences}>
                  {savingPreferences ? <LoaderCircleIcon className="animate-spin" /> : null}
                  保存偏好
                </Button>
              </div>
            </div>

            <div className="border-t pt-4 text-xs leading-relaxed text-muted-foreground">
              当前登录会话由账号服务验证，最近一次身份校验发生在页面加载时
              {session.handle ? `（${session.handle}）` : ''}。如遇权限变更，请重新登录后生效。
              <span className="mt-1 block">
                会话状态检查：{formatTimestamp(new Date().toISOString(), dateFormat)}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
