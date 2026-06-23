import { execSync } from 'node:child_process'

/**
 * Vitest globalSetup for integration tests.
 *
 * SAFETY: these tests create and DELETE clients, schedules, jobs, and invoices.
 * They must only ever touch a local, throwaway test database — never the live
 * Supabase production database. We hard-refuse to run otherwise.
 */
export default function setup() {
  const url = process.env.DATABASE_URL ?? ''

  const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)
  const looksProduction = /supabase|pooler|amazonaws|neon|render|prod/i.test(url)

  if (!url || !isLocal || looksProduction) {
    const safe = url.replace(/:[^:@/]+@/, ':***@')
    throw new Error(
      `\n[integration] Refusing to run: DATABASE_URL must point at a LOCAL test database.\n` +
        `  Got: "${safe || '(unset)'}"\n` +
        `  Start the test DB and run, e.g.:\n` +
        `    $env:DATABASE_URL="postgresql://postgres:postgres@localhost:5433/clean_freaks_test"; npm run test:integration\n`,
    )
  }

  // Make sure the throwaway DB has the current schema (idempotent, ~1s).
  execSync('npx prisma db push --skip-generate --accept-data-loss', { stdio: 'inherit' })
}
