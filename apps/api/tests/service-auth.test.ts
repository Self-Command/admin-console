import { Secp256k1Keypair, type Keypair } from '@atproto/crypto'
import { LexServerAuthError } from '@atproto/lex-server'
import { createServiceJwt } from '@atproto/xrpc-server'
import { describe, expect, it } from 'vitest'
import {
  createServiceAuthVerifier,
  requireLxm,
  resolveRejectedTokenDid,
  type DidResolver,
} from '../src/auth/service-auth.js'
import { loadConfig, type Config } from '../src/config.js'

const SERVICE_DID = 'did:web:admin.test'
const ISSUER_DID = 'did:plc:testissuer'
const NSID = 'com.selfcommand.admin.role.list'

function testConfig(): Config {
  return loadConfig({
    ADMIN_API_DATABASE_URL: 'postgres://admin:admin@localhost:5432/admin_test',
    ADMIN_API_SERVICE_DID: SERVICE_DID,
  })
}

function didDocument(did: string, keypair: Keypair) {
  return {
    id: did,
    verificationMethod: [
      {
        id: `${did}#atproto`,
        type: 'Multikey',
        controller: did,
        publicKeyMultibase: keypair.did().replace(/^did:key:/, ''),
      },
    ],
  }
}

function resolverFor(document: unknown): DidResolver {
  return {
    async resolve() {
      return document
    },
  } as unknown as DidResolver
}

function requestWith(token?: string): Request {
  return new Request(`http://localhost:2587/xrpc/${NSID}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
}

function verifierContext(request: Request, nsid = NSID) {
  return { request, method: { nsid }, params: {} } as never
}

function bearerCode(error: unknown): string | undefined {
  if (!(error instanceof LexServerAuthError)) return undefined
  const bearer = error.wwwAuthenticate.Bearer
  return typeof bearer === 'object' && !Array.isArray(bearer) ? bearer.error : undefined
}

async function sign(
  keypair: Keypair,
  overrides: { aud?: string; lxm?: string | null; iat?: number; exp?: number } = {},
): Promise<string> {
  return createServiceJwt({
    iss: ISSUER_DID,
    aud: overrides.aud ?? SERVICE_DID,
    lxm: overrides.lxm === undefined ? NSID : overrides.lxm,
    ...(overrides.iat === undefined ? {} : { iat: overrides.iat }),
    ...(overrides.exp === undefined ? {} : { exp: overrides.exp }),
    keypair,
  })
}

describe('service JWT verification', () => {
  it('accepts a valid token signed for this service and method', async () => {
    const keypair = await Secp256k1Keypair.create()
    const verifier = createServiceAuthVerifier(
      testConfig(),
      resolverFor(didDocument(ISSUER_DID, keypair)),
    )

    const credentials = await verifier(verifierContext(requestWith(await sign(keypair))))

    expect(credentials.did).toBe(ISSUER_DID)
    expect(credentials.jwt.payload.lxm).toBe(NSID)
  })

  it('rejects a request without an authorization header', async () => {
    const keypair = await Secp256k1Keypair.create()
    const verifier = createServiceAuthVerifier(
      testConfig(),
      resolverFor(didDocument(ISSUER_DID, keypair)),
    )

    await expect(verifier(verifierContext(requestWith()))).rejects.toSatisfy(
      (error: unknown) => bearerCode(error) === 'MissingBearer',
    )
  })

  it('rejects a token issued for another audience', async () => {
    const keypair = await Secp256k1Keypair.create()
    const verifier = createServiceAuthVerifier(
      testConfig(),
      resolverFor(didDocument(ISSUER_DID, keypair)),
    )
    const token = await sign(keypair, { aud: 'did:web:someone-else.test' })

    await expect(verifier(verifierContext(requestWith(token)))).rejects.toSatisfy(
      (error: unknown) => bearerCode(error) === 'InvalidAudience',
    )
  })

  it('rejects a token issued for another lexicon method', async () => {
    const keypair = await Secp256k1Keypair.create()
    const verifier = createServiceAuthVerifier(
      testConfig(),
      resolverFor(didDocument(ISSUER_DID, keypair)),
    )
    const token = await sign(keypair, { lxm: 'com.selfcommand.admin.role.get' })

    await expect(verifier(verifierContext(requestWith(token)))).rejects.toSatisfy(
      (error: unknown) => bearerCode(error) === 'BadJwtLexiconMethod',
    )
  })

  it('rejects an expired token', async () => {
    const keypair = await Secp256k1Keypair.create()
    const verifier = createServiceAuthVerifier(
      testConfig(),
      resolverFor(didDocument(ISSUER_DID, keypair)),
    )
    const now = Math.floor(Date.now() / 1000)
    const token = await sign(keypair, { iat: now - 600, exp: now - 60 })

    await expect(verifier(verifierContext(requestWith(token)))).rejects.toSatisfy(
      (error: unknown) => bearerCode(error) === 'JwtExpired',
    )
  })

  it('rejects a token whose signature does not match the issuer key', async () => {
    const signer = await Secp256k1Keypair.create()
    const publishedKey = await Secp256k1Keypair.create()
    const verifier = createServiceAuthVerifier(
      testConfig(),
      resolverFor(didDocument(ISSUER_DID, publishedKey)),
    )
    const token = await sign(signer)

    await expect(verifier(verifierContext(requestWith(token)))).rejects.toSatisfy(
      (error: unknown) => bearerCode(error) === 'BadJwtSignature',
    )
  })

  it('requires the token to declare the invoked method even when the signature is valid', async () => {
    const keypair = await Secp256k1Keypair.create()
    const verifier = createServiceAuthVerifier(
      testConfig(),
      resolverFor(didDocument(ISSUER_DID, keypair)),
    )
    const credentials = await verifier(
      verifierContext(requestWith(await sign(keypair, { lxm: null }))),
    )

    expect(() => requireLxm(credentials, NSID)).toThrowError(LexServerAuthError)
  })

  it('attributes a rejected token to its verified issuer without authorizing it', async () => {
    const keypair = await Secp256k1Keypair.create()
    const config = testConfig()
    const resolver = resolverFor(didDocument(ISSUER_DID, keypair))
    const token = await sign(keypair, { aud: 'did:web:someone-else.test' })

    const did = await resolveRejectedTokenDid(config, requestWith(token), resolver)

    expect(did).toBe(ISSUER_DID)
  })

  it('does not attribute a rejected token with an unverifiable signature', async () => {
    const signer = await Secp256k1Keypair.create()
    const publishedKey = await Secp256k1Keypair.create()
    const token = await sign(signer, { aud: 'did:web:someone-else.test' })

    const did = await resolveRejectedTokenDid(
      testConfig(),
      requestWith(token),
      resolverFor(didDocument(ISSUER_DID, publishedKey)),
    )

    expect(did).toBeNull()
  })
})
