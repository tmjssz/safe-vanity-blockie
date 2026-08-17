import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // core and safe-config ship compiled ESM, so no transpilation is needed. If a future
  // dependency ships TypeScript or ESM-only CJS interop breaks, add it to transpilePackages.
  reactStrictMode: true,
  // `next dev` only trusts localhost by default, so hitting the app on the loopback IP
  // gets its HMR requests blocked. Dev-only option; ignored by `next build`.
  allowedDevOrigins: ['127.0.0.1'],
}

export default nextConfig
