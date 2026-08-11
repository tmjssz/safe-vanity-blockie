import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // core and safe-config ship compiled ESM, so no transpilation is needed. If a future
  // dependency ships TypeScript or ESM-only CJS interop breaks, add it to transpilePackages.
  reactStrictMode: true,
}

export default nextConfig
