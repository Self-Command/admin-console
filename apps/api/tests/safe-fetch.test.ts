import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createSafeFetch, isPrivateAddress } from '../src/auth/safe-fetch.js'

const base = {
  allowHttp: false,
  allowPrivateHosts: [] as string[],
  timeoutMs: 1000,
  maxBytes: 256 * 1024,
}

describe('private address detection', () => {
  it('classifies loopback, link-local, private, CGNAT and documentation ranges', () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.1',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      '::',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '2001:db8::1',
    ]) {
      expect(isPrivateAddress(address), address).toBe(true)
    }
  })

  it('treats public addresses and non-IP values as unsafe', () => {
    expect(isPrivateAddress('93.184.216.34')).toBe(false)
    expect(isPrivateAddress('2606:2800:220:1:248:1893:25c8:1946')).toBe(false)
    expect(isPrivateAddress('example.com')).toBe(true)
  })
})

describe('safe DID fetch', () => {
  let server: Server | undefined

  afterEach(async () => {
    if (!server) return
    await new Promise<void>((resolve) => server?.close(() => resolve()))
    server = undefined
  })

  async function serveDocument(body: string, contentType: string): Promise<number> {
    server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': contentType })
      response.end(body)
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    return (server.address() as AddressInfo).port
  }
  it('rejects plain HTTP when it is disabled', async () => {
    const safeFetch = createSafeFetch(base)
    await expect(safeFetch('http://example.com/did.json')).rejects.toThrow(
      'blocked plain HTTP',
    )
  })

  it('rejects HTTP hosts that are not explicitly allowlisted', async () => {
    const safeFetch = createSafeFetch({ ...base, allowHttp: true })
    await expect(safeFetch('http://example.com/did.json')).rejects.toThrow(
      'not in private allowlist',
    )
  })

  it('rejects non-GET methods and non-HTTP protocols', async () => {
    const safeFetch = createSafeFetch(base)
    await expect(
      safeFetch('https://example.com/did.json', { method: 'POST' }),
    ).rejects.toThrow('only supports GET')
    await expect(safeFetch('ftp://example.com/did.json')).rejects.toThrow(
      'blocked protocol',
    )
  })

  it('blocks private IP literals after DNS validation', async () => {
    const safeFetch = createSafeFetch(base)
    await expect(safeFetch('https://127.0.0.1/did.json')).rejects.toThrow(
      'resolves to a private address',
    )
  })

  it('serves allowlisted loopback hosts and drops content-type parameters', async () => {
    const port = await serveDocument(
      '{"id":"did:web:localhost%3A2587"}',
      'application/did+ld+json; charset=utf-8',
    )
    const safeFetch = createSafeFetch({
      ...base,
      allowHttp: true,
      allowPrivateHosts: ['127.0.0.1'],
    })

    // Node's Happy Eyeballs calls the lookup hook with `all: true`.
    const response = await safeFetch(`http://127.0.0.1:${port}/did.json`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/did+ld+json')
    expect(await response.text()).toBe('{"id":"did:web:localhost%3A2587"}')
  })
})
