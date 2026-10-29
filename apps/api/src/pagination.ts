const MAX_CURSOR_LENGTH = 512

export function encodeCursor(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

export function decodeCursor(cursor: string): string | null {
  if (cursor.length > MAX_CURSOR_LENGTH * 2) return null
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8')
    if (!decoded || decoded.length > MAX_CURSOR_LENGTH) return null
    if (!/^[\x20-\x7e]+$/.test(decoded)) return null
    return decoded
  } catch {
    return null
  }
}
