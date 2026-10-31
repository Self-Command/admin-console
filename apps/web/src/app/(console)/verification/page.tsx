'use client'

import { useState } from 'react'
import { PageHeader } from '@/components/page-header'
import { useAuth } from '@/components/auth/auth-provider'
import { ApprovalRequestDialog } from '@/components/security/approval-request-dialog'
import { Badge } from '@/components/ui/badge'
import { VerificationPanel } from '@/components/verification/verification-panel'
import { hasPermission } from '@/lib/access'
import type { ApprovalRequestDraft } from '@/lib/approvals'

export default function VerificationPage() {
  const { identity } = useAuth()
  const canWrite = hasPermission(identity, 'verification.write')

  const [draft, setDraft] = useState<ApprovalRequestDraft | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  return (
    <div className="space-y-5">
      <PageHeader
        title="账号认证"
        description="为社区账号授予或撤销官方认证，认证信息会展示在账号的公开资料中。"
        actions={
          canWrite ? (
            <Badge variant="outline">可授予与撤销认证</Badge>
          ) : (
            <Badge variant="outline">只读视图</Badge>
          )
        }
      />

      {!canWrite ? (
        <div className="rounded-xl border bg-card px-4 py-3 text-xs text-muted-foreground">
          当前账号只有查看权限：可以浏览认证记录，授予与撤销认证需要“管理认证”权限。
        </div>
      ) : null}

      <VerificationPanel
        canWrite={canWrite}
        refreshToken={refreshToken}
        onChanged={() => setRefreshToken((value) => value + 1)}
        onRequestApproval={setDraft}
      />

      <ApprovalRequestDialog
        draft={draft}
        onClose={() => {
          setDraft(null)
          setRefreshToken((value) => value + 1)
        }}
      />
    </div>
  )
}
