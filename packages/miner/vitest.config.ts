import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/**/*.network.test.ts', '**/node_modules/**'],
    testTimeout: 60_000,
  },
})
