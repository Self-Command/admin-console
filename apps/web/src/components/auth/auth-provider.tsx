'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  AdminApiError,
  callAdmin as callAdminApi,
  fetchAdminIdentity,
  type AdminIdentity,
} from '@/lib/api/admin-client'
import {
  createPdsSession,
  deletePdsSession,
  type PdsSession,
} from '@/lib/auth/pds'
import {
  clearStoredPdsSession,
  readStoredPdsSession,
  writeStoredPdsSession,
} from '@/lib/auth/session-store'

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated'

export class NoAdminRoleError extends Error {
  constructor() {
    super('account holds no admin role')
    this.name = 'NoAdminRoleError'
  }
}

interface AuthContextValue {
  status: AuthStatus
  identity: AdminIdentity | null
  session: PdsSession | null
  displayName: string | null
  signIn: (input: { service: string; identifier: string; password: string }) => Promise<void>
  signOut: () => Promise<void>
  callAdmin: <T>(
    nsid: string,
    options?: { params?: Record<string, string | string[]>; body?: unknown },
  ) => Promise<T>
}

type AuthState =
  | { status: 'loading' | 'anonymous' }
  | { status: 'authenticated'; session: PdsSession; identity: AdminIdentity }

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    async function restore() {
      const stored = readStoredPdsSession()
      if (!stored) {
        if (!cancelled) setState({ status: 'anonymous' })
        return
      }
      try {
        const { identity, session } = await fetchAdminIdentity(
          stored,
          writeStoredPdsSession,
        )
        if (cancelled) return
        if (!identity.role) {
          clearStoredPdsSession()
          setState({ status: 'anonymous' })
          return
        }
        writeStoredPdsSession(session)
        setState({ status: 'authenticated', session, identity })
      } catch (error) {
        if (cancelled) return
        if (error instanceof AdminApiError && error.kind === 'unauthorized') {
          clearStoredPdsSession()
        }
        setState({ status: 'anonymous' })
      }
    }

    void restore()
    return () => {
      cancelled = true
    }
  }, [])

  const signIn = useCallback(
    async (input: { service: string; identifier: string; password: string }) => {
      const session = await createPdsSession(input)
      try {
        const { identity } = await fetchAdminIdentity(session, writeStoredPdsSession)
        if (!identity.role) throw new NoAdminRoleError()
        writeStoredPdsSession(session)
        setState({ status: 'authenticated', session, identity })
      } catch (error) {
        await deletePdsSession(session)
        throw error
      }
    },
    [],
  )

  const signOut = useCallback(async () => {
    const current = state
    if (current.status === 'authenticated') {
      await deletePdsSession(current.session)
    }
    clearStoredPdsSession()
    setState({ status: 'anonymous' })
  }, [state])

  const callAdmin = useCallback(
    async <T,>(
      nsid: string,
      options: { params?: Record<string, string | string[]>; body?: unknown } = {},
    ): Promise<T> => {
      if (state.status !== 'authenticated') {
        throw new AdminApiError('unauthorized', null)
      }
      try {
        const { data } = await callAdminApi<T>(state.session, nsid, options, (session) => {
          writeStoredPdsSession(session)
          setState((previous) =>
            previous.status === 'authenticated' ? { ...previous, session } : previous,
          )
        })
        return data
      } catch (error) {
        if (error instanceof AdminApiError && error.kind === 'unauthorized') {
          clearStoredPdsSession()
          setState({ status: 'anonymous' })
        }
        throw error
      }
    },
    [state],
  )

  const value = useMemo<AuthContextValue>(() => {
    if (state.status !== 'authenticated') {
      return {
        status: state.status,
        identity: null,
        session: null,
        displayName: null,
        signIn,
        signOut,
        callAdmin,
      }
    }
    return {
      status: 'authenticated',
      identity: state.identity,
      session: state.session,
      displayName: state.session.handle || state.session.did,
      signIn,
      signOut,
      callAdmin,
    }
  }, [state, signIn, signOut, callAdmin])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
