import { lookup as dnsLookup } from 'node:dns'
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'

export type SafeFetchOptions = {
  allowHttp: boolean
  allowPrivateHosts: string[]
  timeoutMs: number
  maxBytes: number
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string,
  family?: number,
) => void

function normalizeHost(hostname: string): string {
  const lower = hostname.toLowerCase()
  if (lower.startsWith('[') && lower.endsWith(']')) return lower.slice(1, -1)
  return lower
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true
  const [a = 0, b = 0] = parts
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 192 && b === 0) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a >= 224) return true
  return false
}

function isPrivateIpv6(address: string): boolean {
  const lower = address.toLowerCase()
  if (lower === '::' || lower === '::1') return true
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped?.[1]) return isPrivateIpv4(mapped[1])
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true
  if (/^fe[89ab]/.test(lower)) return true
  if (lower.startsWith('ff')) return true
  if (lower.startsWith('2001:db8')) return true
  return false
}

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return isPrivateIpv4(address)
  if (family === 6) return isPrivateIpv6(address)
  return true
}

function hostAllowed(hostname: string, allowPrivateHosts: string[]): boolean {
  const host = normalizeHost(hostname)
  if (allowPrivateHosts.includes(host)) return true
  if (host.endsWith('.localhost') && allowPrivateHosts.includes('localhost')) return true
  return false
}

function expectedAddressAllowed(
  address: string,
  allowPrivate: boolean,
): boolean {
  return allowPrivate || !isPrivateAddress(address)
}

function makeLookup(allowPrivate: boolean) {
  return (hostname: string, options: { family?: number }, callback: LookupCallback) => {
    const literalFamily = isIP(hostname)
    if (literalFamily !== 0) {
      if (!expectedAddressAllowed(hostname, allowPrivate)) {
        callback(blockedError(hostname), '', 0)
        return
      }
      callback(null, hostname, literalFamily)
      return
    }

    dnsLookup(
      hostname,
      { all: true, family: options.family === 4 || options.family === 6 ? options.family : 0 },
      (error, addresses) => {
        if (error) {
          callback(error, '', 0)
          return
        }
        const usable = addresses.filter((entry) =>
          expectedAddressAllowed(entry.address, allowPrivate),
        )
        const chosen = usable[0]
        if (!chosen) {
          callback(blockedError(hostname), '', 0)
          return
        }
        callback(null, chosen.address, chosen.family)
      },
    )
  }
}

function blockedError(hostname: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(
    `blocked DID resolution target: ${hostname} resolves to a private address`,
  )
  error.code = 'ERR_DID_FETCH_BLOCKED'
  return error
}

function toHeaders(raw: IncomingHttpHeaders): Headers {
  const headers = new Headers()
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'set-cookie' || value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item)
    } else {
      headers.set(key, value)
    }
  }
  return headers
}

/**
 * Fetch implementation for DID document resolution. Only HTTPS is allowed by
 * default; plain HTTP is limited to explicitly configured hosts. Every resolved
 * address is checked before connecting, redirects are never followed and the
 * response body is capped to `maxBytes`.
 */
export function createSafeFetch(options: SafeFetchOptions): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    if (method !== 'GET' && method !== 'HEAD') {
      throw new TypeError(`DID fetch only supports GET, received ${method}`)
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new TypeError(`DID fetch blocked protocol ${url.protocol}`)
    }
    if (url.protocol === 'http:' && !options.allowHttp) {
      throw new TypeError('DID fetch blocked plain HTTP')
    }

    const allowPrivate = hostAllowed(url.hostname, options.allowPrivateHosts)
    if (url.protocol === 'http:' && !allowPrivate) {
      throw new TypeError(
        `DID fetch blocked HTTP for host ${normalizeHost(url.hostname)} (not in private allowlist)`,
      )
    }

    const literalAddress = normalizeHost(url.hostname)
    if (isIP(literalAddress) !== 0 && !expectedAddressAllowed(literalAddress, allowPrivate)) {
      throw new TypeError(
        `DID fetch blocked target ${literalAddress}: it resolves to a private address`,
      )
    }

    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
    const timeoutSignal = AbortSignal.timeout(options.timeoutMs)
    const signal = callerSignal
      ? AbortSignal.any([callerSignal, timeoutSignal])
      : timeoutSignal

    const headers = new Headers(init?.headers)
    if (!headers.has('accept')) {
      headers.set('accept', 'application/did+ld+json,application/json')
    }

    const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest

    return await new Promise<Response>((resolve, reject) => {
      const request = requestFn(
        url,
        {
          method,
          headers: Object.fromEntries(headers.entries()),
          lookup: makeLookup(allowPrivate) as never,
          signal,
          timeout: options.timeoutMs,
        },
        (response) => {
          const status = response.statusCode ?? 0
          const chunks: Buffer[] = []
          let received = 0

          response.on('data', (chunk: Buffer) => {
            received += chunk.length
            if (received > options.maxBytes) {
              response.destroy(new Error('DID document exceeds the configured size limit'))
              return
            }
            chunks.push(chunk)
          })
          response.on('end', () => {
            resolve(
              new Response(Buffer.concat(chunks), {
                status,
                statusText: response.statusMessage,
                headers: toHeaders(response.headers),
              }),
            )
          })
          response.on('error', reject)
        },
      )
      request.on('timeout', () => {
        request.destroy(new Error('DID fetch timed out'))
      })
      request.on('error', reject)
      request.end()
    })
  }
}
