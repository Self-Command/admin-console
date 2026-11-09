import { com } from '@admin/lexicons'
import { LexServerError } from '@atproto/lex-server'
import { sql, type Kysely } from 'kysely'
import { insertAudit, type RequestMeta } from '../audit.js'
import type { ApprovalActionName, Database } from '../db/types.js'
import type { Logger } from '../logger.js'
import {
  APPROVAL_ACTIONS,
  APPROVAL_ACTION_LABELS,
} from '../services/approvals.js'

export type ApprovalScopeView = com.selfcommand.admin.settings.approvals.get.$OutputBody

export type ApprovalScopeContext = {
  db: Kysely<Database>
  logger: Logger
  actor: string
  meta: RequestMeta
}

export const BUILT_IN_APPROVAL_ACTIONS: readonly ApprovalActionName[] = [
  'settings.resetAll',
  'role.revoke',
  'role.demote',
  'role.import',
  'moderation.takedown',
  'moderation.batch',
  'verification.grant',
  'verification.revoke',
  'account.admin.update',
  'account.admin.delete',
  'notifications.send',
  'policy.write',
  'announcement.publish',
  'announcement.archive',
]

const CACHE_TTL_MS = 5_000

const additionalCache = new WeakMap<
  Kysely<Database>,
  { actions: ApprovalActionName[]; expiresAt: number }
>()

function isAvailable(value: unknown): value is ApprovalActionName {
  return (
    typeof value === 'string' &&
    (APPROVAL_ACTIONS as readonly string[]).includes(value)
  )
}

function parseStored(value: unknown): ApprovalActionName[] {
  const record =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as { additionalActions?: unknown })
      : undefined
  const entries = Array.isArray(record?.additionalActions)
    ? record.additionalActions
    : []
  const unique: ApprovalActionName[] = []
  for (const entry of entries) {
    if (isAvailable(entry) && !unique.includes(entry)) unique.push(entry)
  }
  return unique
}

export function clearApprovalScopeCache(db: Kysely<Database>): void {
  additionalCache.delete(db)
}

async function readStored(db: Kysely<Database>): Promise<{
  actions: ApprovalActionName[]
  version: number
  updatedAt?: Date
}> {
  const row = await db
    .selectFrom('admin.admin_setting')
    .select(['values', 'version', 'updated_at'])
    .where('section', '=', 'approvals')
    .executeTakeFirst()
  return {
    actions: parseStored(row?.values),
    version: row?.version ?? 0,
    ...(row ? { updatedAt: row.updated_at } : {}),
  }
}

export async function loadApprovalScope(db: Kysely<Database>): Promise<ApprovalScopeView> {
  const stored = await readStored(db)
  return {
    builtInActions: [...BUILT_IN_APPROVAL_ACTIONS],
    additionalActions: stored.actions,
    availableActions: [...APPROVAL_ACTIONS],
    version: stored.version,
    ...(stored.updatedAt
      ? { updatedAt: stored.updatedAt.toISOString() as ApprovalScopeView['updatedAt'] }
      : {}),
  }
}

async function additionalActionsFor(db: Kysely<Database>): Promise<ApprovalActionName[]> {
  const cached = additionalCache.get(db)
  if (cached && cached.expiresAt > Date.now()) return cached.actions
  const stored = await readStored(db)
  additionalCache.set(db, {
    actions: stored.actions,
    expiresAt: Date.now() + CACHE_TTL_MS,
  })
  return stored.actions
}

export async function isApprovalRequiredFor(
  db: Kysely<Database>,
  action: ApprovalActionName,
): Promise<boolean> {
  if (BUILT_IN_APPROVAL_ACTIONS.includes(action)) return true
  return (await additionalActionsFor(db)).includes(action)
}

export async function updateApprovalScope(
  ctx: ApprovalScopeContext,
  input: { additionalActions: string[]; reason?: string },
): Promise<ApprovalScopeView> {
  const requested: ApprovalActionName[] = []
  for (const entry of input.additionalActions) {
    if (!isAvailable(entry)) {
      throw new LexServerError(400, {
        error: 'InvalidRequest',
        message: `不支持的动作：${entry}。可用动作：${APPROVAL_ACTIONS.join('、')}`,
      })
    }
    if (BUILT_IN_APPROVAL_ACTIONS.includes(entry)) {
      throw new LexServerError(400, {
        error: 'InvalidRequest',
        message: `「${APPROVAL_ACTION_LABELS[entry]}」属于内置必审动作，始终需要审批，不能通过追加项调整。`,
      })
    }
    if (!requested.includes(entry)) requested.push(entry)
  }

  const outcome = await ctx.db.transaction().execute(async (trx) => {
    const row = await trx
      .selectFrom('admin.admin_setting')
      .selectAll()
      .where('section', '=', 'approvals')
      .forUpdate()
      .executeTakeFirst()
    const stored = parseStored(row?.values)
    const merged = APPROVAL_ACTIONS.filter(
      (action) => stored.includes(action) || requested.includes(action),
    )
    const currentVersion = row?.version ?? 0
    const added = merged.filter((action) => !stored.includes(action))

    if (!added.length) {
      return {
        scope: {
          builtInActions: [...BUILT_IN_APPROVAL_ACTIONS],
          additionalActions: merged,
          availableActions: [...APPROVAL_ACTIONS],
          version: currentVersion,
          ...(row
            ? {
                updatedAt: row.updated_at.toISOString() as ApprovalScopeView['updatedAt'],
              }
            : {}),
        } satisfies ApprovalScopeView,
        version: currentVersion,
      }
    }

    const version = currentVersion + 1
    const values = { additionalActions: merged }
    const updated = await trx
      .insertInto('admin.admin_setting')
      .values({
        section: 'approvals',
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

    await trx
      .insertInto('admin.admin_setting_revision')
      .values({
        section: 'approvals',
        version,
        actor_did: ctx.actor,
        reason: input.reason?.trim() || null,
        request_id: ctx.meta.requestId ?? null,
        before: { additionalActions: stored },
        after: values,
      })
      .execute()

    const names = added.map((action) => APPROVAL_ACTION_LABELS[action]).join('、')
    await insertAudit(trx, {
      actor: ctx.actor,
      action: 'com.selfcommand.admin.settings.approvals.update',
      targetType: 'settings',
      target: '审批范围',
      result: 'success',
      detail: input.reason?.trim()
        ? `追加需审批动作：${names}（${input.reason.trim()}）`
        : `追加需审批动作：${names}`,
      before: { additionalActions: stored },
      after: values,
      ...ctx.meta,
    })

    return {
      scope: {
        builtInActions: [...BUILT_IN_APPROVAL_ACTIONS],
        additionalActions: merged,
        availableActions: [...APPROVAL_ACTIONS],
        version,
        updatedAt: updated.updated_at.toISOString() as ApprovalScopeView['updatedAt'],
      } satisfies ApprovalScopeView,
      version,
    }
  })

  if (outcome.version !== 0) clearApprovalScopeCache(ctx.db)
  return outcome.scope
}
