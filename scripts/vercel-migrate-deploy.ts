import { spawnSync } from 'node:child_process'

const isProductionVercel = process.env.VERCEL_ENV === 'production'
const force = process.env.FORCE_PRISMA_MIGRATE_DEPLOY === 'true'
const migrationDatabaseUrl =
  process.env.PRISMA_MIGRATE_DATABASE_URL ||
  process.env.MIGRATE_DATABASE_URL ||
  process.env.DIRECT_URL ||
  process.env.DATABASE_URL
const migrateTimeoutMs = Number.parseInt(process.env.PRISMA_MIGRATE_DEPLOY_TIMEOUT_MS || '120000', 10)

if (process.env.SKIP_PRISMA_MIGRATE_DEPLOY === 'true') {
  console.log('[migrate] Skipping because SKIP_PRISMA_MIGRATE_DEPLOY=true')
  process.exit(0)
}

if (!isProductionVercel && !force) {
  console.log('[migrate] Skipping Prisma migrate deploy outside Vercel production')
  process.exit(0)
}

if (!migrationDatabaseUrl) {
  console.error('[migrate] DATABASE_URL is required for Prisma migrate deploy')
  process.exit(1)
}

if (migrationDatabaseUrl.startsWith('file:')) {
  console.error('[migrate] Refusing to run Prisma migrate deploy against a file database')
  process.exit(1)
}

if (
  !process.env.PRISMA_MIGRATE_DATABASE_URL &&
  !process.env.MIGRATE_DATABASE_URL &&
  !process.env.DIRECT_URL &&
  /\.pooler\.supabase\.com(?::6543)?\//i.test(migrationDatabaseUrl)
) {
  console.warn(
    '[migrate] Skipping Prisma migrate deploy because DATABASE_URL points at the Supabase transaction pooler. ' +
    'Set PRISMA_MIGRATE_DATABASE_URL, MIGRATE_DATABASE_URL, or DIRECT_URL to a Supabase direct/session connection to run migrations in Vercel.',
  )
  process.exit(0)
}

function describeDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`
  } catch {
    return 'configured database'
  }
}

console.log(`[migrate] Running Prisma migrate deploy against ${describeDatabaseUrl(migrationDatabaseUrl)}`)
const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: migrationDatabaseUrl },
  shell: process.platform === 'win32',
  timeout: Number.isFinite(migrateTimeoutMs) && migrateTimeoutMs > 0 ? migrateTimeoutMs : 120000,
})

if (result.error) {
  console.error('[migrate] Failed to start Prisma migrate deploy:', result.error.message)
  if ((result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
    console.error('[migrate] Prisma migrate deploy timed out')
  }
}

process.exit(result.status ?? 1)
