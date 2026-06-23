import { defineConfig } from 'vitest/config'
import path from 'path'

// Integration tests run against a REAL Postgres (a throwaway local container),
// never production. They are kept separate from the fast unit suite (`npm test`)
// and run serially because they share one database.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/integration/**/*.test.ts'],
    globalSetup: ['./__tests__/integration/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
