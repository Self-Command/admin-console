import { build } from '@atproto/lex-builder'
import { lexiconDocumentSchema } from '@atproto/lex-document'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { normalizeSpecifiers } from '../scripts/normalize-specifiers.mjs'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const sourceDir = join(packageRoot, 'lexicons')
const committedDir = join(packageRoot, 'src', 'lexicons')
const namespace = 'com.selfcommand.admin'

const expectedErrors: Record<string, string[]> = {
  [`${namespace}.role.list`]: ['Forbidden'],
  [`${namespace}.role.get`]: ['Forbidden', 'RoleNotFound'],
  [`${namespace}.role.create`]: ['Forbidden', 'RoleExists', 'InvalidRequest'],
  [`${namespace}.role.update`]: [
    'Forbidden',
    'RoleNotFound',
    'LastAdmin',
    'ApprovalRequired',
    'InvalidRequest',
  ],
  [`${namespace}.role.revoke`]: [
    'Forbidden',
    'ApprovalRequired',
    'RoleNotFound',
    'LastAdmin',
    'InvalidRequest',
  ],
  [`${namespace}.role.import`]: [
    'Forbidden',
    'InvalidRequest',
    'RoleExists',
    'ApprovalRequired',
  ],
  [`${namespace}.role.export`]: ['Forbidden'],
  [`${namespace}.audit.list`]: ['Forbidden'],
  [`${namespace}.audit.export`]: [
    'Forbidden',
    'InvalidRequest',
    'ExportTooLarge',
  ],
  [`${namespace}.account.list`]: ['Forbidden'],
  [`${namespace}.account.admin.info`]: [
    'Forbidden',
    'NotFound',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
  ],
  [`${namespace}.account.admin.update`]: [
    'Forbidden',
    'InvalidRequest',
    'ApprovalRequired',
    'NotFound',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
  ],
  [`${namespace}.account.admin.delete`]: [
    'Forbidden',
    'InvalidRequest',
    'ApprovalRequired',
    'NotFound',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
  ],
  [`${namespace}.account.invites.disable`]: [
    'Forbidden',
    'InvalidRequest',
    'NotFound',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
  ],
  [`${namespace}.account.get`]: ['Forbidden', 'AccountNotFound'],
  [`${namespace}.account.graph`]: [
    'Forbidden',
    'NotConfigured',
    'NotFound',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
    'InvalidRequest',
  ],
  [`${namespace}.account.posts`]: [
    'Forbidden',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
    'InvalidRequest',
  ],
  [`${namespace}.signature.searchAccounts`]: [
    'Forbidden',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
    'InvalidRequest',
  ],
  [`${namespace}.signature.findRelatedAccounts`]: [
    'Forbidden',
    'NotConfigured',
    'NotFound',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
  ],
  [`${namespace}.signature.findCorrelation`]: [
    'Forbidden',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
    'InvalidRequest',
  ],
  [`${namespace}.inbox.listNotifications`]: [
    'Forbidden',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
    'InvalidRequest',
  ],
  [`${namespace}.inbox.getUnreadCount`]: [
    'Forbidden',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
  ],
  [`${namespace}.inbox.getNotificationPreferences`]: [
    'Forbidden',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
  ],
  [`${namespace}.account.profile.get`]: ['Forbidden'],
  [`${namespace}.account.profile.update`]: ['Forbidden', 'InvalidRequest'],
  [`${namespace}.account.export`]: ['Forbidden', 'AccountNotFound'],
  [`${namespace}.account.batch.export`]: ['Forbidden', 'InvalidRequest'],
  [`${namespace}.chat.metadata`]: ['Forbidden'],
  [`${namespace}.content.search`]: [
    'Forbidden',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
  ],
  [`${namespace}.content.get`]: [
    'Forbidden',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
    'NotFound',
  ],
  [`${namespace}.content.imageSearch`]: [
    'Forbidden',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
  ],
  [`${namespace}.content.export`]: [
    'Forbidden',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
  ],
  [`${namespace}.analytics.export`]: [
    'Forbidden',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
  ],
  [`${namespace}.announcement.list`]: ['Forbidden', 'InvalidRequest'],
  [`${namespace}.announcement.get`]: ['Forbidden', 'NotFound'],
  [`${namespace}.announcement.create`]: ['Forbidden', 'InvalidRequest'],
  [`${namespace}.announcement.update`]: [
    'Forbidden',
    'NotFound',
    'InvalidRequest',
    'InvalidState',
  ],
  [`${namespace}.announcement.publish`]: [
    'Forbidden',
    'NotFound',
    'ApprovalRequired',
    'InvalidRequest',
    'InvalidState',
  ],
  [`${namespace}.announcement.archive`]: [
    'Forbidden',
    'NotFound',
    'ApprovalRequired',
    'InvalidRequest',
    'InvalidState',
  ],
  [`${namespace}.announcement.public`]: ['RateLimited'],
  [`${namespace}.settings.approvals.get`]: ['Forbidden'],
  [`${namespace}.settings.approvals.update`]: ['Forbidden', 'InvalidRequest'],
  [`${namespace}.moderation.report.list`]: [
    'Forbidden',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
  ],
  [`${namespace}.moderation.report.get`]: [
    'Forbidden',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
    'NotFound',
  ],
  [`${namespace}.moderation.report.act`]: [
    'Forbidden',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
    'NotFound',
    'InvalidRequest',
  ],
  [`${namespace}.moderation.queue.list`]: [
    'Forbidden',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
  ],
  [`${namespace}.moderation.queue.act`]: [
    'Forbidden',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
    'InvalidRequest',
  ],
  [`${namespace}.moderation.event.list`]: [
    'Forbidden',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
  ],
  [`${namespace}.moderation.event.get`]: [
    'Forbidden',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
    'NotFound',
  ],
  [`${namespace}.moderation.status.query`]: [
    'Forbidden',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
  ],
  [`${namespace}.moderation.events.batch.get`]: [
    'Forbidden',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
  ],
  [`${namespace}.moderation.act`]: [
    'Forbidden',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
    'ApprovalRequired',
    'InvalidRequest',
  ],
  [`${namespace}.moderation.scheduled.list`]: [
    'Forbidden',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
  ],
  [`${namespace}.moderation.scheduled.cancel`]: [
    'Forbidden',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
  ],
  [`${namespace}.moderation.account.overview`]: [
    'Forbidden',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
  ],
  [`${namespace}.moderation.random`]: ['Forbidden', 'NotFound'],
  [`${namespace}.moderation.analytics`]: [
    'Forbidden',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
  ],
  [`${namespace}.session.get`]: [],
  [`${namespace}.settings.get`]: ['Forbidden'],
  [`${namespace}.settings.update`]: [
    'Forbidden',
    'SettingsConflict',
    'InvalidRequest',
  ],
  [`${namespace}.settings.reset`]: [
    'Forbidden',
    'InvalidRequest',
    'ApprovalRequired',
  ],
  [`${namespace}.settings.history`]: ['Forbidden', 'InvalidRequest'],
  [`${namespace}.settings.export`]: ['Forbidden'],
  [`${namespace}.settings.import`]: ['Forbidden', 'InvalidRequest'],
  [`${namespace}.settings.public`]: ['RateLimited'],
  [`${namespace}.settings.logo.upload`]: [
    'Forbidden',
    'InvalidRequest',
    'PayloadTooLarge',
  ],
  [`${namespace}.navigation.get`]: [],
  [`${namespace}.preferences.get`]: [],
  [`${namespace}.preferences.update`]: ['InvalidRequest'],
  [`${namespace}.indexer.status`]: ['Forbidden'],
  [`${namespace}.indexer.pause`]: ['Forbidden'],
  [`${namespace}.indexer.resume`]: ['Forbidden'],
  [`${namespace}.system.status`]: ['Forbidden'],
  [`${namespace}.security.access.list`]: ['Forbidden'],
  [`${namespace}.security.blocked.list`]: ['Forbidden'],
  [`${namespace}.security.block`]: ['Forbidden', 'InvalidRequest'],
  [`${namespace}.security.unblock`]: ['Forbidden', 'InvalidRequest'],
  [`${namespace}.security.self`]: [],
  [`${namespace}.approval.list`]: ['Forbidden'],
  [`${namespace}.approval.create`]: ['Forbidden', 'InvalidRequest'],
  [`${namespace}.approval.approve`]: ['Forbidden', 'ApprovalState'],
  [`${namespace}.approval.reject`]: ['Forbidden', 'ApprovalState'],
  [`${namespace}.approval.cancel`]: ['Forbidden', 'ApprovalState'],
  [`${namespace}.dashboard.series`]: ['Forbidden', 'InvalidRequest'],
  [`${namespace}.verification.list`]: [
    'Forbidden',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
  ],
  [`${namespace}.verification.act`]: [
    'Forbidden',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
    'ApprovalRequired',
    'InvalidRequest',
  ],
  [`${namespace}.notifications.template.list`]: [
    'Forbidden',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
  ],
  [`${namespace}.notifications.template.act`]: [
    'Forbidden',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
    'NotFound',
    'InvalidRequest',
  ],
  [`${namespace}.notifications.send`]: [
    'Forbidden',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
    'ApprovalRequired',
    'InvalidRequest',
  ],
  [`${namespace}.policy.option.list`]: [
    'Forbidden',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
  ],
  [`${namespace}.policy.option.act`]: [
    'Forbidden',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
    'ApprovalRequired',
    'InvalidRequest',
  ],
  [`${namespace}.policy.set.list`]: [
    'Forbidden',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
  ],
  [`${namespace}.policy.set.get`]: [
    'Forbidden',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
    'NotFound',
  ],
  [`${namespace}.policy.set.act`]: [
    'Forbidden',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
    'ApprovalRequired',
    'InvalidRequest',
    'NotFound',
  ],
  [`${namespace}.policy.safelink.list`]: [
    'Forbidden',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
  ],
  [`${namespace}.policy.safelink.act`]: [
    'Forbidden',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
    'ApprovalRequired',
    'InvalidRequest',
    'NotFound',
  ],
  [`${namespace}.policy.safelink.events`]: [
    'Forbidden',
    'NotConfigured',
    'UpstreamAuthFailed',
    'UpstreamUnavailable',
    'RateLimited',
  ],
  [`${namespace}.policy.labeler.get`]: ['Forbidden'],
}

async function listFiles(dir: string, base = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path, base)))
    } else {
      files.push(relative(base, path).split(sep).join('/'))
    }
  }
  return files.sort()
}

const documents = new Map<string, Record<string, unknown>>()

for (const file of await listFiles(sourceDir)) {
  const raw = JSON.parse(await readFile(join(sourceDir, file), 'utf8'))
  const parsed = lexiconDocumentSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`Invalid lexicon ${file}: ${parsed.reason.message}`)
  }
  documents.set(parsed.value.id, raw)
}

const methodIds = [...documents.entries()]
  .filter(([id, doc]) => {
    if (id === `${namespace}.defs`) return false
    const main = (doc.defs as { main?: { type?: string } } | undefined)?.main
    return main?.type === 'query' || main?.type === 'procedure'
  })
  .map(([id]) => id)
  .sort()

describe('lexicon documents', () => {
  test('every method lives in the approved namespace and declares its auth', () => {
    expect(methodIds).toHaveLength(98)
    for (const id of methodIds) {
      expect(id.startsWith(`${namespace}.`)).toBe(true)
      if (
        id === `${namespace}.settings.public` ||
        id === `${namespace}.announcement.public`
      ) {
        expect(documents.get(id)!.description).toContain(
          'does not require authentication',
        )
        continue
      }
      expect(documents.get(id)!.description).toContain(
        'com.atproto.server.getServiceAuth',
      )
    }
  })

  test('role and audit result values stay within the permission matrix', () => {
    const defs = documents.get(`${namespace}.defs`)!.defs as {
      roleName: { knownValues?: string[] }
      auditResult: { knownValues?: string[] }
      permission: { knownValues?: string[] }
      approvalAction: { knownValues?: string[] }
    }
    expect(defs.roleName.knownValues).toEqual([
      'admin',
      'moderator',
      'operator',
      'viewer',
    ])
    expect(defs.auditResult.knownValues).toEqual([
      'success',
      'denied',
      'error',
    ])
    expect(defs.permission.knownValues).toEqual([
      'directory.read',
      'content.read',
      'content.write',
      'moderation.read',
      'moderation.write',
      'moderation.queue.manage',
      'verification.read',
      'verification.write',
      'notification.read',
      'notification.write',
      'policy.read',
      'policy.write',
      'account.write',
      'account.admin',
      'analytics.read',
      'role.read',
      'role.write',
      'audit.read',
      'settings.read',
      'settings.write',
      'security.read',
      'security.write',
      'chat.read',
      'announcement.read',
      'announcement.write',
      'announcement.publish',
    ])
    expect(defs.approvalAction.knownValues).toEqual([
      'settings.resetAll',
      'role.revoke',
      'role.demote',
      'role.import',
      'moderation.takedown',
      'moderation.batch',
      'moderation.label',
      'verification.grant',
      'verification.revoke',
      'account.admin.update',
      'account.admin.delete',
      'notifications.send',
      'policy.write',
      'announcement.publish',
      'announcement.archive',
    ])
  })

  test('error names match the reviewed contract', () => {
    const actual = Object.fromEntries(
      methodIds.map((id) => {
        const main = (
          documents.get(id)!.defs as {
            main: { errors?: { name: string }[] }
          }
        ).main
        return [id, (main.errors ?? []).map((error) => error.name)]
      }),
    )
    expect(actual).toEqual(expectedErrors)
  })

  test('generated types are in sync with the lexicon sources', async () => {
    const out = await mkdtemp(join(tmpdir(), 'lexgen-'))
    try {
      await build({
        lexicons: sourceDir,
        out,
        clear: true,
        lib: '@atproto/lex',
        indexFile: true,
        defaultExport: true,
      })
      const generated = await listFiles(out)
      const committed = await listFiles(committedDir)
      expect(generated).toEqual(committed)
      for (const file of generated) {
        const [fresh, current] = await Promise.all([
          readFile(join(out, file), 'utf8'),
          readFile(join(committedDir, file), 'utf8'),
        ])
        expect(normalizeSpecifiers(fresh), file).toBe(current)
      }
    } finally {
      await rm(out, { recursive: true, force: true })
    }
  })
})
