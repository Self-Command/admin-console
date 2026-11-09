'use client'

import { useEffect, useState } from 'react'
import { LayersIcon, LinkIcon, SlidersHorizontalIcon, TagsIcon } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { useAuth } from '@/components/auth/auth-provider'
import { LabelerPanel } from '@/components/policy/labeler-panel'
import { PolicyOptionsPanel } from '@/components/policy/policy-options-panel'
import { PolicySetsPanel } from '@/components/policy/policy-sets-panel'
import { SafelinkPanel } from '@/components/policy/safelink-panel'
import { ApprovalRequestDialog } from '@/components/security/approval-request-dialog'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { hasPermission } from '@/lib/access'
import type { ApprovalRequestDraft } from '@/lib/approvals'

type TabValue = 'options' | 'sets' | 'safelink' | 'labeler'

const TAB_VALUES: readonly TabValue[] = ['options', 'sets', 'safelink', 'labeler']

export default function PolicyPage() {
  const { identity } = useAuth()
  const canWrite = hasPermission(identity, 'policy.write')

  const [tab, setTab] = useState<TabValue>('options')
  const [draft, setDraft] = useState<ApprovalRequestDraft | null>(null)

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('tab')
    if (requested && TAB_VALUES.includes(requested as TabValue)) {
      setTab(requested as TabValue)
    }
  }, [])

  return (
    <div className="space-y-5">
      <PageHeader
        title="审核策略"
        description="维护审核策略选项、对象集合、外链访问规则与标签服务配置，保存后对审核服务立即生效。"
        actions={
          canWrite ? (
            <Badge variant="outline">可调整审核策略</Badge>
          ) : (
            <Badge variant="outline">只读视图</Badge>
          )
        }
      />

      {!canWrite ? (
        <div className="rounded-xl border bg-card px-4 py-3 text-xs text-muted-foreground">
          当前账号只有查看权限：可以浏览全部审核策略，修改策略需要“管理审核策略”权限，且通常需要另一位管理员批准。
        </div>
      ) : (
        <div className="rounded-xl border bg-card px-4 py-3 text-xs text-muted-foreground">
          审核策略影响全站审核判定。为降低误操作风险，策略修改需要另一位管理员批准后才会执行，并写入审计日志。
        </div>
      )}

      <Tabs value={tab} onValueChange={(value) => setTab(value as TabValue)}>
        <TabsList>
          <TabsTrigger value="options">
            <SlidersHorizontalIcon />
            策略选项
          </TabsTrigger>
          <TabsTrigger value="sets">
            <LayersIcon />
            对象集合
          </TabsTrigger>
          <TabsTrigger value="safelink">
            <LinkIcon />
            外链规则
          </TabsTrigger>
          <TabsTrigger value="labeler">
            <TagsIcon />
            标签服务
          </TabsTrigger>
        </TabsList>

        <TabsContent value="options">
          <PolicyOptionsPanel canWrite={canWrite} onRequestApproval={setDraft} />
        </TabsContent>

        <TabsContent value="sets">
          <PolicySetsPanel canWrite={canWrite} onRequestApproval={setDraft} />
        </TabsContent>

        <TabsContent value="safelink">
          <SafelinkPanel canWrite={canWrite} onRequestApproval={setDraft} />
        </TabsContent>

        <TabsContent value="labeler">
          <LabelerPanel />
        </TabsContent>
      </Tabs>

      <ApprovalRequestDialog draft={draft} onClose={() => setDraft(null)} />
    </div>
  )
}
