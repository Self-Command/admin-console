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

export const appVersion = process.env.NEXT_PUBLIC_APP_VERSION?.trim() || '1.0.0'

// Development-only shortcut. It is compiled out of production builds and stays
// disabled unless the environment explicitly opts in.
export const devLoginConfig = {
  enabled:
    process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_DEV_LOGIN === '1',
  service: process.env.NEXT_PUBLIC_DEV_LOGIN_SERVICE?.trim() ?? '',
  identifier: process.env.NEXT_PUBLIC_DEV_LOGIN_IDENTIFIER?.trim() ?? '',
  password: process.env.NEXT_PUBLIC_DEV_LOGIN_PASSWORD ?? '',
}
