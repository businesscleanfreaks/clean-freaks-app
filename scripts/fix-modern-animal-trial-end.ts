/**
 * One-off data fix for the Modern Animal trial schedule.
 *
 * Josh: "modern animal data is different than the source of truth google sheet. there are
 * extra dates outside of the trial and start date period."
 *
 * Root cause: when the trial client was created, the schedule was saved without an endDate.
 * calculateScheduleDates then projects out for the default 3-month horizon, so jobs are
 * generated well past the trial window. Source-of-truth says Modern Animal's trial runs
 * May 19 → June 19 2026.
 *
 * This script finds Modern Animal's active schedule, sets endDate = June 19 2026, and
 * deletes uninvoiced/unpaid SCHEDULED jobs after that date.
 *
 * Usage:
 *   npx tsx scripts/fix-modern-animal-trial-end.ts            # dry run
 *   npx tsx scripts/fix-modern-animal-trial-end.ts --apply    # actually write
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')

function utcDate(year: number, monthIndex: number, day: number) {
  return new Date(Date.UTC(year, monthIndex, day, 12, 0, 0))
}

async function main() {
  console.log(APPLY ? 'Applying Modern Animal trial endDate fix...' : 'Dry run only. Re-run with --apply.')

  const client = await prisma.client.findFirst({
    where: { name: { contains: 'Modern Animal', mode: 'insensitive' } },
    include: { locations: { include: { schedules: true } } },
  })

  if (!client) {
    console.log('Modern Animal client not found.')
    return
  }

  const trialEnd = utcDate(2026, 5, 19) // June 19, 2026 (month index 5 = June)

  const schedules = client.locations.flatMap(loc => loc.schedules).filter(s => s.isActive)
  console.log(`Found ${schedules.length} active schedule(s) for ${client.name}.`)

  let schedulesUpdated = 0
  let jobsRemoved = 0

  for (const schedule of schedules) {
    const currentEnd = schedule.endDate
    const needsEndDate = !currentEnd || new Date(currentEnd) > trialEnd

    if (needsEndDate) {
      console.log(`Schedule ${schedule.id}: setting endDate to 2026-06-19 (was ${currentEnd?.toISOString().slice(0, 10) || 'null'})`)
      if (APPLY) {
        await prisma.schedule.update({
          where: { id: schedule.id },
          data: { endDate: trialEnd },
        })
      }
      schedulesUpdated++
    }

    // Find future jobs past the trial end that aren't on a final invoice or paid
    const futureJobs = await prisma.job.findMany({
      where: {
        scheduleId: schedule.id,
        date: { gt: trialEnd },
        status: 'SCHEDULED',
        invoiced: false,
        subcontractorPaid: false,
      },
      include: {
        invoiceLineItems: { include: { invoice: { select: { status: true } } } },
        paymentLineItems: { select: { id: true } },
      },
    })

    for (const job of futureJobs) {
      const onFinal = job.invoiceLineItems.some(li => li.invoice?.status === 'SENT' || li.invoice?.status === 'PAID')
      if (onFinal || job.paymentLineItems.length > 0) continue

      console.log(`  Deleting out-of-window job ${job.id} on ${job.date.toISOString().slice(0, 10)}`)
      if (APPLY) {
        await prisma.invoiceLineItem.deleteMany({ where: { jobId: job.id } })
        await prisma.addOnService.deleteMany({ where: { jobId: job.id } })
        await prisma.job.delete({ where: { id: job.id } })
      }
      jobsRemoved++
    }
  }

  console.log(JSON.stringify({ apply: APPLY, schedulesUpdated, jobsRemoved }, null, 2))
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
