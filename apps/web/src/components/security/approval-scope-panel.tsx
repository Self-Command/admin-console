'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { LoaderCircleIcon, ShieldCheckIcon, SlidersHorizontalIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ErrorState, LoadingState } from '@/components/data-state'
import { useWorkspace } from '@/components/layout/workspace-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type { ApprovalAction, ApprovalScopeView } from '@/lib/data/types'
import {
  approvalActionDescriptions,
  approvalActionLabels,
} from '@/lib/approvals'
import { describeAdminError } from '@/lib/errors'
import { formatTimestamp } from '@/lib/format'

type LoadState = 'loading' | 'ready' | 'error'

const REASON_LIMIT = 200

export function ApprovalScopePanel({ canWrite }: { canWrite: boolean }) {
  const provider = useDataProvider()
  const { dateFormat } = useWorkspace()

  const [state, setState] = useState<LoadState>('loading')
  const [scope, setScope] = useState<ApprovalScopeView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const [selected, setSelected] = useState<ApprovalAction[]>([])
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setState('loading')
    setError(null)
    provider
      .getApprovalScope()
      .then((result) => {
        if (!active) return
        setScope(result)
        setSelected([])
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
  }, [provider, reloadToken])

  const candidates = useMemo(() => {
    if (!scope) return []
    const builtIn = new Set(scope.builtInActions)
    const additional = new Set(scope.additionalActions)
    return scope.availableActions.filter(
      (action) => !builtIn.has(action) && !additional.has(action),
    )
  }, [scope])

  const toggleSelected = useCallback((action: ApprovalAction) => {
    setSelected((current) =>
      current.includes(action)
        ? current.filter((item) => item !== action)
        : [...current, action],
    )
    setSaveError(null)
  }, [])

  async function save() {
    if (!canWrite || saving) return
    if (selected.length === 0) {
      setSaveError('请选择至少一个需要追加审批的动作。')
      return
    }
    if (reason.trim().length > REASON_LIMIT) {
      setSaveError(`追加原因不能超过 ${REASON_LIMIT} 个字符。`)
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const result = await provider.updateApprovalScope({
        additionalActions: selected,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      })
      setScope(result)
      setSelected([])
      setReason('')
      toast.success('审批范围已更新，新的要求已立即生效。')
    } catch (cause) {
      setSaveError(describeAdminError(cause))
    } finally {
      setSaving(false)
    }
  }

  if (state === 'loading') {
    return (
      <Card className="py-0">
        <LoadingState label="正在加载审批范围…" />
      </Card>
    )
  }

  if (state === 'error' || !scope) {
    return (
      <Card className="py-0">
        <ErrorState
          title="审批范围加载失败"
          message={error ?? '操作失败，请稍后重试。'}
          onRetry={() => setReloadToken((value) => value + 1)}
        />
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        审批范围分为内置动作与追加动作。内置动作始终需要另一位管理员批准，无法关闭；追加动作只能增加，不能移除。保存后立即生效，并写入审计日志。
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheckIcon className="size-4 text-muted-foreground" />
            内置必审动作
          </CardTitle>
          <CardDescription>
            高风险动作固定需要双人审批，任何配置都不会改变该要求。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 sm:grid-cols-2">
            {scope.builtInActions.map((action) => (
              <li key={action} className="rounded-md border px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm">{approvalActionLabels[action]}</span>
                  <Badge variant="secondary">始终审批</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {approvalActionDescriptions[action]}
                </p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SlidersHorizontalIcon className="size-4 text-muted-foreground" />
            追加需审批动作
          </CardTitle>
          <CardDescription>
            在系统已有范围内，为额外的动作启用双人审批。当前已追加 {scope.additionalActions.length} 项，配置版本 {scope.version}
            {scope.updatedAt
              ? `，最后更新于 ${formatTimestamp(scope.updatedAt, dateFormat)}`
              : ''}
            。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {scope.additionalActions.length === 0 ? (
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              当前没有追加动作，只有内置动作需要审批。
            </p>
          ) : (
            <ul className="space-y-2">
              {scope.additionalActions.map((action) => (
                <li
                  key={action}
                  className="rounded-md border px-3 py-2 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span>{approvalActionLabels[action]}</span>
                    <Badge variant="warning">已追加</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {approvalActionDescriptions[action]}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {canWrite ? (
            candidates.length === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-3 text-xs text-muted-foreground">
                系统支持的动作已全部纳入审批范围，暂无可追加的动作。
              </p>
            ) : (
              <div className="space-y-3">
                <p className="text-sm font-medium">选择需要追加审批的动作</p>
                <ul className="space-y-2">
                  {candidates.map((action) => (
                    <li
                      key={action}
                      className="flex items-start gap-3 rounded-md border px-3 py-2"
                    >
                      <Checkbox
                        checked={selected.includes(action)}
                        onCheckedChange={() => toggleSelected(action)}
                        aria-label={`追加审批：${approvalActionLabels[action]}`}
                        disabled={saving}
                        className="mt-0.5"
                      />
                      <div className="min-w-0">
                        <p className="text-sm">{approvalActionLabels[action]}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {approvalActionDescriptions[action]}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="approval-scope-reason">
                    追加原因（可选）
                  </label>
                  <Input
                    id="approval-scope-reason"
                    value={reason}
                    onChange={(event) => {
                      setReason(event.target.value)
                      setSaveError(null)
                    }}
                    maxLength={REASON_LIMIT}
                    placeholder="记录本次调整的原因，便于后续复核"
                    disabled={saving}
                  />
                </div>
                {saveError ? (
                  <p role="alert" className="text-xs text-destructive">
                    {saveError}
                  </p>
                ) : null}
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    已选择 {selected.length} 个动作。
                  </p>
                  <Button onClick={() => void save()} disabled={saving || selected.length === 0}>
                    {saving ? <LoaderCircleIcon className="animate-spin" /> : null}
                    保存审批范围
                  </Button>
                </div>
              </div>
            )
          ) : (
            <p className="text-xs text-muted-foreground">
              当前账号只有查看权限：调整审批范围需要“修改系统设置”权限。
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
