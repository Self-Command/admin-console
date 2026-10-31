'use client'

import { useEffect, useState } from 'react'
import {
  ActivityIcon,
  ClipboardCheckIcon,
  ShieldBanIcon,
  SlidersHorizontalIcon,
} from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { useAuth } from '@/components/auth/auth-provider'
import { useWorkspace } from '@/components/layout/workspace-provider'
import { AccessActivityPanel } from '@/components/security/access-activity-panel'
import { AccessBlocksPanel } from '@/components/security/access-blocks-panel'
import { ApprovalRequestDialog } from '@/components/security/approval-request-dialog'
import { ApprovalScopePanel } from '@/components/security/approval-scope-panel'
import { ApprovalsPanel } from '@/components/security/approvals-panel'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { hasPermission } from '@/lib/access'
import type { ApprovalRequestDraft } from '@/lib/approvals'

type TabValue = 'access' | 'approvals' | 'scope' | 'blocks'

const TAB_VALUES: readonly TabValue[] = ['access', 'approvals', 'scope', 'blocks']

export default function SecurityPage() {
  const { identity } = useAuth()
  const { features } = useWorkspace()
  const canWrite = hasPermission(identity, 'security.write')
  const canReadScope = hasPermission(identity, 'settings.read')
  const canWriteScope = hasPermission(identity, 'settings.write')
  const approvalsEnabled = features.approvals

  const [tab, setTab] = useState<TabValue>('access')
  const [refreshToken, setRefreshToken] = useState(0)
  const [draft, setDraft] = useState<ApprovalRequestDraft | null>(null)

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('tab')
    if (requested && TAB_VALUES.includes(requested as TabValue)) {
      setTab(requested as TabValue)
    }
  }, [])

  function changed() {
    setRefreshToken((value) => value + 1)
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="安全与审批"
        description="查看管理员的后台访问记录、处理高风险动作的双人审批，并管理后台访问封锁。"
        actions={
          canWrite ? (
            <Badge variant="outline">可执行安全管理操作</Badge>
          ) : (
            <Badge variant="outline">只读视图</Badge>
          )
        }
      />

      {!canWrite ? (
        <div className="rounded-xl border bg-card px-4 py-3 text-xs text-muted-foreground">
          当前账号只有查看权限：可以浏览访问记录与审批请求，但封锁、解除封锁、批准、拒绝与撤回操作需要“管理后台安全”权限。
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={(value) => setTab(value as TabValue)}>
        <TabsList>
          <TabsTrigger value="access">
            <ActivityIcon />
            访问活动
          </TabsTrigger>
          {approvalsEnabled ? (
            <TabsTrigger value="approvals">
              <ClipboardCheckIcon />
              待审批
            </TabsTrigger>
          ) : null}
          {approvalsEnabled && canReadScope ? (
            <TabsTrigger value="scope">
              <SlidersHorizontalIcon />
              审批范围
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="blocks">
            <ShieldBanIcon />
            访问封锁
          </TabsTrigger>
        </TabsList>

        <TabsContent value="access">
          <AccessActivityPanel />
        </TabsContent>

        {approvalsEnabled ? (
          <TabsContent value="approvals">
            <ApprovalsPanel
              canWrite={canWrite}
              selfDid={identity?.did}
              onRequestApproval={setDraft}
              refreshToken={refreshToken}
              onChanged={changed}
            />
          </TabsContent>
        ) : null}

        {approvalsEnabled && canReadScope ? (
          <TabsContent value="scope">
            <ApprovalScopePanel canWrite={canWriteScope} />
          </TabsContent>
        ) : null}

        <TabsContent value="blocks">
          <AccessBlocksPanel
            canWrite={canWrite}
            selfDid={identity?.did}
            onChanged={changed}
          />
        </TabsContent>
      </Tabs>

      <ApprovalRequestDialog
        draft={draft}
        onClose={() => {
          setDraft(null)
          changed()
        }}
      />
    </div>
  )
}