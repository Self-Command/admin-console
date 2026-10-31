import { LexServerError } from '@atproto/lex-server'
import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import type { Kysely } from 'kysely'
import { createGuard, createIdentityGuard, type GuardDeps } from '../src/auth/guard.js'
import { isIpAllowed, resolveClientIp } from '../src/client-ip.js'
import type { Config } from '../src/config.js'
import type { Database } from '../src/db/types.js'
import { silentLogger } from '../src/logger.js'

const LIST_NSID = 'com.selfcommand.admin.audit.list'
const SELF_NSID = 'com.selfcommand.admin.session.get'
const CALLER = 'did:plc:caller'

type Write = { table: string; values: Record<string, unknown> }

function createDb(writes: Write[], role: string | null = 'admin'): Kysely<Database> {
  return {
    insertInto: (table: string) => ({
      values: (values: Record<string, unknown>) => ({
        execute: async () => {
          writes.push({ table, values })
        },
        onConflict: () => ({
          execute: async () => {
            writes.push({ table, values })
          },
        }),
      }),
    }),
    selectFrom: (table: string) => ({
      select: () => ({
        where: () => ({
          executeTakeFirst: async () =>
            table === 'admin.admin_role' && role ? { role } : undefined,
        }),
      }),
      selectAll: () => ({
        where: () => ({
          executeTakeFirst: async () => undefined,
        }),
      }),
    }),
  } as unknown as Kysely<Database>
}

function createDeps(
  allowedIps: string[],
  writes: Write[],
  role: string | null = 'admin',
): GuardDeps {
  return {
    db: createDb(writes, role),
    logger: silentLogger,
    config: {
      serviceDid: 'did:web:admin.test',
      allowedIps,
      trustProxy: false,
    } as unknown as Config,
    verifier: async () => ({
      did: CALLER,
      didDocument: {},
      jwt: { payload: { lxm: LIST_NSID } },
    }) as never,
    didResolver: {} as never,
  }
}

function createContext(nsid: string, ip?: string): never {
  return {
    method: { nsid },
    params: {},
    request: new Request(`http://admin.test/xrpc/${nsid}`, {
      headers: ip ? { 'x-admin-client-ip': ip } : {},
    }),
  } as never
}

function incoming(headers: Record<string, string>, remoteAddress: string): IncomingMessage {
  return { headers, socket: { remoteAddress } } as unknown as IncomingMessage
}

describe('address allow list', () => {
  it('rejects an address outside every rule and audits the denial', async () => {
    const writes: Write[] = []
    const guard = createGuard('audit.read', createDeps(['203.0.113.0/24'], writes))

    const error = await Promise.resolve(
      guard(createContext(LIST_NSID, '198.51.100.7')),
    ).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(LexServerError)
    expect((error as LexServerError).status).toBe(403)
    expect((error as LexServerError).body).toMatchObject({ error: 'Forbidden' })
    expect((error as LexServerError).body.message).toContain('来源地址不在后台访问白名单内')
    expect(writes.map((write) => write.table)).toEqual([
      'admin.admin_access',
      'admin.admin_audit_event',
    ])
    expect(writes[0]?.values).toMatchObject({ did: CALLER, ip: '198.51.100.7' })
    expect(writes[1]?.values).toMatchObject({
      actor_did: CALLER,
      action: LIST_NSID,
      result: 'denied',
      detail: '来源地址不在后台访问白名单内',
      // The specification forbids recording the full source address on an
      // allow-list denial, so the audit row stays without an address.
      actor_ip: null,
    })
  })

  it('lets an address inside a rule reach the role check', async () => {
    const writes: Write[] = []
    const guard = createGuard('audit.read', createDeps(['203.0.113.0/24'], writes))

    await expect(guard(createContext(LIST_NSID, '203.0.113.42'))).resolves.toMatchObject({
      did: CALLER,
      role: 'admin',
      actorIp: '203.0.113.42',
    })
    expect(writes.map((write) => write.table)).toEqual(['admin.admin_access'])
  })

  it('rejects the self-read of an address outside every rule as well', async () => {
    const writes: Write[] = []
    const deps = createDeps(['203.0.113.0/24'], writes)
    deps.verifier = async () =>
      ({
        did: CALLER,
        didDocument: {},
        jwt: { payload: { lxm: SELF_NSID } },
      }) as never
    const guard = createIdentityGuard(deps)

    await expect(guard(createContext(SELF_NSID, '198.51.100.7'))).rejects.toMatchObject({
      status: 403,
    })
    expect(writes.at(-1)?.values).toMatchObject({ result: 'denied' })
  })

  it('allows every address when no rule is configured', async () => {
    const guard = createGuard('audit.read', createDeps([], []))
    await expect(guard(createContext(LIST_NSID, '198.51.100.7'))).resolves.toMatchObject({
      did: CALLER,
    })
  })
})

describe('client address resolution', () => {
  it('ignores a forwarded header while proxy trust is disabled', () => {
    expect(
      resolveClientIp(incoming({ 'x-forwarded-for': '203.0.113.9' }, '10.0.0.5'), false),
    ).toBe('10.0.0.5')
  })

  it('reads only the last forwarded hop and normalizes a mapped address', () => {
    expect(
      resolveClientIp(
        incoming({ 'x-forwarded-for': '192.0.2.1, ::ffff:203.0.113.9' }, '10.0.0.5'),
        true,
      ),
    ).toBe('203.0.113.9')
  })

  it('falls back to the connection address when the forwarded header is unusable', () => {
    expect(
      resolveClientIp(incoming({ 'x-forwarded-for': 'proxy.internal' }, '10.0.0.5'), true),
    ).toBe('10.0.0.5')
  })
})

describe('address rules', () => {
  it('matches IPv4 ranges, single addresses and IPv6 prefixes', () => {
    expect(isIpAllowed('203.0.113.77', ['203.0.113.0/24'])).toBe(true)
    expect(isIpAllowed('203.0.114.1', ['203.0.113.0/24'])).toBe(false)
    expect(isIpAllowed('203.0.113.9', ['203.0.113.9'])).toBe(true)
    expect(isIpAllowed('203.0.113.10', ['203.0.113.9'])).toBe(false)
    expect(isIpAllowed('2001:db8::1', ['2001:db8::/32'])).toBe(true)
    expect(isIpAllowed('2001:db9::1', ['2001:db8::/32'])).toBe(false)
    expect(isIpAllowed('::ffff:203.0.113.5', ['203.0.113.0/24'])).toBe(true)
  })

  it('rejects malformed rules instead of granting access', () => {
    expect(isIpAllowed('203.0.113.9', ['203.0.113.0/99'])).toBe(false)
    expect(isIpAllowed('203.0.113.9', ['203.0.113.0/abc'])).toBe(false)
    expect(isIpAllowed('203.0.113.9', ['not-an-ip'])).toBe(false)
    expect(isIpAllowed('203.0.113.9', [])).toBe(true)
  })
})