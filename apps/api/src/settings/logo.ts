import { com } from '@admin/lexicons'
import { LexServerError } from '@atproto/lex-server'
import { sql, type Kysely, type Transaction } from 'kysely'
import { insertAudit } from '../audit.js'
import type { Database } from '../db/types.js'
import type { SettingsContext } from './service.js'
import { defaultSection, normalizeStoredSection } from './defaults.js'

export const LOGO_MAX_BYTES = 128 * 1024
export const LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

export type LogoMime = (typeof LOGO_MIME_TYPES)[number]

export type LogoUploadResult = com.selfcommand.admin.settings.logo.upload.$OutputBody

export type BrandingAsset = {
  mime: string
  bytes: Buffer
  version: number
  updatedAt: Date
}

function invalid(message: string): LexServerError {
  return new LexServerError(400, { error: 'InvalidRequest', message })
}

function matchesMagicBytes(mime: LogoMime, bytes: Buffer): boolean {
  if (mime === 'image/png') {
    return (
      bytes.length > 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    )
  }
  if (mime === 'image/jpeg') {
    return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  }
  return (
    bytes.length > 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  )
}

export function decodeLogo(mime: string, data: string): { mime: LogoMime; bytes: Buffer } {
  if (!(LOGO_MIME_TYPES as readonly string[]).includes(mime)) {
    throw invalid('mime must be image/png, image/jpeg or image/webp')
  }
  const normalized = data.replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw invalid('data must be base64 encoded image content')
  }
  const bytes = Buffer.from(normalized, 'base64')
  if (bytes.length === 0) throw invalid('data must not be empty')
  if (bytes.length > LOGO_MAX_BYTES) {
    throw new LexServerError(413, {
      error: 'PayloadTooLarge',
      message: 'The logo must not exceed 128 KB',
    })
  }
  if (!matchesMagicBytes(mime as LogoMime, bytes)) {
    throw invalid('data does not match the declared image type')
  }
  return { mime: mime as LogoMime, bytes }
}

async function brandingRow(trx: Transaction<Database>) {
  return trx
    .selectFrom('admin.admin_setting')
    .selectAll()
    .where('section', '=', 'branding')
    .forUpdate()
    .executeTakeFirst()
}

export async function uploadLogo(
  ctx: SettingsContext,
  input: { mime: string; data: string },
): Promise<LogoUploadResult> {
  const action = 'com.selfcommand.admin.settings.logo.upload'
  try {
    const { mime, bytes } = decodeLogo(input.mime, input.data)

    return await ctx.db.transaction().execute(async (trx) => {
      const existing = await brandingRow(trx)
      const before = existing
        ? normalizeStoredSection('branding', existing.values)
        : defaultSection('branding')
      const assetRow = await trx
        .insertInto('admin.admin_branding_asset')
        .values({ id: 'logo', mime, bytes, version: 1, updated_by: ctx.actor })
        .onConflict((oc) =>
          oc.column('id').doUpdateSet({
            mime,
            bytes,
            version: sql`admin.admin_branding_asset.version + 1`,
            updated_by: ctx.actor,
            updated_at: sql`now()`,
          }),
        )
        .returningAll()
        .executeTakeFirstOrThrow()

      const url = `/branding/logo?v=${assetRow.version}`
      const after = {
        ...before,
        logoSource: 'upload' as const,
        logoUrl: url,
      }
      const version = (existing?.version ?? 0) + 1
      await trx
        .insertInto('admin.admin_setting')
        .values({ section: 'branding', version, values: after, updated_by: ctx.actor })
        .onConflict((oc) =>
          oc.column('section').doUpdateSet({
            version,
            values: after,
            updated_by: ctx.actor,
            updated_at: sql`now()`,
          }),
        )
        .execute()
      await trx
        .insertInto('admin.admin_setting_revision')
        .values({
          section: 'branding',
          version,
          actor_did: ctx.actor,
          reason: '上传 Logo',
          request_id: ctx.meta.requestId ?? null,
          before,
          after,
        })
        .execute()

      await insertAudit(trx, {
        actor: ctx.actor,
        action,
        targetType: 'settings',
        target: '品牌标识',
        result: 'success',
        detail: `已上传 Logo（${mime}，${bytes.length} 字节）`,
        before,
        after,
        ...ctx.meta,
      })

      return {
        url,
        version: assetRow.version,
        updatedAt: assetRow.updated_at.toISOString() as LogoUploadResult['updatedAt'],
      }
    })
  } catch (error) {
    if (error instanceof LexServerError) {
      await insertAudit(ctx.db, {
        actor: ctx.actor,
        action,
        targetType: 'settings',
        target: '品牌标识',
        result: 'error',
        detail: `操作未完成（错误码：${error.body.error}）`,
        ...ctx.meta,
      }).catch((auditError: unknown) => {
        ctx.logger.error('audit write failed', { action, error: auditError })
      })
    }
    throw error
  }
}

export async function getBrandingAsset(
  db: Kysely<Database>,
): Promise<BrandingAsset | null> {
  const row = await db
    .selectFrom('admin.admin_branding_asset')
    .select(['mime', 'bytes', 'version', 'updated_at'])
    .where('id', '=', 'logo')
    .executeTakeFirst()
  return row
    ? { mime: row.mime, bytes: row.bytes, version: row.version, updatedAt: row.updated_at }
    : null
}
