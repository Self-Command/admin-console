import { isDidString } from '@atproto/lex-schema'
import type { AccountStatus } from '../db/types.js'
import { mapAccountStatus } from './events.js'

export type RepoEntry = {
  did: string
  active: boolean | null
  status: AccountStatus
}

export type RepoPage = {
  cursor?: string
  repos: RepoEntry[]
}

export type PdsClient = {
  listRepos(params: { cursor?: string; limit: number }): Promise<RepoPage>
  resolveHandle(did: string): Promise<string | null>
}

export type PdsClientOptions = {
  timeoutMs: number
  maxBytes: number
}

const HANDLE_PATTERN = /^[a-z0-9.-]+$/i

async function readJsonCapped(response: Response, maxBytes: number): Promise<unknown> {
  const body = response.body
  if (!body) return null
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error('PDS response exceeds the configured size limit')
    }
    chunks.push(value)
  }
  const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
  return JSON.parse(buffer.toString('utf8'))
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function createPdsClient(
  baseUrl: string,
  options: PdsClientOptions,
): PdsClient {
  const request = async (nsid: string, params: Record<string, string>): Promise<unknown> => {
    const url = new URL(`/xrpc/${nsid}`, baseUrl)
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutMs),
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`PDS ${nsid} responded with ${response.status}`)
    }
    return await readJsonCapped(response, options.maxBytes)
  }

  return {
    async listRepos({ cursor, limit }) {
      const params: Record<string, string> = { limit: String(limit) }
      if (cursor) params.cursor = cursor
      const data = asRecord(await request('com.atproto.sync.listRepos', params))
      const repos = data?.repos
      if (!Array.isArray(repos)) {
        throw new Error('PDS listRepos response is missing the repos array')
      }
      const entries: RepoEntry[] = []
      for (const item of repos) {
        const repo = asRecord(item)
        if (!repo) continue
        const did = repo.did
        if (typeof did !== 'string' || !isDidString(did)) continue
        const active = typeof repo.active === 'boolean' ? repo.active : null
        entries.push({
          did,
          active,
          status: mapAccountStatus(repo.status, active ?? undefined),
        })
      }
      const next = typeof data?.cursor === 'string' && data.cursor ? data.cursor : undefined
      return { repos: entries, ...(next ? { cursor: next } : {}) }
    },

    async resolveHandle(did) {
      try {
        const data = asRecord(
          await request('com.atproto.repo.describeRepo', { repo: did }),
        )
        const handle = data?.handle
        if (
          typeof handle === 'string' &&
          handle.length <= 253 &&
          HANDLE_PATTERN.test(handle)
        ) {
          return handle.toLowerCase()
        }
        return null
      } catch {
        return null
      }
    },
  }
}
