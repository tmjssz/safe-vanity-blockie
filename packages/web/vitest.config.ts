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
  },
})
