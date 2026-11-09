import { com } from '@admin/lexicons'
import { LexServerError } from '@atproto/lex-server'
import type { Kysely } from 'kysely'
import {
  auditErrorCode,
  writeAudit,
  type AuditExecutor,
  type RequestMeta,
} from '../audit.js'
import { isSoleAdmin } from '../auth/roles.js'
import type { ApprovalActionName, Database } from '../db/types.js'
import type { Logger } from '../logger.js'
import { callUpstream, type XrpcClient } from '../upstream/client.js'
import {
  invalid,
  normalizeNotificationSendPayload,
  optionalText,
  requiredText,
  type NotificationSendPayload,
} from './action-payloads.js'
import {
  approvalRequired,
  executeWithApproval,
  type ApprovalContext,
  type ApprovalPayload,
} from './approvals.js'
import { bool, iso, list, rec, shape, str } from './values.js'

export type TemplateView = com.selfcommand.admin.defs.TemplateView
export type TemplateListResult = com.selfcommand.admin.notifications.template.list.$OutputBody
export type TemplateActResult = com.selfcommand.admin.notifications.template.act.$OutputBody
export type NotificationSendResult = com.selfcommand.admin.notifications.send.$OutputBody
export type NotificationFailure = NotificationSendResult['failed'][number]

export type NotificationDeps = {
  ozone: XrpcClient
  pds: XrpcClient
  logger: Logger
  senderDid: string
}

export type NotificationWriteContext = NotificationDeps & {
  db: Kysely<Database>
  actor: string
  meta: RequestMeta
  ttlHours: number
}

export type NotificationRunContext = Pick<
  NotificationDeps,
  'pds' | 'logger' | 'senderDid'
> & {
  db: AuditExecutor
  actor: string
  meta: RequestMeta
  approvalId?: string
}

const OZONE = {
  templateList: 'tools.ozone.communication.listTemplates',
  templateCreate: 'tools.ozone.communication.createTemplate',
  templateUpdate: 'tools.ozone.communication.updateTemplate',
  templateDelete: 'tools.ozone.communication.deleteTemplate',
} as const

const PDS = {
  sendEmail: 'com.atproto.admin.sendEmail',
} as const

const SEND_UNAVAILABLE_REASON =
  '尚未配置邮件发送凭据，请联系部署管理员完成配置后重试。'

export function normalizeTemplateView(raw: unknown): TemplateView {
  const item = rec(raw)
  const id = str(item?.id, 128)
  const name = str(item?.name, 200)
  const contentMarkdown = str(item?.contentMarkdown, 20000)
  const disabled = bool(item?.disabled)
  if (!item || !id || !name || !contentMarkdown || disabled === undefined) {
    throw shape('通知模板')
  }
  const subject = str(item.subject, 500) ?? ''
  const lang = str(item.lang, 16)
  const createdAt = iso(item.createdAt)
  const updatedAt = iso(item.updatedAt)
  return {
    id,
    name,
    subject,
    contentMarkdown,
    ...(lang ? { lang } : {}),
    disabled,
    ...(createdAt ? { createdAt: createdAt as TemplateView['createdAt'] } : {}),
    ...(updatedAt ? { updatedAt: updatedAt as TemplateView['updatedAt'] } : {}),
  }
}

export async function listTemplates(
  deps: NotificationDeps,
): Promise<TemplateListResult> {
  const result = await callUpstream<{ communicationTemplates?: unknown[] }>(
    deps.ozone,
    OZONE.templateList,
  )
  return {
    templates: list(result.communicationTemplates).map(normalizeTemplateView),
    sendAvailable: deps.pds.configured,
    ...(deps.pds.configured ? {} : { sendUnavailableReason: SEND_UNAVAILABLE_REASON }),
  }
}

async function templateFromResponse(
  ozone: XrpcClient,
  raw: unknown,
  match: { id?: string; name?: string },
): Promise<TemplateView> {
  try {
    return normalizeTemplateView(raw)
  } catch {
    const result = await callUpstream<{ communicationTemplates?: unknown[] }>(
      ozone,
      OZONE.templateList,
    )
    const templates = list(result.communicationTemplates).map(normalizeTemplateView)
    const found = match.id
      ? templates.find((template) => template.id === match.id)
      : templates.find((template) => template.name === match.name)
    if (!found) throw shape('通知模板')
    return found
  }
}

type TemplateUpdateFields = {
  name?: string
  subject?: string
  contentMarkdown?: string
  lang?: string
  disabled?: boolean
}

type TemplateAction =
  | {
      action: 'create'
      name: string
      subject: string
      contentMarkdown: string
      lang?: string
    }
  | { action: 'update'; id: string; fields: TemplateUpdateFields }
  | { action: 'delete'; id: string }

function normalizeTemplateAction(
  input: com.selfcommand.admin.notifications.template.act.$InputBody,
): TemplateAction {
  if (input.action === 'create') {
    if (input.id !== undefined) throw invalid('新建模板不能提供模板编号')
    if (input.disabled !== undefined) throw invalid('新建模板不能设置停用状态')
    const lang = optionalText(input.lang, '语言', 16)
    return {
      action: 'create',
      name: requiredText(input.name, '模板名称', 200),
      subject: requiredText(input.subject, '邮件主题', 500),
      contentMarkdown: requiredText(input.contentMarkdown, '模板内容', 20000),
      ...(lang ? { lang } : {}),
    }
  }

  const id = requiredText(input.id, '模板编号', 128)
  if (input.action === 'delete') {
    if (
      input.name !== undefined ||
      input.subject !== undefined ||
      input.contentMarkdown !== undefined ||
      input.lang !== undefined ||
      input.disabled !== undefined
    ) {
      throw invalid('删除模板只需提供模板编号')
    }
    return { action: 'delete', id }
  }

  if (input.action === 'update') {
    const name = optionalText(input.name, '模板名称', 200)
    const subject = optionalText(input.subject, '邮件主题', 500)
    const contentMarkdown = optionalText(input.contentMarkdown, '模板内容', 20000)
    const lang = optionalText(input.lang, '语言', 16)
    const fields: TemplateUpdateFields = {
      ...(name ? { name } : {}),
      ...(subject ? { subject } : {}),
      ...(contentMarkdown ? { contentMarkdown } : {}),
      ...(lang ? { lang } : {}),
      ...(input.disabled !== undefined ? { disabled: input.disabled } : {}),
    }
    if (Object.keys(fields).length === 0) throw invalid('至少需要修改一项模板内容')
    return { action: 'update', id, fields }
  }

  throw invalid('模板操作不是受支持的动作')
}

function templateAuditDetail(action: TemplateAction): string {
  if (action.action === 'create') return `新建通知模板「${action.name}」`
  if (action.action === 'update') return `修改通知模板 #${action.id}`
  return `删除通知模板 #${action.id}`
}

export async function actOnTemplate(
  ctx: NotificationWriteContext,
  input: com.selfcommand.admin.notifications.template.act.$InputBody,
): Promise<TemplateActResult> {
  const action = normalizeTemplateAction(input)
  const target = action.action === 'create' ? action.name : action.id

  try {
    if (action.action === 'create') {
      const raw = await callUpstream<unknown>(ctx.ozone, OZONE.templateCreate, {
        method: 'POST',
        body: {
          name: action.name,
          subject: action.subject,
          contentMarkdown: action.contentMarkdown,
          ...(action.lang ? { lang: action.lang } : {}),
          createdBy: ctx.actor,
        },
      })
      const template = await templateFromResponse(ctx.ozone, raw, {
        name: action.name,
      })
      await writeAudit(ctx.db, ctx.logger, {
        actor: ctx.actor,
        action: 'com.selfcommand.admin.notifications.template.act',
        targetType: 'notification-template',
        target: template.id,
        result: 'success',
        detail: templateAuditDetail(action),
        ...ctx.meta,
      })
      return { template }
    }

    if (action.action === 'update') {
      const raw = await callUpstream<unknown>(ctx.ozone, OZONE.templateUpdate, {
        method: 'POST',
        body: { id: action.id, ...action.fields, updatedBy: ctx.actor },
      })
      const template = await templateFromResponse(ctx.ozone, raw, { id: action.id })
      await writeAudit(ctx.db, ctx.logger, {
        actor: ctx.actor,
        action: 'com.selfcommand.admin.notifications.template.act',
        targetType: 'notification-template',
        target: action.id,
        result: 'success',
        detail: templateAuditDetail(action),
        ...ctx.meta,
      })
      return { template }
    }

    await callUpstream<unknown>(ctx.ozone, OZONE.templateDelete, {
      method: 'POST',
      body: { id: action.id },
    })
    await writeAudit(ctx.db, ctx.logger, {
      actor: ctx.actor,
      action: 'com.selfcommand.admin.notifications.template.act',
      targetType: 'notification-template',
      target: action.id,
      result: 'success',
      detail: templateAuditDetail(action),
      ...ctx.meta,
    })
    return {}
  } catch (error) {
    await writeAudit(ctx.db, ctx.logger, {
      actor: ctx.actor,
      action: 'com.selfcommand.admin.notifications.template.act',
      targetType: 'notification-template',
      target,
      result: 'error',
      detail: `模板操作未完成（错误码：${auditErrorCode(error)}）`,
      ...ctx.meta,
    })
    throw error
  }
}

export async function deliverNotification(
  ctx: NotificationRunContext,
  payload: NotificationSendPayload,
  options: { requireAll?: boolean } = {},
): Promise<NotificationSendResult> {
  const failed: NotificationFailure[] = []
  let sent = 0

  for (const recipient of payload.recipients) {
    try {
      const result = await callUpstream<{ sent?: boolean }>(
        ctx.pds,
        PDS.sendEmail,
        {
          method: 'POST',
          body: {
            recipientDid: recipient,
            subject: payload.subject,
            content: payload.contentMarkdown,
            senderDid: ctx.senderDid,
            comment: '由管理后台发送的通知邮件',
          },
        },
      )
      if (result.sent === false) {
        throw new LexServerError(502, {
          error: 'UpstreamUnavailable',
          message: '邮件服务未确认送达，请稍后重试。',
        })
      }
      sent += 1
    } catch (error) {
      failed.push({
        recipient: recipient as NotificationFailure['recipient'],
        message:
          error instanceof LexServerError
            ? error.message
            : '邮件发送未完成，请稍后重试。',
      })
    }
  }

  await writeAudit(ctx.db, ctx.logger, {
    actor: ctx.actor,
    action: 'com.selfcommand.admin.notifications.send',
    targetType: 'notification',
    target: `batch:${payload.recipients.length}`,
    result: failed.length ? 'error' : 'success',
    detail: `发送通知「${payload.subject}」：成功 ${sent} 个，失败 ${failed.length} 个`,
    ...(ctx.approvalId ? { approvalId: ctx.approvalId } : {}),
    ...ctx.meta,
  })

  if (options.requireAll && failed.length) {
    throw new LexServerError(502, {
      error: 'UpstreamUnavailable',
      message: `有 ${failed.length} 个账号未收到通知，请在发送记录中核对后重试。`,
    })
  }
  return { sent, failed }
}

function approvalContext(ctx: NotificationWriteContext): ApprovalContext {
  return {
    db: ctx.db,
    logger: ctx.logger,
    actor: ctx.actor,
    meta: ctx.meta,
    ttlHours: ctx.ttlHours,
  }
}

export async function sendNotification(
  ctx: NotificationWriteContext,
  input: com.selfcommand.admin.notifications.send.$InputBody,
): Promise<NotificationSendResult> {
  const payload = normalizeNotificationSendPayload({
    recipients: input.recipients,
    subject: input.subject,
    contentMarkdown: input.contentMarkdown,
    ...(input.templateId !== undefined ? { templateId: input.templateId } : {}),
  })
  const approvalId = str(input.approvalId, 64)
  const required: ApprovalActionName = 'notifications.send'
  const approvalPayload: ApprovalPayload = { ...payload }

  if (approvalId) {
    let result: NotificationSendResult | undefined
    await executeWithApproval(approvalContext(ctx), {
      id: approvalId,
      action: required,
      payload: approvalPayload,
      run: async (trx) => {
        result = await deliverNotification(
          { ...ctx, db: trx, approvalId },
          payload,
          { requireAll: true },
        )
      },
    })
    if (!result) throw invalid('审批执行未返回发送结果')
    return result
  }

  if (!(await isSoleAdmin(ctx.db))) throw approvalRequired(required)
  return deliverNotification(ctx, payload)
}
