// scripts/backfill-schedule-pay-type.ts
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log("Starting backfill for Schedule.subcontractorPayType...")

  // Find all schedules
  const schedules = await prisma.schedule.findMany({
    include: {
      location: {
        include: {
          client: true,
        },
      },
    },
  })

  let updatedCount = 0

  for (const schedule of schedules) {
    // If the database defaulted to PER_CLEAN, but the client is FLAT_RATE
    if (
      schedule.subcontractorPayType === 'PER_CLEAN' &&
      schedule.location?.client?.cleanerPayType === 'FLAT_RATE'
    ) {
      console.log(`Updating Schedule ID: ${schedule.id} for Client: ${schedule.location.client.name} to FLAT_RATE`)
      
      await prisma.schedule.update({
        where: { id: schedule.id },
        data: {
          subcontractorPayType: 'FLAT_RATE',
        },
      })
      updatedCount++
    }
  }

  console.log(`Backfill complete. Updated ${updatedCount} schedules.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
