import { com } from '@admin/lexicons'
import { LexServerError } from '@atproto/lex-server'
import { sql, type Kysely } from 'kysely'
import type { Database } from '../db/types.js'

export type PreferencesView = com.selfcommand.admin.defs.Preferences
export type PreferencesGetResult = com.selfcommand.admin.preferences.get.$OutputBody
export type PreferencesUpdateInput = com.selfcommand.admin.preferences.update.$InputBody

function invalid(message: string): LexServerError {
  return new LexServerError(400, { error: 'InvalidRequest', message })
}

const VIEW_SORTS = ['did', 'handle', 'status', 'indexedAt']
const STATUSES = ['active', 'deactivated', 'suspended', 'takendown', 'deleted', 'unknown']
const VIEW_ID = /^[A-Za-z0-9._-]{1,64}$/

export const SAVED_VIEW_LIMIT = 10
export const FILTER_MACRO_LIMIT = 20

const FILTER_SCOPES = ['reports', 'events'] as const
const FILTER_SUBJECT_TYPES = ['account', 'record', 'message', 'conversation'] as const
const FILTER_REPORT_STATUSES = ['open', 'closed', 'escalated', 'queued', 'assigned'] as const

type FilterMacro = NonNullable<PreferencesView['filterMacros']>[number]
type FilterMacroFilters = NonNullable<FilterMacro['filters']>

function readOptionalString(
  value: unknown,
  path: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length > maxLength) {
    throw invalid(`${path} must be a string of at most ${maxLength} characters`)
  }
  return value
}

function readFilterMacroFilters(value: unknown, path: string): FilterMacroFilters {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(`${path} must be an object`)
  }
  const raw = value as Record<string, unknown>
  const filters: FilterMacroFilters = {}

  const subject = readOptionalString(raw.subject, `${path}.subject`, 2048)
  if (subject !== undefined) filters.subject = subject
  const queue = readOptionalString(raw.queue, `${path}.queue`, 256)
  if (queue !== undefined) filters.queue = queue
  const actor = readOptionalString(raw.actor, `${path}.actor`, 2048)
  if (actor !== undefined) filters.actor = actor
  const keyword = readOptionalString(raw.keyword, `${path}.keyword`, 256)
  if (keyword !== undefined) filters.keyword = keyword
  const batchId = readOptionalString(raw.batchId, `${path}.batchId`, 256)
  if (batchId !== undefined) filters.batchId = batchId

  if (raw.subjectType !== undefined) {
    if (!FILTER_SUBJECT_TYPES.includes(raw.subjectType as (typeof FILTER_SUBJECT_TYPES)[number])) {
      throw invalid(`${path}.subjectType is not a known subject type`)
    }
    filters.subjectType = raw.subjectType as FilterMacroFilters['subjectType']
  }
  if (raw.status !== undefined) {
    if (!FILTER_REPORT_STATUSES.includes(raw.status as (typeof FILTER_REPORT_STATUSES)[number])) {
      throw invalid(`${path}.status is not a known report status`)
    }
    filters.status = raw.status as FilterMacroFilters['status']
  }
  if (raw.direction !== undefined) {
    if (raw.direction !== 'asc' && raw.direction !== 'desc') {
      throw invalid(`${path}.direction must be asc or desc`)
    }
    filters.direction = raw.direction
  }
  if (raw.hasComment !== undefined) {
    if (typeof raw.hasComment !== 'boolean') {
      throw invalid(`${path}.hasComment must be a boolean`)
    }
    filters.hasComment = raw.hasComment
  }
  if (raw.types !== undefined) {
    if (!Array.isArray(raw.types) || raw.types.length > 10) {
      throw invalid(`${path}.types must be an array with at most 10 entries`)
    }
    filters.types = raw.types.map((item, typeIndex) => {
      if (typeof item !== 'string' || item.length > 64) {
        throw invalid(`${path}.types[${typeIndex}] must be a string of at most 64 characters`)
      }
      return item
    })
  }
  return filters
}

function readFilterMacros(value: unknown): NonNullable<PreferencesView['filterMacros']> {
  if (!Array.isArray(value)) throw invalid('preferences.filterMacros must be an array')
  if (value.length > FILTER_MACRO_LIMIT) {
    throw invalid(`preferences.filterMacros must contain at most ${FILTER_MACRO_LIMIT} entries`)
  }
  const seen = new Set<string>()
  const defaults = new Set<string>()
  return value.map((entry, index) => {
    const path = `preferences.filterMacros[${index}]`
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw invalid(`${path} must be an object`)
    }
    const raw = entry as Record<string, unknown>
    const id = typeof raw.id === 'string' ? raw.id.trim() : ''
    if (!VIEW_ID.test(id)) throw invalid(`${path}.id is invalid`)
    if (seen.has(id)) throw invalid(`preferences.filterMacros contains a duplicate id: ${id}`)
    seen.add(id)

    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    if (!name || name.length > 40) {
      throw invalid(`${path}.name must be 1-40 characters`)
    }

    const scope = raw.scope
    if (!FILTER_SCOPES.includes(scope as (typeof FILTER_SCOPES)[number])) {
      throw invalid(`${path}.scope must be reports or events`)
    }

    const macro: FilterMacro = { id, name, scope: scope as FilterMacro['scope'] }
    if (raw.isDefault !== undefined) {
      if (typeof raw.isDefault !== 'boolean') {
        throw invalid(`${path}.isDefault must be a boolean`)
      }
      if (raw.isDefault) {
        if (defaults.has(macro.scope)) {
          throw invalid('preferences.filterMacros may only mark one default macro per scope')
        }
        defaults.add(macro.scope)
      }
      macro.isDefault = raw.isDefault
    }
    if (raw.filters !== undefined) {
      macro.filters = readFilterMacroFilters(raw.filters, `${path}.filters`)
    }
    return macro
  })
}

function readSavedViews(value: unknown): NonNullable<PreferencesView['savedViews']> {
  if (!Array.isArray(value)) throw invalid('preferences.savedViews must be an array')
  if (value.length > SAVED_VIEW_LIMIT) {
    throw invalid(`preferences.savedViews must contain at most ${SAVED_VIEW_LIMIT} entries`)
  }
  const seen = new Set<string>()
  return value.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw invalid(`preferences.savedViews[${index}] must be an object`)
    }
    const view = entry as Record<string, unknown>
    const id = typeof view.id === 'string' ? view.id.trim() : ''
    if (!VIEW_ID.test(id)) throw invalid(`preferences.savedViews[${index}].id is invalid`)
    if (seen.has(id)) throw invalid(`preferences.savedViews contains a duplicate id: ${id}`)
    seen.add(id)

    const name = typeof view.name === 'string' ? view.name.trim() : ''
    if (!name || name.length > 40) {
      throw invalid(`preferences.savedViews[${index}].name must be 1-40 characters`)
    }

    const saved: NonNullable<PreferencesView['savedViews']>[number] = { id, name }
    if (view.search !== undefined) {
      if (typeof view.search !== 'string' || view.search.length > 256) {
        throw invalid(`preferences.savedViews[${index}].search must be at most 256 characters`)
      }
      saved.search = view.search
    }
    if (view.status !== undefined) {
      if (!STATUSES.includes(view.status as string)) {
        throw invalid(`preferences.savedViews[${index}].status is not a known account status`)
      }
      saved.status = view.status as NonNullable<PreferencesView['savedViews']>[number]['status']
    }
    if (view.sort !== undefined) {
      if (!VIEW_SORTS.includes(view.sort as string)) {
        throw invalid(`preferences.savedViews[${index}].sort is not a known sort field`)
      }
      saved.sort = view.sort as NonNullable<PreferencesView['savedViews']>[number]['sort']
    }
    if (view.order !== undefined) {
      if (view.order !== 'asc' && view.order !== 'desc') {
        throw invalid(`preferences.savedViews[${index}].order must be asc or desc`)
      }
      saved.order = view.order
    }
    return saved
  })
}

function readPreferences(value: unknown): PreferencesView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const input = value as Record<string, unknown>
  const preferences: PreferencesView = {}
  if (input.themeMode !== undefined) {
    if (!['light', 'dark', 'system'].includes(input.themeMode as string)) {
      throw invalid('preferences.themeMode must be light, dark or system')
    }
    preferences.themeMode = input.themeMode as PreferencesView['themeMode']
  }
  if (input.density !== undefined) {
    if (!['comfortable', 'compact'].includes(input.density as string)) {
      throw invalid('preferences.density must be comfortable or compact')
    }
    preferences.density = input.density as PreferencesView['density']
  }
  if (input.pageSize !== undefined) {
    if (!Number.isInteger(input.pageSize) || (input.pageSize as number) < 1 || (input.pageSize as number) > 100) {
      throw invalid('preferences.pageSize must be an integer between 1 and 100')
    }
    preferences.pageSize = input.pageSize as number
  }
  if (input.dateFormat !== undefined) {
    if (!['date-time', 'date'].includes(input.dateFormat as string)) {
      throw invalid('preferences.dateFormat must be date-time or date')
    }
    preferences.dateFormat = input.dateFormat as PreferencesView['dateFormat']
  }
  if (input.savedViews !== undefined) {
    preferences.savedViews = readSavedViews(input.savedViews)
  }
  if (input.filterMacros !== undefined) {
    preferences.filterMacros = readFilterMacros(input.filterMacros)
  }
  return preferences
}

export async function getPreferences(
  db: Kysely<Database>,
  did: string,
): Promise<PreferencesGetResult> {
  const row = await db
    .selectFrom('admin.admin_user_preference')
    .select('preferences')
    .where('did', '=', did)
    .executeTakeFirst()
  return { preferences: row ? readPreferences(row.preferences) : {} }
}

export async function updatePreferences(
  db: Kysely<Database>,
  did: string,
  input: PreferencesUpdateInput,
): Promise<PreferencesGetResult> {
  const patch = readPreferences(input.preferences)
  const row = await db
    .selectFrom('admin.admin_user_preference')
    .select('preferences')
    .where('did', '=', did)
    .executeTakeFirst()
  const current = row ? readPreferences(row.preferences) : {}
  const preferences = { ...current, ...patch }

  await db
    .insertInto('admin.admin_user_preference')
    .values({ did, preferences })
    .onConflict((oc) =>
      oc.column('did').doUpdateSet({
        preferences,
        updated_at: sql`now()`,
      }),
    )
    .execute()

  return { preferences }
}
