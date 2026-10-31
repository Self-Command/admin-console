import { describe, expect, it } from 'vitest'
import { csvField, isoDate, renderCsv } from '../src/services/csv.js'

describe('csv rendering', () => {
  it('writes a UTF-8 BOM, a header row and CRLF line endings', () => {
    const text = renderCsv(['账号', '数量'], [['alice.test', 3]])
    expect(text).toBe('\ufeff账号,数量\r\nalice.test,3\r\n')
  })

  it('escapes quotes, commas and newlines', () => {
    expect(csvField('a,b')).toBe('"a,b"')
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
    expect(csvField('line1\nline2')).toBe('"line1\nline2"')
    expect(csvField('cr\rlf')).toBe('"cr\rlf"')
    expect(csvField('')).toBe('')
    expect(csvField(null)).toBe('')
    expect(csvField(undefined)).toBe('')
    expect(csvField(12)).toBe('12')
  })

  it('keeps fixed column order across rows', () => {
    const text = renderCsv(
      ['日期', '举报量'],
      [
        ['2026-10-29', 4],
        ['2026-10-28', 0],
      ],
    )
    expect(text.split('\r\n').filter(Boolean)).toEqual([
      '\ufeff日期,举报量',
      '2026-10-29,4',
      '2026-10-28,0',
    ])
  })

  it('formats dates as ISO 8601 and blanks invalid input', () => {
    expect(isoDate(new Date('2026-10-29T08:00:00.000Z'))).toBe('2026-10-29T08:00:00.000Z')
    expect(isoDate('2026-10-29T08:00:00.000Z')).toBe('2026-10-29T08:00:00.000Z')
    expect(isoDate('not-a-date')).toBe('')
    expect(isoDate(null)).toBe('')
    expect(isoDate(undefined)).toBe('')
  })
})
