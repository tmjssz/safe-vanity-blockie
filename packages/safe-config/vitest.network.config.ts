import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['test/**/*.network.test.ts'], testTimeout: 120_000 },
})
