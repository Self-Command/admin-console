import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from '../src/config.js'
import { createLogger, redactString } from '../src/logger.js'
import { decodeCursor, encodeCursor } from '../src/pagination.js'

const minimalEnv = {
  ADMIN_API_DATABASE_URL: 'postgres://admin:admin@localhost:5432/admin',
}

describe('configuration', () => {
  it('requires a database URL and names the missing variable', () => {
    expect(() => loadConfig({})).toThrowError(ConfigError)
    expect(() => loadConfig({})).toThrowError('ADMIN_API_DATABASE_URL is required')
  })

  it('applies defaults and parses explicit overrides', () => {
    const config = loadConfig({
      ...minimalEnv,
      ADMIN_API_SERVICE_DID: 'did:web:admin.example.com',
      ADMIN_API_PORT: '9000',
      ADMIN_API_DID_METHODS: 'plc',
      ADMIN_API_DID_ALLOW_HTTP: 'false',
      ADMIN_API_INDEXER_ENABLED: 'false',
    })

    expect(config.serviceDid).toBe('did:web:admin.example.com')
    expect(config.port).toBe(9000)
    expect(config.logLevel).toBe('info')
    expect(config.did.allowedMethods).toEqual(['plc'])
    expect(config.did.allowHttp).toBe(false)
    expect(config.indexer.enabled).toBe(false)
  })

  it('rejects malformed values without echoing them', () => {
    expect(() =>
      loadConfig({ ...minimalEnv, ADMIN_API_PORT: 'not-a-port' }),
    ).toThrowError('ADMIN_API_PORT must be an integer between 1 and 65535')
    expect(() =>
      loadConfig({ ...minimalEnv, ADMIN_API_LOG_LEVEL: 'verbose' }),
    ).toThrowError('ADMIN_API_LOG_LEVEL must be debug, info, warn or error')
    expect(() =>
      loadConfig({ ...minimalEnv, ADMIN_API_SERVICE_DID: 'not a did' }),
    ).toThrowError('ADMIN_API_SERVICE_DID must be a DID')
    expect(() =>
      loadConfig({ ...minimalEnv, ADMIN_API_DID_METHODS: ',' }),
    ).toThrowError('ADMIN_API_DID_METHODS must list at least one method')
  })
})

describe('logger redaction', () => {
  it('redacts connection strings, bearer tokens and JWTs', () => {
    const line =
      'connect postgres://admin:secret@db.local:5432/admin with Bearer abc.def.ghi and eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiJkaWQ6cGxjOmFsaWNlIn0.sig'

    const redacted = redactString(line)

    expect(redacted).not.toContain('secret')
    expect(redacted).not.toContain('abc.def.ghi')
    expect(redacted).toContain('postgres://[redacted]')
    expect(redacted).toContain('Bearer [redacted]')
  })

  it('redacts sensitive keys and never serializes error stacks', () => {
    const lines: string[] = []
    const logger = createLogger({
      level: 'info',
      sink: (line) => lines.push(line),
      base: { service: 'admin-api' },
    })

    logger.info('test', {
      authorization: 'Bearer secret',
      databaseUrl: 'postgres://user:pass@db/admin',
      nested: { token: 'abc', note: 'keep me' },
      error: new Error('failed at postgres://user:pass@db/admin'),
    })

    const entry = JSON.parse(lines[0] ?? '{}')
    expect(entry.service).toBe('admin-api')
    expect(entry.authorization).toBe('[redacted]')
    expect(entry.databaseUrl).toBe('[redacted]')
    expect(entry.nested).toEqual({ token: '[redacted]', note: 'keep me' })
    expect(entry.error).toEqual({
      name: 'Error',
      message: 'failed at postgres://[redacted]',
    })
  })

  it('drops entries below the configured level', () => {
    const lines: string[] = []
    const logger = createLogger({ level: 'warn', sink: (line) => lines.push(line) })

    logger.debug('debug')
    logger.info('info')
    logger.warn('warn')

    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0] ?? '{}').msg).toBe('warn')
  })
})

describe('list cursors', () => {
  it('round-trips printable values', () => {
    expect(decodeCursor(encodeCursor('did:plc:alice'))).toBe('did:plc:alice')
    expect(decodeCursor(encodeCursor('42'))).toBe('42')
  })

  it('rejects malformed or non-printable cursors', () => {
    expect(decodeCursor('not base64!')).toBeNull()
    const weird = Buffer.from('alice\u0000test', 'utf8').toString('base64url')
    expect(decodeCursor(weird)).toBeNull()
    expect(decodeCursor('a'.repeat(2048))).toBeNull()
  })
})
