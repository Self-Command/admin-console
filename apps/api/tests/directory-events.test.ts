import { encode } from '@atproto/lex-cbor'
import { describe, expect, it } from 'vitest'
import {
  decodeFirehoseFrame,
  mapAccountStatus,
  parseFirehoseEvent,
} from '../src/directory/events.js'

const DID = 'did:plc:alice'

function frame(header: unknown, body: unknown): Uint8Array {
  const headerBytes = encode(header as never)
  const bodyBytes = encode(body as never)
  const bytes = new Uint8Array(headerBytes.byteLength + bodyBytes.byteLength)
  bytes.set(headerBytes, 0)
  bytes.set(bodyBytes, headerBytes.byteLength)
  return bytes
}

describe('firehose frame decoding', () => {
  it('decodes an identity frame', () => {
    const decoded = decodeFirehoseFrame(
      frame(
        { op: 1, t: '#identity' },
        {
          did: DID,
          handle: 'Alice.Test',
          seq: 42,
          time: '2026-10-28T10:00:00.000Z',
        },
      ),
    )

    expect(decoded.kind).toBe('event')
    if (decoded.kind !== 'event') return
    expect(decoded.event).toEqual({
      type: 'identity',
      did: DID,
      handle: 'alice.test',
      seq: 42,
      time: new Date('2026-10-28T10:00:00.000Z'),
    })
  })

  it('decodes an account frame with an explicit status', () => {
    const decoded = decodeFirehoseFrame(
      frame(
        { op: 1, t: 'com.atproto.sync.subscribeRepos#account' },
        {
          did: DID,
          active: false,
          status: 'takendown',
          seq: 7,
          time: '2026-10-28T10:00:00.000Z',
        },
      ),
    )

    expect(decoded.kind).toBe('event')
    if (decoded.kind !== 'event' || decoded.event.type !== 'account') return
    expect(decoded.event.status).toBe('takendown')
    expect(decoded.event.active).toBe(false)
  })

  it('ignores error frames and unknown event types', () => {
    expect(decodeFirehoseFrame(frame({ op: -1, error: 'FutureCursor' }, {})).kind).toBe(
      'ignored',
    )
    expect(
      decodeFirehoseFrame(
        frame(
          { op: 1, t: '#commit' },
          { did: DID, seq: 1, time: '2026-10-28T10:00:00.000Z' },
        ),
      ).kind,
    ).toBe('ignored')
  })

  it('ignores frames that are not exactly header plus body', () => {
    const onlyHeader = encode({ op: 1, t: '#identity' } as never)
    expect(decodeFirehoseFrame(onlyHeader).kind).toBe('ignored')
  })
})

describe('firehose event validation', () => {
  it('rejects events with an invalid DID, sequence or timestamp', () => {
    const base = { did: DID, seq: 1, time: '2026-10-28T10:00:00.000Z' }
    expect(parseFirehoseEvent('#identity', { ...base, did: 'alice.test' })).toBeUndefined()
    expect(parseFirehoseEvent('#identity', { ...base, seq: -1 })).toBeUndefined()
    expect(parseFirehoseEvent('#identity', { ...base, seq: 1.5 })).toBeUndefined()
    expect(parseFirehoseEvent('#identity', { ...base, time: 'yesterday' })).toBeUndefined()
    expect(parseFirehoseEvent('#account', { ...base, active: 'yes' })).toBeUndefined()
  })

  it('uses the active flag when the status is missing or not recognized', () => {
    expect(mapAccountStatus('mystery', true)).toBe('active')
    expect(mapAccountStatus('mystery', false)).toBe('unknown')
    expect(mapAccountStatus(undefined, true)).toBe('active')
    expect(mapAccountStatus(undefined, false)).toBe('unknown')
    expect(mapAccountStatus('deactivated', false)).toBe('deactivated')
  })
})
