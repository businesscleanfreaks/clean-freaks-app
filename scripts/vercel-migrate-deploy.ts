import { spawnSync } from 'node:child_process'

const isProductionVercel = process.env.VERCEL_ENV === 'production'
const force = process.env.FORCE_PRISMA_MIGRATE_DEPLOY === 'true'

if (process.env.SKIP_PRISMA_MIGRATE_DEPLOY === 'true') {
  console.log('[migrate] Skipping because SKIP_PRISMA_MIGRATE_DEPLOY=true')
  process.exit(0)
}

if (!isProductionVercel && !force) {
  console.log('[migrate] Skipping Prisma migrate deploy outside Vercel production')
  process.exit(0)
}

if (!process.env.DATABASE_URL) {
  console.error('[migrate] DATABASE_URL is required for Prisma migrate deploy')
  process.exit(1)
}

if (process.env.DATABASE_URL.startsWith('file:')) {
  console.error('[migrate] Refusing to run Prisma migrate deploy against a file database')
  process.exit(1)
}

console.log('[migrate] Running Prisma migrate deploy')
const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
})

if (result.error) {
  console.error('[migrate] Failed to start Prisma migrate deploy:', result.error.message)
}

process.exit(result.status ?? 1)
