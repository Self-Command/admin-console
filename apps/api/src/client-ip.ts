import type { IncomingMessage } from 'node:http'
import { isIP } from 'node:net'

export function normalizeIp(value: string): string {
  let ip = value.trim()
  if (ip.toLowerCase().startsWith('::ffff:')) ip = ip.slice(7)
  const zone = ip.indexOf('%')
  if (zone !== -1) ip = ip.slice(0, zone)
  return ip
}

/**
 * Uses the connection address unless proxy trust is explicitly enabled. The
 * forwarded header is only read then, and only its right-most hop, so a client
 * cannot spoof its way past an allow list.
 */
export function resolveClientIp(
  request: IncomingMessage,
  trustProxy: boolean,
): string {
  if (trustProxy) {
    const header = request.headers['x-forwarded-for']
    const raw = Array.isArray(header) ? header.join(',') : header
    if (raw) {
      const hops = raw.split(',').map((hop) => hop.trim()).filter(Boolean)
      const last = hops.at(-1)
      if (last) {
        const normalized = normalizeIp(last)
        if (isIP(normalized) !== 0) return normalized
      }
    }
  }
  return normalizeIp(request.socket.remoteAddress ?? 'unknown')
}

function ipv4ToBigInt(ip: string): bigint | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let value = 0n
  for (const part of parts) {
    const byte = Number(part)
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) return null
    value = (value << 8n) | BigInt(byte)
  }
  return value
}

function ipv6ToBigInt(ip: string): bigint | null {
  const halves = ip.toLowerCase().split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - head.length - tail.length
  if (halves.length === 1 && missing !== 0) return null
  if (missing < 0) return null
  const groups = [...head, ...Array<string>(missing).fill('0'), ...tail]
  let value = 0n
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null
    value = (value << 16n) | BigInt(parseInt(group, 16))
  }
  return value
}

function toBigInt(ip: string): { value: bigint; bits: number } | null {
  const normalized = normalizeIp(ip)
  const version = isIP(normalized)
  if (version === 4) {
    const value = ipv4ToBigInt(normalized)
    return value === null ? null : { value, bits: 32 }
  }
  if (version === 6) {
    const value = ipv6ToBigInt(normalized)
    return value === null ? null : { value, bits: 128 }
  }
  return null
}

export function matchesIpRule(ip: string, rule: string): boolean {
  const [base, prefixRaw] = rule.split('/')
  if (!base) return false
  const address = toBigInt(ip)
  const network = toBigInt(base)
  if (!address || !network || address.bits !== network.bits) return false
  if (prefixRaw === undefined) return address.value === network.value

  const prefix = Number(prefixRaw)
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > address.bits) return false
  if (prefix === 0) return true
  const shift = BigInt(address.bits - prefix)
  return address.value >> shift === network.value >> shift
}

export function isIpAllowed(ip: string, rules: readonly string[]): boolean {
  if (rules.length === 0) return true
  return rules.some((rule) => matchesIpRule(ip, rule))
}