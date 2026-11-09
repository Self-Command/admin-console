'use client'

import { useEffect, useState } from 'react'
import { MailIcon, MailPlusIcon } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { useAuth } from '@/components/auth/auth-provider'
import { NotificationSendPanel } from '@/components/notifications/notification-send-panel'
import { TemplatePanel } from '@/components/notifications/template-panel'
import { ApprovalRequestDialog } from '@/components/security/approval-request-dialog'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { hasPermission } from '@/lib/access'
import type { ApprovalRequestDraft } from '@/lib/approvals'

type TabValue = 'send' | 'templates'

const TAB_VALUES: readonly TabValue[] = ['send', 'templates']

export default function NotificationsPage() {
  const { identity } = useAuth()
  const canWrite = hasPermission(identity, 'notification.write')

  const [tab, setTab] = useState<TabValue>('send')
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
        title="通知中心"
        description="向社区账号发送系统通知，并维护可复用的通知模板。"
        actions={
          canWrite ? (
            <Badge variant="outline">可发送通知与维护模板</Badge>
          ) : (
            <Badge variant="outline">只读视图</Badge>
          )
        }
      />

      {!canWrite ? (
        <div className="rounded-xl border bg-card px-4 py-3 text-xs text-muted-foreground">
          当前账号只有查看权限：可以浏览通知模板，发送通知与维护模板需要“发送通知”权限。
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={(value) => setTab(value as TabValue)}>
        <TabsList>
          <TabsTrigger value="send">
            <MailIcon />
            发送通知
          </TabsTrigger>
          <TabsTrigger value="templates">
            <MailPlusIcon />
            通知模板
          </TabsTrigger>
        </TabsList>

        <TabsContent value="send">
          <NotificationSendPanel canWrite={canWrite} onRequestApproval={setDraft} />
        </TabsContent>

        <TabsContent value="templates">
          <TemplatePanel canWrite={canWrite} />
        </TabsContent>
      </Tabs>

      <ApprovalRequestDialog draft={draft} onClose={() => setDraft(null)} />
    </div>
  )
}
