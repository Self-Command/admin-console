export type CsvCell = string | number | null | undefined

export function csvField(value: CsvCell): string {
  if (value === undefined || value === null) return ''
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function renderCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const lines = [header.map(csvField).join(',')]
  for (const row of rows) {
    lines.push(row.map(csvField).join(','))
  }
  return `\ufeff${lines.join('\r\n')}\r\n`
}

export function isoDate(value: Date | string | null | undefined): string {
  if (value === undefined || value === null) return ''
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}
