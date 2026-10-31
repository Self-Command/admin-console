'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { LoaderCircleIcon, MailCheckIcon, TriangleAlertIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ErrorState, LoadingState } from '@/components/data-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  isApprovalRequired,
  notificationSendApprovalDraft,
  type ApprovalRequestDraft,
} from '@/lib/approvals'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type {
  NotificationSendResult,
  NotificationTemplate,
} from '@/lib/data/types'
import { describeAdminError } from '@/lib/errors'
import { formatNumber } from '@/lib/format'

const DID_PATTERN = /^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/
const MAX_RECIPIENTS = 100

type LoadStatus = 'loading' | 'ready' | 'error'

function parseRecipients(value: string): string[] {
  const seen = new Set<string>()
  const recipients: string[] = []
  for (const entry of value.split(/[\s,，;；]+/)) {
    const did = entry.trim()
    if (!did || seen.has(did)) continue
    seen.add(did)
    recipients.push(did)
  }
  return recipients
}

type Props = {
  canWrite: boolean
  onRequestApproval: (draft: ApprovalRequestDraft) => void
}

export function NotificationSendPanel({ canWrite, onRequestApproval }: Props) {
  const provider = useDataProvider()

  const [templates, setTemplates] = useState<NotificationTemplate[]>([])
  const [sendAvailable, setSendAvailable] = useState(true)
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null)
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const [recipientsText, setRecipientsText] = useState('')
  const [subject, setSubject] = useState('')
  const [content, setContent] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<NotificationSendResult | null>(null)

  useEffect(() => {
    let active = true
    setStatus('loading')
    setLoadError(null)
    provider
      .listTemplates()
      .then((value) => {
        if (!active) return
        setTemplates(value.templates)
        setSendAvailable(value.sendAvailable)
        setUnavailableReason(value.sendUnavailableReason ?? null)
        setStatus('ready')
      })
      .catch((cause: unknown) => {
        if (!active) return
        setLoadError(describeAdminError(cause))
        setStatus('error')
      })
    return () => {
      active = false
    }
  }, [provider, reloadToken])

  const recipients = useMemo(() => parseRecipients(recipientsText), [recipientsText])

  function applyTemplate(id: string) {
    setTemplateId(id)
    const template = templates.find((item) => item.id === id)
    if (!template) return
    setSubject(template.subject)
    setContent(template.contentMarkdown)
    setFormError(null)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    setResult(null)

    if (recipients.length === 0) {
      setFormError('请填写至少 1 个接收账号的账号标识。')
      return
    }
    if (recipients.length > MAX_RECIPIENTS) {
      setFormError(`一次最多向 ${MAX_RECIPIENTS} 个账号发送通知，当前填写了 ${recipients.length} 个。`)
      return
    }
    const invalid = recipients.find((did) => !DID_PATTERN.test(did))
    if (invalid) {
      setFormError(`账号标识格式不正确：${invalid}`)
      return
    }
    if (!subject.trim()) {
      setFormError('请填写通知主题。')
      return
    }
    if (subject.trim().length > 500) {
      setFormError('通知主题不能超过 500 个字符。')
      return
    }
    if (!content.trim()) {
      setFormError('请填写通知正文。')
      return
    }
    if (content.trim().length > 20000) {
      setFormError('通知正文不能超过 20000 个字符。')
      return
    }

    const payload = {
      recipients,
      subject: subject.trim(),
      contentMarkdown: content.trim(),
      ...(templateId ? { templateId } : {}),
    }
    setSending(true)
    try {
      const value = await provider.sendNotification(payload)
      setResult(value)
      if (value.failed.length > 0) {
        toast.warning(`通知已发送 ${value.sent} 个账号，${value.failed.length} 个账号未送达。`)
      } else {
        toast.success(`通知已发送给 ${formatNumber(value.sent)} 个账号。`)
      }
    } catch (cause) {
      if (isApprovalRequired(cause)) {
        onRequestApproval(notificationSendApprovalDraft(payload))
        return
      }
      setFormError(describeAdminError(cause))
    } finally {
      setSending(false)
    }
  }

  if (status === 'error') {
    return (
      <div className="overflow-hidden rounded-xl border bg-card">
        <ErrorState
          title="通知配置加载失败"
          message={loadError ?? '操作失败，请稍后重试。'}
          onRetry={() => setReloadToken((value) => value + 1)}
        />
      </div>
    )
  }

  if (status === 'loading' && templates.length === 0 && sendAvailable) {
    return (
      <div className="overflow-hidden rounded-xl border bg-card">
        <LoadingState label="正在读取通知配置…" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {!sendAvailable ? (
        <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-xs text-warning-foreground">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <div className="space-y-0.5">
            <p className="font-medium">邮件发送暂不可用</p>
            <p>
              {unavailableReason ??
                '尚未配置邮件发送凭据，请联系部署管理员完成配置后重试。'}
            </p>
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border bg-card px-4 py-3">
        <p className="text-sm font-medium">发送系统通知</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          通知以邮件形式发送给指定账号。系统存在多位管理员时，发送请求需要另一位管理员批准后执行；接收账号不会看到其他收件人信息。
        </p>
      </div>

      <form className="space-y-4 rounded-xl border bg-card p-4" onSubmit={submit}>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="notification-recipients">接收账号</Label>
            <Textarea
              id="notification-recipients"
              value={recipientsText}
              onChange={(event) => {
                setRecipientsText(event.target.value)
                setFormError(null)
              }}
              placeholder={'每行一个账号标识，例如：\ndid:plc:…'}
              className="min-h-28 font-mono text-xs"
              disabled={sending}
            />
            <p className="text-xs text-muted-foreground">
              已识别 {formatNumber(recipients.length)} 个账号，单次最多 {MAX_RECIPIENTS} 个。
            </p>
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="notification-template">使用模板（可选）</Label>
              <Select
                id="notification-template"
                value={templateId}
                onChange={(event) => applyTemplate(event.target.value)}
                disabled={sending || templates.length === 0}
              >
                <option value="">不使用模板</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id} disabled={template.disabled}>
                    {template.name}
                    {template.disabled ? '（已停用）' : ''}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                选择模板会填入模板的主题与正文，可在发送前继续修改。
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notification-subject">通知主题</Label>
              <Input
                id="notification-subject"
                value={subject}
                onChange={(event) => {
                  setSubject(event.target.value)
                  setFormError(null)
                }}
                maxLength={500}
                disabled={sending}
              />
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="notification-content">通知正文</Label>
          <Textarea
            id="notification-content"
            value={content}
            onChange={(event) => {
              setContent(event.target.value)
              setFormError(null)
            }}
            className="min-h-40"
            maxLength={20000}
            disabled={sending}
          />
          <p className="text-xs text-muted-foreground">正文支持 Markdown 格式，发送前请核对链接与署名。</p>
        </div>

        {formError ? (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {formError}
          </p>
        ) : null}

        {result ? (
          <div role="status" className="space-y-2 rounded-md border bg-muted/40 px-3 py-2 text-xs">
            <p className="flex items-center gap-1.5 font-medium">
              <MailCheckIcon className="size-3.5" />
              已发送 {formatNumber(result.sent)} 个账号
              {result.failed.length > 0
                ? `，${formatNumber(result.failed.length)} 个账号未送达`
                : '，全部送达成功'}
            </p>
            {result.failed.length > 0 ? (
              <ul className="space-y-1 text-muted-foreground">
                {result.failed.slice(0, 5).map((item) => (
                  <li key={item.recipient} className="break-all">
                    <span className="font-mono">{item.recipient}</span>：{item.message}
                  </li>
                ))}
                {result.failed.length > 5 ? (
                  <li>其余 {formatNumber(result.failed.length - 5)} 个账号请稍后重试。</li>
                ) : null}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Badge variant="outline">发送前需确认收件人与正文</Badge>
          <Button type="submit" disabled={sending || !canWrite || !sendAvailable}>
            {sending ? <LoaderCircleIcon className="animate-spin" /> : null}
            发送通知
          </Button>
        </div>
        {!canWrite ? (
          <p className="text-xs text-muted-foreground">当前账号没有发送通知的权限。</p>
        ) : null}
      </form>
    </div>
  )
}
