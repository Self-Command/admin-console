import { com } from '@admin/lexicons'
import type { Logger } from '../logger.js'
import { callUpstream, type XrpcClient } from '../upstream/client.js'
import { bool, iso, rec, shape, str } from './values.js'

export type SigDetail = com.selfcommand.admin.signature.defs.SigDetail
export type AccountView = com.selfcommand.admin.signature.defs.AccountView
export type RelatedAccount = com.selfcommand.admin.signature.defs.RelatedAccount

export type SignatureDeps = {
  ozone: XrpcClient
  logger: Logger
}

export type SignatureAccountsResult =
  com.selfcommand.admin.signature.searchAccounts.$OutputBody
export type RelatedSignatureAccountsResult =
  com.selfcommand.admin.signature.findRelatedAccounts.$OutputBody
export type SignatureCorrelationResult =
  com.selfcommand.admin.signature.findCorrelation.$OutputBody

const OZONE = {
  searchAccounts: 'tools.ozone.signature.searchAccounts',
  findRelatedAccounts: 'tools.ozone.signature.findRelatedAccounts',
  findCorrelation: 'tools.ozone.signature.findCorrelation',
} as const

/**
 * Upstream pages must carry an array; a missing or non-array field means the
 * response cannot be trusted, so it is reported instead of returning [].
 */
function requiredList(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw shape('签名')
  return value
}

function optionalList(value: unknown): unknown[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw shape('签名')
  return value
}

function cursorOf(value: unknown): string | undefined {
  return str(value, 2048)
}

export function normalizeSigDetail(raw: unknown): SigDetail {
  const detail = rec(raw)
  const property = str(detail?.property, 256)
  const value = str(detail?.value, 2048)
  if (!detail || !property || !value) throw shape('签名')
  return { property, value }
}

export function normalizeAccountView(raw: unknown): AccountView {
  const view = rec(raw)
  const did = str(view?.did)
  const handle = str(view?.handle, 256)
  const indexedAt = iso(view?.indexedAt)
  if (!view || !did || !did.startsWith('did:') || !handle || !indexedAt) {
    throw shape('签名')
  }
  const email = str(view.email, 320)
  const relatedRecords = optionalList(view.relatedRecords)
  const invitesDisabled = bool(view.invitesDisabled)
  const emailConfirmedAt = iso(view.emailConfirmedAt)
  const inviteNote = str(view.inviteNote, 2000)
  const deactivatedAt = iso(view.deactivatedAt)
  const threatSignatures = optionalList(view.threatSignatures)?.map(
    normalizeSigDetail,
  )
  return {
    did: did as AccountView['did'],
    handle: handle as AccountView['handle'],
    ...(email ? { email } : {}),
    ...(relatedRecords
      ? { relatedRecords: relatedRecords as AccountView['relatedRecords'] }
      : {}),
    indexedAt: indexedAt as AccountView['indexedAt'],
    ...(invitesDisabled !== undefined ? { invitesDisabled } : {}),
    ...(emailConfirmedAt
      ? { emailConfirmedAt: emailConfirmedAt as AccountView['emailConfirmedAt'] }
      : {}),
    ...(inviteNote ? { inviteNote } : {}),
    ...(deactivatedAt
      ? { deactivatedAt: deactivatedAt as AccountView['deactivatedAt'] }
      : {}),
    ...(threatSignatures ? { threatSignatures } : {}),
  }
}

export function normalizeRelatedAccount(raw: unknown): RelatedAccount {
  const entry = rec(raw)
  if (!entry) throw shape('签名')
  const account = normalizeAccountView(entry.account)
  const similarities = optionalList(entry.similarities)?.map(normalizeSigDetail)
  return {
    account,
    ...(similarities ? { similarities } : {}),
  }
}

export async function searchSignatureAccounts(
  deps: SignatureDeps,
  params: { values: string[]; cursor?: string; limit: number },
): Promise<SignatureAccountsResult> {
  const result = await callUpstream<unknown>(
    deps.ozone,
    OZONE.searchAccounts,
    {
      params: {
        values: params.values,
        cursor: params.cursor,
        limit: params.limit,
      },
    },
  )
  const body = rec(result)
  if (!body) throw shape('签名')
  const cursor = cursorOf(body.cursor)
  return {
    accounts: requiredList(body.accounts).map(normalizeAccountView),
    ...(cursor ? { cursor } : {}),
  }
}

export async function findRelatedSignatureAccounts(
  deps: SignatureDeps,
  params: { did: string; cursor?: string; limit: number },
): Promise<RelatedSignatureAccountsResult> {
  const result = await callUpstream<unknown>(
    deps.ozone,
    OZONE.findRelatedAccounts,
    {
      params: {
        did: params.did,
        cursor: params.cursor,
        limit: params.limit,
      },
    },
  )
  const body = rec(result)
  if (!body) throw shape('签名')
  const cursor = cursorOf(body.cursor)
  return {
    accounts: requiredList(body.accounts).map(normalizeRelatedAccount),
    ...(cursor ? { cursor } : {}),
  }
}

export async function findSignatureCorrelation(
  deps: SignatureDeps,
  params: { dids: string[] },
): Promise<SignatureCorrelationResult> {
  const result = await callUpstream<unknown>(
    deps.ozone,
    OZONE.findCorrelation,
    { params: { dids: params.dids } },
  )
  const body = rec(result)
  if (!body) throw shape('签名')
  return {
    details: requiredList(body.details).map(normalizeSigDetail),
  }
}
