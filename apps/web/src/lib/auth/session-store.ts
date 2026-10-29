import type { PdsSession } from '@/lib/auth/pds'

export const PDS_SESSION_KEY = 'sc_admin_pds_session'

export function readStoredPdsSession(): PdsSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(PDS_SESSION_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<PdsSession>
    if (
      typeof value.service !== 'string' ||
      typeof value.did !== 'string' ||
      typeof value.handle !== 'string' ||
      typeof value.accessJwt !== 'string' ||
      typeof value.refreshJwt !== 'string'
    ) {
      return null
    }
    return value as PdsSession
  } catch {
    return null
  }
}

export function writeStoredPdsSession(session: PdsSession) {
  window.localStorage.setItem(PDS_SESSION_KEY, JSON.stringify(session))
}

export function clearStoredPdsSession() {
  window.localStorage.removeItem(PDS_SESSION_KEY)
}
