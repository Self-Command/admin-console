import { com } from '@admin/lexicons'
import { LexServerError } from '@atproto/lex-server'
import { sql, type Kysely } from 'kysely'
import type { Config } from '../config.js'
import type { AccountStatus, Database } from '../db/types.js'
import type { Logger } from '../logger.js'
import { pruneAccess } from './security.js'

export type DashboardSeriesResult = com.selfcommand.admin.dashboard.series.$OutputBody
export type DailyMetricView = com.selfcommand.admin.defs.DailyMetric

export const SERIES_DAYS = [7, 30, 90] as const
export const BACKFILL_DAYS = 30

const STATUSES: readonly AccountStatus[] = [
  'active',
  'deactivated',
  'suspended',
  'takendown',
  'deleted',
  'unknown',
]

function emptyStatusCounts(): Record<AccountStatus, number> {
  return {
    active: 0,
    deactivated: 0,
    suspended: 0,
    takendown: 0,
    deleted: 0,
    unknown: 0,
  }
}

type ZonedParts = { year: number; month: number; day: number }

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  return { year: read('year'), month: read('month'), day: read('day') }
}

export function dayKey(date: Date, timeZone: string): string {
  const { year, month, day } = zonedParts(date, timeZone)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${year}-${pad(month)}-${pad(day)}`
}

export function shiftDay(day: string, offset: number): string {
  const [year, month, date] = day.split('-').map(Number)
  const shifted = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (date ?? 1) + offset))
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
}

function offsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at)
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  const asUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour') % 24,
    read('minute'),
    read('second'),
  )
  return asUtc - at.getTime()
}

/** UTC instant of local midnight for a YYYY-MM-DD day in the report timezone. */
export function zonedDayStart(day: string, timeZone: string): Date {
  const [year, month, date] = day.split('-').map(Number)
  const utc = Date.UTC(year ?? 0, (month ?? 1) - 1, date ?? 1)
  return new Date(utc - offsetMs(new Date(utc), timeZone))
}

export type MetricOptions = {
  now: Date
  timeZone: string
  indexerEnabled: boolean
}

export async function computeDailyMetric(
  db: Kysely<Database>,
  day: string,
  opts: MetricOptions,
): Promise<DailyMetricView> {
  const start = zonedDayStart(day, opts.timeZone)
  const end = zonedDayStart(shiftDay(day, 1), opts.timeZone)
  const activeSince = new Date(opts.now.getTime() - 24 * 60 * 60 * 1000)

  const statusCounts = emptyStatusCounts()
  let accountsTotal = 0
  let accountsNew = 0
  let accountsActive24h = 0

  if (opts.indexerEnabled) {
    const total = await db
      .selectFrom('admin.account_directory')
      .select(sql<number>`count(*)::int`.as('count'))
      .executeTakeFirstOrThrow()
    accountsTotal = total.count

    const groups = await db
      .selectFrom('admin.account_directory')
      .select(['status', sql<number>`count(*)::int`.as('count')])
      .groupBy('status')
      .execute()
    for (const group of groups) {
      if (STATUSES.includes(group.status)) {
        statusCounts[group.status] = group.count
      } else {
        statusCounts.unknown += group.count
      }
    }

    const created = await db
      .selectFrom('admin.account_directory')
      .select(sql<number>`count(*)::int`.as('count'))
      .where('first_seen_at', '>=', start)
      .where('first_seen_at', '<', end)
      .executeTakeFirstOrThrow()
    accountsNew = created.count

    const active = await db
      .selectFrom('admin.account_directory')
      .select(sql<number>`count(*)::int`.as('count'))
      .where('last_event_at', '>=', activeSince)
      .where('last_event_at', '<=', opts.now)
      .executeTakeFirstOrThrow()
    accountsActive24h = active.count
  }

  const audit = await db
    .selectFrom('admin.admin_audit_event')
    .select([
      sql<number>`count(*)::int`.as('total'),
      sql<number>`count(*) filter (where result = 'denied')::int`.as('denied'),
    ])
    .where('created_at', '>=', start)
    .where('created_at', '<', end)
    .executeTakeFirstOrThrow()

  return {
    day,
    accountsTotal,
    accountsNew,
    accountsActive24h,
    statusCounts,
    auditTotal: audit.total,
    auditDenied: audit.denied,
  }
}

function toValues(point: DailyMetricView, generatedAt: Date) {
  return {
    day: point.day,
    accounts_total: point.accountsTotal,
    accounts_new: point.accountsNew,
    accounts_active_24h: point.accountsActive24h,
    status_counts: point.statusCounts as unknown as Record<string, number>,
    audit_total: point.auditTotal,
    audit_denied: point.auditDenied,
    generated_at: generatedAt,
  }
}

export async function upsertDailyMetric(
  db: Kysely<Database>,
  day: string,
  opts: MetricOptions,
): Promise<DailyMetricView> {
  const point = await computeDailyMetric(db, day, opts)
  const values = toValues(point, opts.now)
  await db
    .insertInto('admin.daily_metric')
    .values(values)
    .onConflict((oc) =>
      oc.column('day').doUpdateSet({
        accounts_total: values.accounts_total,
        accounts_new: values.accounts_new,
        accounts_active_24h: values.accounts_active_24h,
        status_counts: values.status_counts,
        audit_total: values.audit_total,
        audit_denied: values.audit_denied,
        generated_at: values.generated_at,
      }),
    )
    .execute()
  return point
}

export async function backfillDailyMetrics(
  db: Kysely<Database>,
  opts: MetricOptions,
): Promise<number> {
  const today = dayKey(opts.now, opts.timeZone)
  let inserted = 0
  for (let offset = BACKFILL_DAYS - 1; offset >= 0; offset -= 1) {
    const day = shiftDay(today, -offset)
    const point = await computeDailyMetric(db, day, opts)
    const result = await db
      .insertInto('admin.daily_metric')
      .values(toValues(point, opts.now))
      .onConflict((oc) => oc.column('day').doNothing())
      .executeTakeFirst()
    inserted += Number(result.numInsertedOrUpdatedRows ?? 0)
  }
  return inserted
}

function toView(row: {
  day: string
  accounts_total: number
  accounts_new: number
  accounts_active_24h: number
  status_counts: unknown
  audit_total: number
  audit_denied: number
}): DailyMetricView {
  const counts = emptyStatusCounts()
  if (row.status_counts && typeof row.status_counts === 'object') {
    for (const [key, value] of Object.entries(row.status_counts as Record<string, unknown>)) {
      if (key in counts && typeof value === 'number') {
        counts[key as AccountStatus] = value
      }
    }
  }
  return {
    day: row.day,
    accountsTotal: row.accounts_total,
    accountsNew: row.accounts_new,
    accountsActive24h: row.accounts_active_24h,
    statusCounts: counts,
    auditTotal: row.audit_total,
    auditDenied: row.audit_denied,
  }
}

export async function dashboardSeries(
  db: Kysely<Database>,
  days: number,
  indexerEnabled: boolean,
  now = new Date(),
  timeZone = 'Asia/Shanghai',
): Promise<DashboardSeriesResult> {
  if (!(SERIES_DAYS as readonly number[]).includes(days)) {
    throw new LexServerError(400, {
      error: 'InvalidRequest',
      message: 'days must be 7, 30 or 90',
    })
  }
  const today = dayKey(now, timeZone)
  const start = shiftDay(today, -(days - 1))
  const rows = await db
    .selectFrom('admin.daily_metric')
    .selectAll()
    .where('day', '>=', start)
    .where('day', '<=', today)
    .orderBy('day', 'asc')
    .execute()
  const last = rows.at(-1)
  return {
    days,
    indexerEnabled,
    points: rows.map(toView),
    ...(last
      ? { generatedAt: last.generated_at.toISOString() as DashboardSeriesResult['generatedAt'] }
      : {}),
  }
}

export async function refreshTodayMetrics(
  db: Kysely<Database>,
  opts: MetricOptions,
): Promise<void> {
  const today = dayKey(opts.now, opts.timeZone)
  await upsertDailyMetric(db, today, opts)
  await upsertDailyMetric(db, shiftDay(today, -1), opts)
}

export type MetricsSchedulerDeps = {
  db: Kysely<Database>
  logger: Logger
  config: Config
}

const REFRESH_INTERVAL_MS = 60 * 60 * 1000

async function runOnce(
  deps: MetricsSchedulerDeps,
  mode: 'startup' | 'refresh',
): Promise<void> {
  const opts: MetricOptions = {
    now: new Date(),
    timeZone: deps.config.reportTimezone,
    indexerEnabled: deps.config.indexer.enabled,
  }
  if (mode === 'startup') {
    const inserted = await backfillDailyMetrics(deps.db, opts)
    deps.logger.info('daily metrics backfill complete', { inserted })
  }
  await refreshTodayMetrics(deps.db, opts)
  const pruned = await pruneAccess(deps.db, opts.now)
  if (pruned > 0) {
    deps.logger.info('expired access records pruned', { removed: pruned })
  }
}

export function startMetricsScheduler(deps: MetricsSchedulerDeps): () => void {
  let stopped = false
  let running = false
  const safeRun = (mode: 'startup' | 'refresh') => {
    if (stopped || running) return
    running = true
    void runOnce(deps, mode)
      .catch((error: unknown) => {
        deps.logger.error('daily metrics task failed', { error })
      })
      .finally(() => {
        running = false
      })
  }

  safeRun('startup')
  const timer = setInterval(() => safeRun('refresh'), REFRESH_INTERVAL_MS)
  timer.unref()

  return () => {
    stopped = true
    clearInterval(timer)
  }
}