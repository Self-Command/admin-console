import path from 'node:path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Standalone output is only needed for the container image; on Windows the
  // trace copy step needs symlink privileges, so keep local builds plain.
  output: process.env.NEXT_STANDALONE === '1' ? 'standalone' : undefined,
  // A separate output directory lets a production build run while `next dev`
  // owns `.next`, without invalidating the running preview.
  distDir: process.env.NEXT_DIST_DIR?.trim() || '.next',
  outputFileTracingRoot: path.join(process.cwd(), '..', '..'),
  reactStrictMode: true,
}

export default nextConfig
