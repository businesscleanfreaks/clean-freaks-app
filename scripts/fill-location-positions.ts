/**
 * Give every location without a map position one, from its address.
 *
 *   npx tsx --env-file=.env scripts/fill-location-positions.ts           # look only
 *   npx tsx --env-file=.env scripts/fill-location-positions.ts --apply   # save
 *
 * Only fills empty positions; never changes one already there. Prints the
 * database host first, so it is clear which database is being filled.
 * See lib/location-positions.ts.
 */
import { PrismaClient } from '@prisma/client'
import { fillMissingPositions } from '../lib/location-positions'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set. Pass --env-file=.env (or set it) first.')
  const apply = process.argv.includes('--apply')
  console.log(`Database: ${new URL(url).host}`)
  console.log(apply ? 'Saving positions.' : 'Looking only. Nothing is saved. Add --apply to save.')

  const prisma = new PrismaClient()
  try {
    const result = await fillMissingPositions(prisma, { apply })
    console.log(`\n${apply ? 'Placed' : 'Would place'}: ${result.placed.length}`)
    console.log(`Not found: ${result.notFound.length}`)
    for (const row of result.notFound) console.log(`  - ${row.client} · ${row.location} · "${row.address}"`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
