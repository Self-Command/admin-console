import { decodeAll } from '@atproto/lex-cbor'
import { isDidString } from '@atproto/lex-schema'
import type { AccountStatus } from '../db/types.js'

const MAX_DID_LENGTH = 2048
const MAX_HANDLE_LENGTH = 253

export type IdentityEvent = {
  type: 'identity'
  did: string
  handle?: string
  seq: number
  time: Date
}

export type AccountEvent = {
  type: 'account'
  did: string
  active: boolean
  status: AccountStatus
  seq: number
  time: Date
}

export type FirehoseEvent = IdentityEvent | AccountEvent

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readSeq(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function readTime(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function readDid(value: unknown): string | null {
  return typeof value === 'string' && value.length <= MAX_DID_LENGTH && isDidString(value)
    ? value
    : null
}

function readHandle(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_HANDLE_LENGTH) return undefined
  return /^[a-z0-9.-]+$/i.test(value) ? value.toLowerCase() : undefined
}

const ACCOUNT_STATUSES: ReadonlySet<string> = new Set([
  'active',
  'deactivated',
  'suspended',
  'takendown',
  'deleted',
  'unknown',
])

export function mapAccountStatus(
  value: unknown,
  active: boolean | undefined,
): AccountStatus {
  if (typeof value === 'string' && ACCOUNT_STATUSES.has(value)) {
    return value as AccountStatus
  }
  if (active === true) return 'active'
  return 'unknown'
}

export function parseFirehoseEvent(
  type: string,
  body: unknown,
): FirehoseEvent | undefined {
  if (!isRecord(body)) return undefined
  const did = readDid(body.did)
  const seq = readSeq(body.seq)
  const time = readTime(body.time)
  if (!did || seq === null || !time) return undefined

  if (type === '#identity' || type === 'com.atproto.sync.subscribeRepos#identity') {
    const handle = readHandle(body.handle)
    return { type: 'identity', did, seq, time, ...(handle ? { handle } : {}) }
  }

  if (type === '#account' || type === 'com.atproto.sync.subscribeRepos#account') {
    if (typeof body.active !== 'boolean') return undefined
    return {
      type: 'account',
      did,
      active: body.active,
      status: mapAccountStatus(body.status, body.active),
      seq,
      time,
    }
  }

  return undefined
}

export type DecodedFrame =
  | { kind: 'event'; event: FirehoseEvent }
  | { kind: 'ignored' }

/**
 * Decodes one firehose WebSocket frame (a CBOR header followed by a CBOR body).
 * The caller must bound the message size before calling this function.
 */
export function decodeFirehoseFrame(bytes: Uint8Array): DecodedFrame {
  const values = [...decodeAll(bytes)]
  if (values.length !== 2) return { kind: 'ignored' }
  const header = values[0]
  const body = values[1]
  if (!isRecord(header) || header.op !== 1 || typeof header.t !== 'string') {
    return { kind: 'ignored' }
  }
  const event = parseFirehoseEvent(header.t, body)
  return event ? { kind: 'event', event } : { kind: 'ignored' }
}
