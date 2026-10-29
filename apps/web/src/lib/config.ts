export const adminApiConfig = {
  url: (process.env.NEXT_PUBLIC_ADMIN_API_URL?.trim() || 'http://127.0.0.1:2587').replace(
    /\/+$/,
    '',
  ),
  serviceDid:
    process.env.NEXT_PUBLIC_ADMIN_API_DID?.trim() || 'did:web:localhost%3A2587',
}

export const defaultPdsUrl =
  process.env.NEXT_PUBLIC_DEFAULT_PDS?.trim() || 'https://bsky.social'

// Local demo login is compiled out of production builds.
export const previewAuthEnabled = process.env.NODE_ENV !== 'production'
