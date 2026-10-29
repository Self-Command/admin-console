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
  clearPreviewSession,
  readPreviewSession,
  signInPreview as previewSignIn,
  writePreviewSession,
  type PreviewSession,
} from '@/lib/auth/preview-auth'
import {
  clearStoredPdsSession,
  readStoredPdsSession,
  writeStoredPdsSession,
} from '@/lib/auth/session-store'
import { previewAuthEnabled } from '@/lib/config'
import type { Permission, RoleName } from '@/lib/roles'

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
  preview: boolean
  displayName: string | null
  signIn: (input: { service: string; identifier: string; password: string }) => Promise<void>
  signInPreview: (username: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  callAdmin: <T>(
    nsid: string,
    options?: { params?: Record<string, string>; body?: unknown },
  ) => Promise<T>
}

type AuthState =
  | { status: 'loading' | 'anonymous' }
  | { status: 'authenticated'; session: PdsSession; identity: AdminIdentity }
  | { status: 'authenticated'; preview: PreviewSession; identity: AdminIdentity }

const AuthContext = createContext<AuthContextValue | null>(null)

const PREVIEW_ROLE_PERMISSIONS: Record<RoleName, Permission[]> = {
  admin: ['directory.read', 'role.read', 'role.write', 'audit.read'],
  operator: ['directory.read'],
  viewer: ['directory.read'],
}

function previewIdentity(session: PreviewSession): AdminIdentity {
  return {
    did: session.did,
    role: session.role,
    permissions: PREVIEW_ROLE_PERMISSIONS[session.role],
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    async function restore() {
      const stored = readStoredPdsSession()
      if (stored) {
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
          return
        } catch (error) {
          if (cancelled) return
          if (error instanceof AdminApiError && error.kind === 'unauthorized') {
            clearStoredPdsSession()
          }
          setState({ status: 'anonymous' })
          return
        }
      }

      if (previewAuthEnabled) {
        const preview = readPreviewSession()
        if (preview && !cancelled) {
          setState({
            status: 'authenticated',
            preview,
            identity: previewIdentity(preview),
          })
          return
        }
      }

      if (!cancelled) setState({ status: 'anonymous' })
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
        clearPreviewSession()
        setState({ status: 'authenticated', session, identity })
      } catch (error) {
        await deletePdsSession(session)
        throw error
      }
    },
    [],
  )

  const signInPreview = useCallback(async (username: string, password: string) => {
    if (!previewAuthEnabled) throw new NoAdminRoleError()
    const preview = previewSignIn(username, password)
    if (!preview) throw new Error('preview credentials rejected')
    const previous = readStoredPdsSession()
    if (previous) {
      await deletePdsSession(previous)
      clearStoredPdsSession()
    }
    writePreviewSession(preview)
    setState({
      status: 'authenticated',
      preview,
      identity: previewIdentity(preview),
    })
  }, [])

  const signOut = useCallback(async () => {
    const current = state
    if (current.status === 'authenticated' && 'session' in current) {
      await deletePdsSession(current.session)
    }
    clearStoredPdsSession()
    clearPreviewSession()
    setState({ status: 'anonymous' })
  }, [state])

  const callAdmin = useCallback(
    async <T,>(
      nsid: string,
      options: { params?: Record<string, string>; body?: unknown } = {},
    ): Promise<T> => {
      if (state.status !== 'authenticated' || !('session' in state)) {
        throw new AdminApiError('unauthorized', null)
      }
      try {
        const { data } = await callAdminApi<T>(state.session, nsid, options, (session) => {
          writeStoredPdsSession(session)
          setState((previous) =>
            previous.status === 'authenticated' && 'session' in previous
              ? { ...previous, session }
              : previous,
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
        preview: false,
        displayName: null,
        signIn,
        signInPreview,
        signOut,
        callAdmin,
      }
    }
    const preview = 'preview' in state
    return {
      status: state.status,
      identity: state.identity,
      session: preview ? null : state.session,
      preview,
      displayName: preview
        ? state.preview.displayName
        : state.session.handle || state.session.did,
      signIn,
      signInPreview,
      signOut,
      callAdmin,
    }
  }, [state, signIn, signInPreview, signOut, callAdmin])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
