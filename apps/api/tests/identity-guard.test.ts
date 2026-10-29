import { describe, expect, it } from 'vitest'
import type { Kysely } from 'kysely'
import { createIdentityGuard, type GuardDeps } from '../src/auth/guard.js'
import type { Config } from '../src/config.js'
import type { Database } from '../src/db/types.js'
import { silentLogger } from '../src/logger.js'

const NSID = 'com.selfcommand.admin.session.get'
const CALLER = 'did:plc:caller'

function createDeps(role: string | null, auditWrites: string[]): GuardDeps {
  const db = {
    selectFrom: () => ({
      select: () => ({
        where: () => ({
          executeTakeFirst: async () => (role ? { role } : undefined),
        }),
      }),
    }),
    insertInto: (table: string) => {
      auditWrites.push(table)
      throw new Error('session lookup must not write audit rows on success')
    },
  } as unknown as Kysely<Database>

  return {
    db,
    logger: silentLogger,
    config: { serviceDid: 'did:web:admin.test' } as Config,
    verifier: async () => ({
      did: CALLER,
      didDocument: {},
      jwt: { payload: { lxm: NSID } },
    }) as never,
    didResolver: {} as never,
  }
}

function createContext(): never {
  return {
    method: { nsid: NSID },
    params: {},
    request: new Request(`http://admin.test/xrpc/${NSID}`),
  } as never
}

describe('identity guard', () => {
  it('returns the caller DID and role for a bound account', async () => {
    const writes: string[] = []
    const guard = createIdentityGuard(createDeps('operator', writes))
    await expect(guard(createContext())).resolves.toEqual({ did: CALLER, role: 'operator' })
    expect(writes).toEqual([])
  })

  it('allows an unbound account and returns a null role without audit writes', async () => {
    const writes: string[] = []
    const guard = createIdentityGuard(createDeps(null, writes))
    await expect(guard(createContext())).resolves.toEqual({ did: CALLER, role: null })
    expect(writes).toEqual([])
  })
})
