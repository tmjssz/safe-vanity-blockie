import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    // shadcn's generated components import via the "@/*" alias from components.json;
    // Next resolves this from tsconfig.json natively, but Vite/vitest needs it explicitly.
    alias: {
      '@': import.meta.dirname,
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**'],
    // These are jsdom + Radix + userEvent component tests, several of which drive a whole
    // dialog or Select through real pointer/keyboard sequences. Individually they take tens of
    // milliseconds; run as a workspace-wide pool on a shared 6-core VM they have been observed
    // to blow past the 5s default purely from CPU contention, while passing on their own. The
    // timeout is a deadline, not an assertion — raising it loses no coverage, and the alternative
    // (per-test `{ timeout: … }` sprinkled wherever it last flaked) hides the real cause.
    testTimeout: 20_000,
  },
})
