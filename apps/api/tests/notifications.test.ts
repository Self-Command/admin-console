import { LexServerError } from '@atproto/lex-server'
import { describe, expect, it } from 'vitest'
import { com } from '@admin/lexicons'
import { silentLogger } from '../src/logger.js'
import {
  actOnTemplate,
  deliverNotification,
  listTemplates,
  normalizeTemplateView,
  sendNotification,
  type NotificationWriteContext,
} from '../src/services/notifications.js'
import { createFakePds, createFakeUpstream } from './helpers/fake-upstream.js'

const SUBJECT = 'did:plc:target'
const SECOND = 'did:plc:second'
const CREATED_AT = '2026-10-29T08:00:00.000Z'

const TEMPLATE = {
  id: '1',
  name: '账号通知',
  subject: '账号通知',
  contentMarkdown: '您收到一条通知。',
  disabled: false,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
}

function fakeAdminCount(count: number) {
  return {
    selectFrom: () => ({
      select: () => ({
        where: () => ({
          executeTakeFirstOrThrow: async () => ({ count }),
        }),
      }),
    }),
  } as never
}

function writeContext(
  db: unknown,
  deps: { ozone: NotificationWriteContext['ozone']; pds: NotificationWriteContext['pds'] },
): NotificationWriteContext {
  return {
    db: db as NotificationWriteContext['db'],
    ozone: deps.ozone,
    pds: deps.pds,
    logger: silentLogger,
    senderDid: 'did:web:admin.test',
    actor: 'did:plc:moderator',
    meta: {},
    ttlHours: 24,
  }
}

function ozoneForTemplates() {
  return createFakeUpstream((nsid) => {
    if (nsid === 'tools.ozone.communication.listTemplates') {
      return { communicationTemplates: [TEMPLATE] }
    }
    if (nsid === 'tools.ozone.communication.createTemplate') return TEMPLATE
    if (nsid === 'tools.ozone.communication.updateTemplate') return TEMPLATE
    return {}
  })
}

describe('notification template normalization', () => {
  it('maps a template and falls back to an empty subject', () => {
    expect(normalizeTemplateView({ ...TEMPLATE, subject: undefined })).toEqual({
      id: '1',
      name: '账号通知',
      subject: '',
      contentMarkdown: '您收到一条通知。',
      disabled: false,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    })
  })

  it('rejects templates without required fields', () => {
    expect(() => normalizeTemplateView({ ...TEMPLATE, id: undefined })).toThrow(
      /无法识别的通知模板/,
    )
    expect(() => normalizeTemplateView({ ...TEMPLATE, disabled: undefined })).toThrow(
      /无法识别的通知模板/,
    )
  })
})

describe('notification template listing', () => {
  it('reports sending availability from the mail credential', async () => {
    const configured = await listTemplates({
      ozone: ozoneForTemplates(),
      pds: createFakePds(),
      logger: silentLogger,
      senderDid: 'did:web:admin.test',
    })
    expect(configured).toMatchObject({
      sendAvailable: true,
      templates: [{ id: '1', name: '账号通知' }],
    })
    expect(configured.sendUnavailableReason).toBeUndefined()

    const unconfiguredPds = createFakeUpstream(() => ({}), {
      name: 'PDS',
      configured: false,
    })
    const unavailable = await listTemplates({
      ozone: ozoneForTemplates(),
      pds: unconfiguredPds,
      logger: silentLogger,
      senderDid: 'did:web:admin.test',
    })
    expect(unavailable).toMatchObject({
      sendAvailable: false,
      sendUnavailableReason: '尚未配置邮件发送凭据，请联系部署管理员完成配置后重试。',
    })
  })
})

describe('notification template actions', () => {
  it('creates a template with the operator as author', async () => {
    const ozone = ozoneForTemplates()
    const ctx = writeContext({}, { ozone, pds: createFakePds() })

    const result = await actOnTemplate(ctx, {
      action: 'create',
      name: '账号通知',
      subject: '账号通知',
      contentMarkdown: '您收到一条通知。',
    })

    expect(result).toMatchObject({ template: { id: '1', name: '账号通知' } })
    const call = ozone.calls.find(
      (entry) => entry.nsid === 'tools.ozone.communication.createTemplate',
    )
    expect(call?.options?.body).toMatchObject({
      name: '账号通知',
      createdBy: 'did:plc:moderator',
    })
  })

  it('falls back to the template list when the service returns no template body', async () => {
    const ozone = createFakeUpstream((nsid) => {
      if (nsid === 'tools.ozone.communication.createTemplate') return {}
      if (nsid === 'tools.ozone.communication.listTemplates') {
        return { communicationTemplates: [TEMPLATE] }
      }
      return {}
    })
    const ctx = writeContext({}, { ozone, pds: createFakePds() })

    await expect(
      actOnTemplate(ctx, {
        action: 'create',
        name: '账号通知',
        subject: '账号通知',
        contentMarkdown: '您收到一条通知。',
      }),
    ).resolves.toMatchObject({ template: { id: '1' } })
  })

  it('requires content when updating and only an identifier when deleting', async () => {
    const ctx = writeContext({}, { ozone: ozoneForTemplates(), pds: createFakePds() })
    await expect(actOnTemplate(ctx, { action: 'update', id: '1' })).rejects.toMatchObject({
      status: 400,
      body: { error: 'InvalidRequest' },
    })
    await expect(
      actOnTemplate(ctx, { action: 'delete', id: '1', name: '账号通知' }),
    ).rejects.toMatchObject({ status: 400, body: { error: 'InvalidRequest' } })
    await expect(
      actOnTemplate(ctx, { action: 'delete', id: '1' }),
    ).resolves.toEqual({})
  })
})

describe('notification delivery', () => {
  const payload = {
    recipients: [SUBJECT],
    subject: '账号通知',
    contentMarkdown: '您收到一条通知。',
  } satisfies com.selfcommand.admin.notifications.send.$InputBody

  it('requires an approval to send while other administrators exist', async () => {
    const pds = createFakePds()
    const ctx = writeContext(fakeAdminCount(2), {
      ozone: ozoneForTemplates(),
      pds,
    })
    await expect(sendNotification(ctx, payload)).rejects.toMatchObject({
      status: 409,
      body: { error: 'ApprovalRequired' },
    })
    expect(pds.calls).toHaveLength(0)
  })

  it('sends through the PDS and records per-account failures', async () => {
    const pds = createFakeUpstream(
      (nsid, options) => {
        const body = options?.body as { recipientDid?: string } | undefined
        if (body?.recipientDid === SECOND) {
          throw new LexServerError(502, {
            error: 'UpstreamUnavailable',
            message: '邮件服务未确认送达，请稍后重试。',
          })
        }
        return { sent: true }
      },
      { name: 'PDS' },
    )
    const ctx = writeContext(fakeAdminCount(1), { ozone: ozoneForTemplates(), pds })

    const result = await sendNotification(ctx, {
      ...payload,
      recipients: [SUBJECT, SECOND],
    })

    expect(result).toEqual({
      sent: 1,
      failed: [{ recipient: SECOND, message: '邮件服务未确认送达，请稍后重试。' }],
    })
    const call = pds.calls.find((entry) => entry.nsid === 'com.atproto.admin.sendEmail')
    expect(call?.options?.body).toMatchObject({
      recipientDid: SUBJECT,
      subject: '账号通知',
      content: '您收到一条通知。',
      senderDid: 'did:web:admin.test',
    })
  })

  it('treats an unconfirmed delivery as a failure', async () => {
    const pds = createFakeUpstream(() => ({ sent: false }), { name: 'PDS' })
    const result = await deliverNotification(
      {
        pds,
        logger: silentLogger,
        senderDid: 'did:web:admin.test',
        db: fakeAdminCount(1) as never,
        actor: 'did:plc:moderator',
        meta: {},
      },
      payload,
    )
    expect(result).toMatchObject({ sent: 0, failed: [{ recipient: SUBJECT }] })
  })
})
