import type { LogLevel } from './config.js'

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

const SENSITIVE_KEY =
  /authorization|cookie|token|secret|password|passwd|database_?url|connection_?string|dsn|jwt|credential/i

const URL_PATTERN = /\b(?:postgres(?:ql)?|redis|mongodb(?:\+srv)?):\/\/[^\s"']+/gi
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g

export function redactString(value: string): string {
  return value
    .replace(URL_PATTERN, (match) => `${match.split('://')[0]}://[redacted]`)
    .replace(BEARER_PATTERN, 'Bearer [redacted]')
    .replace(JWT_PATTERN, '[redacted-jwt]')
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactString(value)
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
    }
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return '[circular]'
    seen.add(value)
    return value.map((item) => redactValue(item, seen))
  }
  if (value && typeof value === 'object') {
    if (seen.has(value)) return '[circular]'
    seen.add(value)
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redactValue(item, seen)
    }
    return out
  }
  return value
}

export type LogFields = Record<string, unknown>

export type Logger = {
  debug(message: string, fields?: LogFields): void
  info(message: string, fields?: LogFields): void
  warn(message: string, fields?: LogFields): void
  error(message: string, fields?: LogFields): void
  child(fields: LogFields): Logger
}

export type LoggerOptions = {
  level: LogLevel
  base?: LogFields
  sink?: (line: string, level: LogLevel) => void
}

function defaultSink(line: string, level: LogLevel) {
  if (level === 'error' || level === 'warn') {
    process.stderr.write(`${line}\n`)
  } else {
    process.stdout.write(`${line}\n`)
  }
}

export function createLogger(options: LoggerOptions): Logger {
  const { level, base = {}, sink = defaultSink } = options
  const threshold = LEVEL_WEIGHT[level]

  const emit = (entryLevel: LogLevel, message: string, fields?: LogFields) => {
    if (LEVEL_WEIGHT[entryLevel] < threshold) return
    const entry = {
      time: new Date().toISOString(),
      level: entryLevel,
      msg: redactString(message),
      ...(redactValue({ ...base, ...fields }, new WeakSet()) as Record<string, unknown>),
    }
    sink(JSON.stringify(entry), entryLevel)
  }

  return {
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
    child: (fields) => createLogger({ level, base: { ...base, ...fields }, sink }),
  }
}

export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
}
