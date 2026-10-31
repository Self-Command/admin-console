import { LexServerError } from '@atproto/lex-server'

export type RecordLike = Record<string, unknown>

export function rec(value: unknown): RecordLike | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as RecordLike)
    : undefined
}

export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function str(value: unknown, max = 2048): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : undefined
}

export function integer(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

export function nonNegative(value: unknown): number | undefined {
  const parsed = integer(value)
  return parsed !== undefined && parsed >= 0 ? parsed : undefined
}

export function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

export function iso(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString()
}

export function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined
}

export function shape(what: string): LexServerError {
  return new LexServerError(502, {
    error: 'UpstreamUnavailable',
    message: `上游服务返回了无法识别的${what}数据，请稍后重试。`,
  })
}
