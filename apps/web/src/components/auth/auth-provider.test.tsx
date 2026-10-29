import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from '@/components/auth/auth-provider'
import { PDS_SESSION_KEY } from '@/lib/auth/session-store'

const PDS = 'https://pds.test'
const STORED = {
  service: PDS,
  did: 'did:plc:alice',
  handle: 'alice.test',
  accessJwt: 'access-1',
  refreshJwt: 'refresh-1',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

interface Route {
  method: string
  path: string
  reply: () => Response
}

function mockFetch(routes: Route[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    const route = routes.find((item) => item.method === method && url.pathname === item.path)
    if (!route) throw new TypeError(`unexpected request ${method} ${url.pathname}`)
    return route.reply()
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const createSession = (reply: Route['reply']): Route => ({
  method: 'POST',
  path: '/xrpc/com.atproto.server.createSession',
  reply,
})
const getServiceAuth = (reply: Route['reply']): Route => ({
  method: 'GET',
  path: '/xrpc/com.atproto.server.getServiceAuth',
  reply,
})
const refreshSession = (reply: Route['reply']): Route => ({
  method: 'POST',
  path: '/xrpc/com.atproto.server.refreshSession',
  reply,
})
const deleteSession = (reply: Route['reply'] = () => new Response(null, { status: 200 })): Route => ({
  method: 'POST',
  path: '/xrpc/com.atproto.server.deleteSession',
  reply,
})
const identityCall = (reply: Route['reply']): Route => ({
  method: 'GET',
  path: '/xrpc/com.selfcommand.admin.session.get',
  reply,
})
const roleListCall = (reply: Route['reply']): Route => ({
  method: 'GET',
  path: '/xrpc/com.selfcommand.admin.role.list',
  reply,
})

function Probe() {
  const auth = useAuth()
  const [message, setMessage] = useState('')
  const run = (operation: Promise<unknown>) => {
    operation.catch((error: unknown) => setMessage(error instanceof Error ? error.name : 'unknown'))
  }
  return (
    <div>
      <span data-testid="status">{auth.status}</span>
      <span data-testid="role">{auth.identity?.role ?? 'none'}</span>
      <span data-testid="name">{auth.displayName ?? ''}</span>
      <span data-testid="error">{message}</span>
      <button
        onClick={() =>
          run(
            auth.signIn({
              service: PDS,
              identifier: 'alice.test',
              password: 'app-password',
            }),
          )
        }
      >
        signin
      </button>
      <button onClick={() => run(auth.signOut())}>signout</button>
      <button onClick={() => run(auth.callAdmin('com.selfcommand.admin.role.list'))}>
        call-admin
      </button>
      <button onClick={() => run(auth.signInPreview('admin', 'preview-2026'))}>preview</button>
    </div>
  )
}

function renderAuth() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  )
}

const sessionBody = {
  did: 'did:plc:alice',
  handle: 'alice.test',
  accessJwt: 'access-1',
  refreshJwt: 'refresh-1',
}

describe('auth provider', () => {
  it('signs in with the PDS, reads the role from admin-api and persists the session', async () => {
    const fetchMock = mockFetch([
      createSession(() => jsonResponse(sessionBody)),
      getServiceAuth(() => jsonResponse({ token: 'service-jwt' })),
      identityCall(() =>
        jsonResponse({ did: 'did:plc:alice', role: 'admin', permissions: ['role.read'] }),
      ),
    ])
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'))

    fireEvent.click(screen.getByText('signin'))

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))
    expect(screen.getByTestId('role').textContent).toBe('admin')
    expect(screen.getByTestId('name').textContent).toBe('alice.test')
    expect(JSON.parse(window.localStorage.getItem(PDS_SESSION_KEY) ?? '{}')).toMatchObject({
      did: 'did:plc:alice',
      accessJwt: 'access-1',
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('shows a generic failure and stores nothing when credentials are rejected', async () => {
    mockFetch([createSession(() => jsonResponse({ error: 'AuthenticationRequired' }, 401))])
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'))

    fireEvent.click(screen.getByText('signin'))

    await waitFor(() => expect(screen.getByTestId('error').textContent).toBe('PdsAuthError'))
    expect(window.localStorage.getItem(PDS_SESSION_KEY)).toBeNull()
  })

  it('refuses accounts without a role and clears the temporary session', async () => {
    const fetchMock = mockFetch([
      createSession(() => jsonResponse(sessionBody)),
      getServiceAuth(() => jsonResponse({ token: 'service-jwt' })),
      identityCall(() => jsonResponse({ did: 'did:plc:alice', permissions: [] })),
      deleteSession(),
    ])
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'))

    fireEvent.click(screen.getByText('signin'))

    await waitFor(() => expect(screen.getByTestId('error').textContent).toBe('NoAdminRoleError'))
    expect(window.localStorage.getItem(PDS_SESSION_KEY)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('restores a stored session, silently refreshing an expired access token', async () => {
    window.localStorage.setItem(PDS_SESSION_KEY, JSON.stringify(STORED))
    let authCalls = 0
    mockFetch([
      getServiceAuth(() => {
        authCalls += 1
        return authCalls === 1
          ? jsonResponse({ error: 'ExpiredToken' }, 401)
          : jsonResponse({ token: 'service-jwt-2' })
      }),
      refreshSession(() =>
        jsonResponse({
          did: 'did:plc:alice',
          handle: 'alice.test',
          accessJwt: 'access-2',
          refreshJwt: 'refresh-2',
        }),
      ),
      identityCall(() =>
        jsonResponse({ did: 'did:plc:alice', role: 'viewer', permissions: ['directory.read'] }),
      ),
    ])

    renderAuth()

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))
    expect(screen.getByTestId('role').textContent).toBe('viewer')
    expect(JSON.parse(window.localStorage.getItem(PDS_SESSION_KEY) ?? '{}')).toMatchObject({
      accessJwt: 'access-2',
      refreshJwt: 'refresh-2',
    })
  })

  it('returns to the login state and clears storage when refresh fails', async () => {
    window.localStorage.setItem(PDS_SESSION_KEY, JSON.stringify(STORED))
    mockFetch([
      getServiceAuth(() => jsonResponse({ error: 'ExpiredToken' }, 401)),
      refreshSession(() => jsonResponse({ error: 'ExpiredToken' }, 401)),
    ])

    renderAuth()

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'))
    expect(window.localStorage.getItem(PDS_SESSION_KEY)).toBeNull()
  })

  it('returns to the login state when an admin call stays unauthorized after refresh', async () => {
    window.localStorage.setItem(PDS_SESSION_KEY, JSON.stringify(STORED))
    mockFetch([
      getServiceAuth(() => jsonResponse({ token: 'service-jwt' })),
      identityCall(() =>
        jsonResponse({ did: 'did:plc:alice', role: 'admin', permissions: ['role.read'] }),
      ),
      roleListCall(() => jsonResponse({ error: 'ExpiredToken' }, 401)),
      refreshSession(() =>
        jsonResponse({
          did: 'did:plc:alice',
          handle: 'alice.test',
          accessJwt: 'access-2',
          refreshJwt: 'refresh-2',
        }),
      ),
    ])

    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))

    fireEvent.click(screen.getByText('call-admin'))

    await waitFor(() => expect(screen.getByTestId('error').textContent).toBe('AdminApiError'))
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'))
    expect(window.localStorage.getItem(PDS_SESSION_KEY)).toBeNull()
  })

  it('clears the local session and the remote PDS session on logout', async () => {
    window.localStorage.setItem(PDS_SESSION_KEY, JSON.stringify(STORED))
    mockFetch([
      getServiceAuth(() => jsonResponse({ token: 'service-jwt' })),
      identityCall(() => jsonResponse({ did: 'did:plc:alice', role: 'admin', permissions: [] })),
      deleteSession(),
    ])
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))

    fireEvent.click(screen.getByText('signout'))

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'))
    expect(window.localStorage.getItem(PDS_SESSION_KEY)).toBeNull()
  })

  it('keeps the local preview login available outside production', async () => {
    mockFetch([])
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'))

    fireEvent.click(screen.getByText('preview'))

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))
    expect(screen.getByTestId('role').textContent).toBe('admin')
    expect(screen.getByTestId('name').textContent).toBe('预览管理员')
  })
})
