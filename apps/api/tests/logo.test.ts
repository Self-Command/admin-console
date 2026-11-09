import { describe, expect, it } from 'vitest'
import { LOGO_MAX_BYTES, decodeLogo } from '../src/settings/logo.js'

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x1a, 0x00, 0x00, 0x00]),
  Buffer.from('WEBPVP8 '),
])

describe('logo upload decoding', () => {
  it('accepts a PNG payload', () => {
    const result = decodeLogo('image/png', PNG.toString('base64'))
    expect(result.mime).toBe('image/png')
    expect(result.bytes.equals(PNG)).toBe(true)
  })

  it('accepts JPEG and WebP magic bytes', () => {
    expect(decodeLogo('image/jpeg', JPEG.toString('base64')).mime).toBe('image/jpeg')
    expect(decodeLogo('image/webp', WEBP.toString('base64')).mime).toBe('image/webp')
  })

  it('rejects a mismatched declared type', () => {
    expect(() => decodeLogo('image/jpeg', PNG.toString('base64'))).toThrow(/does not match/)
  })

  it('rejects unsupported types such as SVG', () => {
    expect(() => decodeLogo('image/svg+xml', Buffer.from('<svg/>').toString('base64'))).toThrow(
      /mime/,
    )
  })

  it('rejects invalid base64 and empty payloads', () => {
    expect(() => decodeLogo('image/png', 'not base64!')).toThrow(/base64/)
    expect(() => decodeLogo('image/png', '')).toThrow(/base64/)
  })

  it('rejects images above the 128 KB limit', () => {
    const oversized = Buffer.concat([PNG, Buffer.alloc(LOGO_MAX_BYTES)])
    expect(() => decodeLogo('image/png', oversized.toString('base64'))).toThrow(/128 KB/)
  })
})
