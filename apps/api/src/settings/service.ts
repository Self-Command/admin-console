import { com } from '@admin/lexicons'
import { LexServerError } from '@atproto/lex-server'
import { sql, type Kysely, type Selectable, type Transaction } from 'kysely'
import { insertAudit, insertAuditSafely, type RequestMeta } from '../audit.js'
import type { AdminSettingTable, Database } from '../db/types.js'
import type { Logger } from '../logger.js'
import { decodeCursor, encodeCursor } from '../pagination.js'
import {
  DEFAULT_SETTINGS,
  SETTING_SECTIONS,
  defaultSection,
  isSettingSection,
  normalizeStoredSection,
  sectionsEqual,
  validateSection,
  type BrandingSettings,
  type LoginSettings,
  type SectionKey,
  type SettingsSections,
  type ThemeSettings,
} from './defaults.js'

export type SettingMetaView = com.selfcommand.admin.defs.SettingMeta
export type SettingsGetResult = com.selfcommand.admin.settings.get.$OutputBody
export type SettingsUpdateInput = com.selfcommand.admin.settings.update.$InputBody
export type SettingsResetInput = com.selfcommand.admin.settings.reset.$InputBody
export type SettingsHistoryResult = com.selfcommand.admin.settings.history.$OutputBody
export type SettingRevisionView = com.selfcommand.admin.defs.SettingRevision
export type SettingsExportResult = com.selfcommand.admin.settings.export.$OutputBody
export type SettingsImportInput = com.selfcommand.admin.settings.import.$InputBody
export type SettingsImportResult = com.selfcommand.admin.settings.import.$OutputBody
export type PublicSettingsResult = com.selfcommand.admin.settings.public.$OutputBody

const REVISION_RETENTION = 50

export type SettingsContext = {
  db: Kysely<Database>
  logger: Logger
  actor: string
  meta: RequestMeta
  trx?: Transaction<Database>
  approvalId?: string
}

async function withTransaction<T>(
  ctx: SettingsContext,
  run: (trx: Transaction<Database>) => Promise<T>,
): Promise<T> {
  if (ctx.trx) return run(ctx.trx)
  return ctx.db.transaction().execute(run)
}

type SectionRow = Selectable<AdminSettingTable>

function datetime(value: Date): SettingMetaView['updatedAt'] {
  return value.toISOString() as SettingMetaView['updatedAt']
}

function currentValue<K extends SectionKey>(
  row: SectionRow | undefined,
  section: K,
): SettingsSections[K] {
  return row ? normalizeStoredSection(section, row.values) : defaultSection(section)
}

function metaOf(section: SectionKey, row: SectionRow): SettingMetaView {
  return {
    section,
    version: row.version,
    updatedAt: datetime(row.updated_at),
    ...(row.updated_by ? { updatedBy: row.updated_by as SettingMetaView['updatedBy'] } : {}),
  }
}

function assemble(
  rows: SectionRow[],
): { settings: SettingsSections; meta: SettingMetaView[] } {
  const bySection = new Map(rows.map((row) => [row.section, row]))
  const settings = {} as SettingsSections
  for (const section of SETTING_SECTIONS) {
    const row = bySection.get(section)
    settings[section] = currentValue(row, section) as never
  }
  const meta = rows
    .filter((row) => isSettingSection(row.section))
    .sort(
      (a, b) => SETTING_SECTIONS.indexOf(a.section as SectionKey) -
        SETTING_SECTIONS.indexOf(b.section as SectionKey),
    )
    .map((row) => metaOf(row.section as SectionKey, row))
  return { settings, meta }
}

export async function loadSettings(
  db: Kysely<Database> | Transaction<Database>,
): Promise<SettingsGetResult> {
  const rows = await db.selectFrom('admin.admin_setting').selectAll().orderBy('section').execute()
  const { settings, meta } = assemble(rows)
  return { settings, defaults: structuredClone(DEFAULT_SETTINGS), meta }
}

function publicBranding(value: BrandingSettings): PublicSettingsResult['branding'] {
  return {
    name: value.name,
    shortName: value.shortName,
    description: value.description,
    logoSource: value.logoSource,
    ...(value.logoUrl !== undefined ? { logoUrl: value.logoUrl } : {}),
    ...(value.faviconUrl !== undefined ? { faviconUrl: value.faviconUrl } : {}),
    ...(value.supportUrl !== undefined ? { supportUrl: value.supportUrl } : {}),
    ...(value.docsUrl !== undefined ? { docsUrl: value.docsUrl } : {}),
  }
}

function publicTheme(value: ThemeSettings): PublicSettingsResult['theme'] {
  return {
    primaryLight: value.primaryLight,
    primaryDark: value.primaryDark,
    accentLight: value.accentLight,
    accentDark: value.accentDark,
    radius: value.radius,
    density: value.density,
    fontFamily: value.fontFamily,
    defaultMode: value.defaultMode,
  }
}

function publicLogin(value: LoginSettings): PublicSettingsResult['login'] {
  return {
    headline: value.headline,
    subheadline: value.subheadline,
    footer: value.footer,
    background: value.background,
    legalLinks: value.legalLinks.map((link) => ({ label: link.label, url: link.url })),
  }
}

export async function loadPublicSettings(
  db: Kysely<Database>,
): Promise<PublicSettingsResult> {
  const rows = await db
    .selectFrom('admin.admin_setting')
    .selectAll()
    .where('section', 'in', ['branding', 'theme', 'login'])
    .execute()
  const bySection = new Map(rows.map((row) => [row.section, row]))
  const branding = publicBranding(currentValue(bySection.get('branding'), 'branding'))
  const theme = publicTheme(currentValue(bySection.get('theme'), 'theme'))
  const login = publicLogin(currentValue(bySection.get('login'), 'login'))
  const versions = rows.map((row) => row.version)
  const timestamps = rows.map((row) => row.updated_at.getTime())
  return {
    branding,
    theme,
    login,
    version: versions.length > 0 ? Math.max(...versions) : 0,
    ...(timestamps.length > 0
      ? { updatedAt: new Date(Math.max(...timestamps)).toISOString() as PublicSettingsResult['updatedAt'] }
      : {}),
  }
}

function requireSection(section: unknown): SectionKey {
  if (!isSettingSection(section)) {
    throw new LexServerError(400, {
      error: 'InvalidRequest',
      message: 'section is not a known settings partition',
    })
  }
  return section
}

async function pruneRevisions(
  trx: Transaction<Database>,
  section: SectionKey,
): Promise<void> {
  await sql`
    delete from admin.admin_setting_revision
    where section = ${section}
      and id not in (
        select id from admin.admin_setting_revision
        where section = ${section}
        order by id desc
        limit ${REVISION_RETENTION}
      )
  `.execute(trx)
}

async function writeRevision(
  trx: Transaction<Database>,
  input: {
    section: SectionKey
    version: number
    actor: string
    reason?: string
    requestId?: string
    before: unknown
    after: unknown
  },
): Promise<void> {
  await trx
    .insertInto('admin.admin_setting_revision')
    .values({
      section: input.section,
      version: input.version,
      actor_did: input.actor,
      reason: input.reason ?? null,
      request_id: input.requestId ?? null,
      before: input.before,
      after: input.after,
    })
    .execute()
}

const SECTION_LABELS: Record<SectionKey, string> = {
  branding: '品牌标识',
  theme: '外观主题',
  login: '登录页',
  navigation: '导航菜单',
  features: '功能入口',
  ui: '界面默认值',
  integrations: '外部系统',
  audit: '审计导出',
  indexer: '索引监控',
}

function sectionLabel(value: string): string {
  return SECTION_LABELS[value as SectionKey] ?? value
}

function sectionList(values: readonly string[]): string {
  return values.map(sectionLabel).join('、')
}

async function auditFailure(
  ctx: SettingsContext,
  action: string,
  target: string,
  error: unknown,
): Promise<void> {
  if (!(error instanceof LexServerError)) return
  await insertAuditSafely(ctx.db, ctx.logger, {
    actor: ctx.actor,
    action,
    targetType: 'settings',
    target,
    result: 'error',
    detail: `操作未完成（错误码：${error.body.error}）`,
    ...ctx.meta,
  })
}

async function pruneLogoAsset(
  trx: Transaction<Database>,
  section: SectionKey,
  values: SettingsSections[SectionKey],
): Promise<void> {
  if (section !== 'branding') return
  if ((values as BrandingSettings).logoSource === 'upload') return
  await trx.deleteFrom('admin.admin_branding_asset').where('id', '=', 'logo').execute()
}

export async function updateSettings(
  ctx: SettingsContext,
  input: SettingsUpdateInput,
): Promise<SettingMetaView> {
  const action = 'com.selfcommand.admin.settings.update'
  const section = requireSection(input.section)
  try {
    const values = validateSection(section, input.values)
    const expectedVersion = input.expectedVersion ?? 0
    const reason = input.reason?.trim() || undefined

    return await withTransaction(ctx, async (trx) => {
      const existing = await trx
        .selectFrom('admin.admin_setting')
        .selectAll()
        .where('section', '=', section)
        .forUpdate()
        .executeTakeFirst()
      const currentVersion = existing?.version ?? 0
      if (expectedVersion !== currentVersion) {
        throw new LexServerError(409, {
          error: 'SettingsConflict',
          message: 'The settings were changed by another administrator; reload and retry',
        })
      }

      const before = currentValue(existing, section)
      const version = currentVersion + 1
      const row = await trx
        .insertInto('admin.admin_setting')
        .values({
          section,
          version,
          values,
          updated_by: ctx.actor,
        })
        .onConflict((oc) =>
          oc.column('section').doUpdateSet({
            version,
            values,
            updated_by: ctx.actor,
            updated_at: sql`now()`,
          }),
        )
        .returningAll()
        .executeTakeFirstOrThrow()

      await writeRevision(trx, {
        section,
        version,
        actor: ctx.actor,
        reason,
        requestId: ctx.meta.requestId,
        before,
        after: values,
      })
      await pruneRevisions(trx, section)
      await pruneLogoAsset(trx, section, values)

      await insertAudit(trx, {
        actor: ctx.actor,
        action,
        targetType: 'settings',
        target: sectionLabel(section),
        result: 'success',
        detail: reason
          ? `更新「${sectionLabel(section)}」设置：${reason}`
          : `更新「${sectionLabel(section)}」设置`,
        before,
        after: values,
        ...ctx.meta,
      })

      return metaOf(section, row)
    })
  } catch (error) {
    await auditFailure(ctx, action, section, error)
    throw error
  }
}

export async function resetSettings(
  ctx: SettingsContext,
  input: SettingsResetInput,
): Promise<{ settings: SettingsSections; meta: SettingMetaView[] }> {
  const action = 'com.selfcommand.admin.settings.reset'
  const requested = input.section === undefined ? undefined : requireSection(input.section)
  try {
    return await withTransaction(ctx, async (trx) => {
      let query = trx.selectFrom('admin.admin_setting').selectAll().forUpdate()
      if (requested) query = query.where('section', '=', requested)
      const rows = await query.execute()
      const targets = rows.filter((row) => isSettingSection(row.section)) as Array<
        SectionRow & { section: SectionKey }
      >
      for (const row of targets) {
        const section = row.section
        const values = defaultSection(section)
        const version = row.version + 1
        await trx
          .updateTable('admin.admin_setting')
          .set({ values, version, updated_by: ctx.actor, updated_at: sql`now()` })
          .where('section', '=', section)
          .execute()
        await writeRevision(trx, {
          section,
          version,
          actor: ctx.actor,
          reason: input.reason?.trim() || '恢复默认值',
          requestId: ctx.meta.requestId,
          before: normalizeStoredSection(section, row.values),
          after: values,
        })
        await pruneRevisions(trx, section)
        await pruneLogoAsset(trx, section, values)
      }

      if (targets.length > 0) {
        await insertAudit(trx, {
          actor: ctx.actor,
          action,
          targetType: 'settings',
          target: requested ? sectionLabel(requested) : '全部分区',
          result: 'success',
          detail: `恢复以下分区的默认值：${sectionList(targets.map((row) => row.section))}`,
          ...ctx.meta,
          ...(ctx.approvalId ? { approvalId: ctx.approvalId } : {}),
        })
      }

      return loadSettings(trx)
    })
  } catch (error) {
    await auditFailure(ctx, action, requested ?? 'all', error)
    throw error
  }
}

export async function settingsHistory(
  db: Kysely<Database>,
  params: { section?: string; cursor?: string; limit: number },
): Promise<SettingsHistoryResult> {
  const section = requireSection(params.section)
  let cursor: string | undefined
  if (params.cursor !== undefined) {
    const decoded = decodeCursor(params.cursor)
    if (!decoded || !/^\d{1,19}$/.test(decoded)) {
      throw new LexServerError(400, { error: 'InvalidRequest', message: 'invalid cursor' })
    }
    cursor = decoded
  }

  const build = (withCursor: boolean) => {
    let query = db.selectFrom('admin.admin_setting_revision').where('section', '=', section)
    if (withCursor && cursor) query = query.where(sql<boolean>`id < ${cursor}::bigint`)
    return query
  }

  const rows = await build(true).selectAll().orderBy('id', 'desc').limit(params.limit).execute()
  const total = await build(false)
    .select(sql<number>`count(*)::int`.as('count'))
    .executeTakeFirstOrThrow()
  const last = rows.at(-1)

  return {
    total: total.count,
    revisions: rows.map((row) => ({
      id: Number(row.id),
      section,
      version: row.version,
      actor: row.actor_did as SettingRevisionView['actor'],
      ...(row.reason ? { reason: row.reason } : {}),
      ...(row.request_id ? { requestId: row.request_id } : {}),
      createdAt: datetime(row.created_at),
      before: (row.before ?? {}) as SettingRevisionView['before'],
      after: (row.after ?? {}) as SettingRevisionView['after'],
    })),
    ...(rows.length === params.limit && last ? { cursor: encodeCursor(String(last.id)) } : {}),
  }
}

export async function exportSettings(
  db: Kysely<Database>,
): Promise<SettingsExportResult> {
  const loaded = await loadSettings(db)
  return {
    exportedAt: new Date().toISOString() as SettingsExportResult['exportedAt'],
    sections: loaded.settings,
    meta: loaded.meta,
  }
}

export async function importSettings(
  ctx: SettingsContext,
  input: SettingsImportInput,
): Promise<SettingsImportResult> {
  const action = 'com.selfcommand.admin.settings.import'
  try {
    const incoming = input.sections as Record<string, unknown>
    const sections = SETTING_SECTIONS.filter((section) => incoming[section] !== undefined)
    if (sections.length === 0) {
      throw new LexServerError(400, {
        error: 'InvalidRequest',
        message: 'import must contain at least one settings partition',
      })
    }
    const validated = new Map<SectionKey, SettingsSections[SectionKey]>()
    for (const section of sections) {
      validated.set(section, validateSection(section, incoming[section]))
    }
    const reason = input.reason?.trim() || '导入设置文件'

    return await withTransaction(ctx, async (trx) => {
      const rows = await trx
        .selectFrom('admin.admin_setting')
        .selectAll()
        .where('section', 'in', sections)
        .forUpdate()
        .execute()
      const bySection = new Map(rows.map((row) => [row.section, row]))
      const changedSections: SectionKey[] = []

      for (const section of sections) {
        const values = validated.get(section) as SettingsSections[SectionKey]
        const existing = bySection.get(section)
        const before = currentValue(existing, section)
        if (sectionsEqual(before, values)) continue

        const version = (existing?.version ?? 0) + 1
        await trx
          .insertInto('admin.admin_setting')
          .values({ section, version, values, updated_by: ctx.actor })
          .onConflict((oc) =>
            oc.column('section').doUpdateSet({
              version,
              values,
              updated_by: ctx.actor,
              updated_at: sql`now()`,
            }),
          )
          .execute()
        await writeRevision(trx, {
          section,
          version,
          actor: ctx.actor,
          reason,
          requestId: ctx.meta.requestId,
          before,
          after: values,
        })
        await pruneRevisions(trx, section)
        await pruneLogoAsset(trx, section, values)
        changedSections.push(section)
      }

      if (changedSections.length > 0) {
        await insertAudit(trx, {
          actor: ctx.actor,
          action,
          targetType: 'settings',
          target: sectionList(changedSections),
          result: 'success',
          detail: `导入设置（${sectionList(changedSections)}）：${reason}`,
          ...ctx.meta,
        })
      }

      const loaded = await loadSettings(trx)
      return { ...loaded, changedSections }
    })
  } catch (error) {
    await auditFailure(ctx, action, 'import', error)
    throw error
  }
}
