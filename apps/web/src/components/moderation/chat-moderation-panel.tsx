'use client'

import { useEffect, useState } from 'react'
import { MessagesSquareIcon } from 'lucide-react'
import { ErrorState } from '@/components/data-state'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useAuth } from '@/components/auth/auth-provider'
import { hasPermission } from '@/lib/access'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type { ChatMetadata } from '@/lib/data/types'
import { describeAdminError } from '@/lib/errors'

type PanelState = 'loading' | 'ready' | 'error'

export function ChatModerationPanel() {
  const provider = useDataProvider()
  const { identity } = useAuth()
  const canRead = hasPermission(identity, 'chat.read')

  const [state, setState] = useState<PanelState>('loading')
  const [metadata, setMetadata] = useState<ChatMetadata | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!canRead) return
    let active = true
    setState('loading')
    setError(null)
    provider
      .getChatMetadata()
      .then((value) => {
        if (!active) return
        setMetadata(value)
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
  }, [provider, canRead, reloadToken])

  if (!canRead) return null

  return (
    <Card className="py-0">
      <CardHeader className="px-4 pt-4 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <MessagesSquareIcon className="size-4 text-muted-foreground" />
          聊天审核
          {state === 'ready' && metadata ? (
            metadata.enabled ? (
              <Badge variant="success">已接入</Badge>
            ) : (
              <Badge variant="outline">未启用</Badge>
            )
          ) : null}
        </CardTitle>
        <CardDescription>
          聊天内容由独立的聊天服务维护，后台只展示接入状态，不读取聊天正文。
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4 pb-4 text-xs">
        {state === 'loading' ? (
          <p className="text-muted-foreground">正在检查聊天服务接入状态…</p>
        ) : state === 'error' ? (
          <ErrorState
            title="聊天审核状态加载失败"
            message={error ?? '操作失败，请稍后重试。'}
            onRetry={() => setReloadToken((value) => value + 1)}
          />
        ) : metadata?.enabled ? (
          <p className="text-muted-foreground">
            聊天服务已接入。聊天审核在聊天服务内进行，本系统不读取聊天正文；如需处置聊天内容，请通过聊天服务的管理入口操作。
          </p>
        ) : (
          <div className="space-y-1">
            <p className="text-muted-foreground">
              {metadata?.reason ?? '当前部署未接入聊天服务，聊天审核暂不可用。'}
            </p>
            <p className="text-muted-foreground">
              接入聊天服务后，这里会显示已接入状态；聊天内容本身不经过本系统。
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
