// Preview-only sign-in used until task 4.2 wires the real PDS OAuth flow.
// Credentials never leave the browser and no request is made.

import type { RoleName } from '@/lib/roles'

export interface PreviewSession {
  username: string
  displayName: string
  did: string
  role: RoleName
  issuedAt: string
}

interface PreviewAccount {
  password: string
  displayName: string
  did: string
  role: RoleName
}

const PREVIEW_ACCOUNTS: Record<string, PreviewAccount> = {
  admin: {
    password: 'preview-2026',
    displayName: '预览管理员',
    did: 'did:web:ops.selfcommand.example',
    role: 'admin',
  },
}

export const PREVIEW_CREDENTIALS = { username: 'admin', password: 'preview-2026' }

const STORAGE_KEY = 'sc-admin.preview-session'

export function signInPreview(username: string, password: string): PreviewSession | null {
  const account = PREVIEW_ACCOUNTS[username.trim()]
  if (!account || account.password !== password) return null
  return {
    username: username.trim(),
    displayName: account.displayName,
    did: account.did,
    role: account.role,
    issuedAt: new Date().toISOString(),
  }
}

export function readPreviewSession(): PreviewSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PreviewSession>
    if (!parsed.username || !parsed.role || !parsed.did) return null
    return parsed as PreviewSession
  } catch {
    return null
  }
}

export function writePreviewSession(session: PreviewSession) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
}

export function clearPreviewSession() {
  window.localStorage.removeItem(STORAGE_KEY)
}
