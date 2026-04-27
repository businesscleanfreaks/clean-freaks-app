import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { regenerateJobsForSchedule } from '@/lib/regenerate-schedule-jobs'

function toNoonUTC(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
}

function dayRange(dateStr: string): { gte: Date; lt: Date } {
  const d = toNoonUTC(dateStr)
  return {
    gte: new Date(d.getTime() - 12 * 60 * 60 * 1000),
    lt: new Date(d.getTime() + 12 * 60 * 60 * 1000),
  }
}

type CorrectionResult = {
  status: 'done' | 'preview' | 'skipped'
  reason?: string
  [key: string]: unknown
}

export async function POST(request: Request) {
  try {
    await requireAuth()
    const body = await request.json()
    const dryRun = !body.confirm
    const results: Record<string, CorrectionResult> = {}

    // ═══════════════════════════════════════════════════════════
    // 1. MAS IRON — Last clean Feb 6, then paused
    // ═══════════════════════════════════════════════════════════
    const masIron = await prisma.client.findFirst({ where: { name: { contains: 'Mas Iron' } } })
    if (masIron) {
      const locations = await prisma.location.findMany({ where: { clientId: masIron.id } })
      const locationIds = locations.map(l => l.id)
      const cutoff = toNoonUTC('2026-02-06')

      if (dryRun) {
        const toComplete = await prisma.job.count({
          where: { locationId: { in: locationIds }, date: { lte: cutoff }, status: 'SCHEDULED' },
        })
        const toCancel = await prisma.job.count({
          where: { locationId: { in: locationIds }, date: { gt: cutoff }, status: 'SCHEDULED', invoiced: false },
        })
        results.masIron = { status: 'preview', wouldComplete: toComplete, wouldCancel: toCancel }
      } else {
        const completed = await prisma.job.updateMany({
          where: { locationId: { in: locationIds }, date: { lte: cutoff }, status: 'SCHEDULED' },
          data: { status: 'COMPLETED' },
        })
        const cancelled = await prisma.job.updateMany({
          where: { locationId: { in: locationIds }, date: { gt: cutoff }, status: 'SCHEDULED', invoiced: false },
          data: { status: 'CANCELLED' },
        })
        await prisma.schedule.updateMany({ where: { locationId: { in: locationIds } }, data: { isActive: false } })
        await prisma.client.update({ where: { id: masIron.id }, data: { isActive: false } })
        results.masIron = { status: 'done', jobsCompleted: completed.count, jobsCancelled: cancelled.count }
      }
    } else {
      results.masIron = { status: 'skipped', reason: 'Client not found' }
    }

    // ═══════════════════════════════════════════════════════════
    // 2. SOUZI ZEROUNIAN — Create Marcia, assign, rate $250
    // ═══════════════════════════════════════════════════════════
    const souzi = await prisma.client.findFirst({ where: { name: { contains: 'Souzi' } } })
    if (souzi) {
      const souziLocations = await prisma.location.findMany({ where: { clientId: souzi.id } })
      const souziLocationIds = souziLocations.map(l => l.id)
      const souziSchedules = await prisma.schedule.findMany({ where: { locationId: { in: souziLocationIds } } })

      if (dryRun) {
        const futureJobs = await prisma.job.count({
          where: { locationId: { in: souziLocationIds }, status: 'SCHEDULED' },
        })
        results.souzi = {
          status: 'preview',
          wouldCreateMarcia: true,
          wouldAssignToJobs: futureJobs,
          wouldChangeRateFrom: souziSchedules[0]?.defaultSubcontractorRate ?? 'N/A',
          wouldChangeRateTo: 250,
          schedulesFound: souziSchedules.length,
        }
      } else {
        let marcia = await prisma.subcontractor.findFirst({ where: { name: { contains: 'Marcia' } } })
        if (!marcia) {
          marcia = await prisma.subcontractor.create({ data: { name: 'Marcia' } })
        }
        for (const schedule of souziSchedules) {
          await prisma.schedule.update({
            where: { id: schedule.id },
            data: { subcontractorId: marcia.id, defaultSubcontractorRate: 250 },
          })
          await regenerateJobsForSchedule(schedule.id)
        }
        results.souzi = {
          status: 'done',
          marciaId: marcia.id,
          schedulesUpdated: souziSchedules.length,
        }
      }
    } else {
      results.souzi = { status: 'skipped', reason: 'Client not found' }
    }

    // ═══════════════════════════════════════════════════════════
    // 3. PARA PERFORMANCE — Only Jan 2 & Jan 21, then paused
    // ═══════════════════════════════════════════════════════════
    const para = await prisma.client.findFirst({ where: { name: { contains: 'Para' } } })
    if (para) {
      const paraLocations = await prisma.location.findMany({ where: { clientId: para.id } })
      const paraLocationIds = paraLocations.map(l => l.id)
      const jan2Range = dayRange('2026-01-02')
      const jan21Range = dayRange('2026-01-21')

      if (dryRun) {
        const jan2Jobs = await prisma.job.count({
          where: { locationId: { in: paraLocationIds }, date: jan2Range },
        })
        const jan21Jobs = await prisma.job.count({
          where: { locationId: { in: paraLocationIds }, date: jan21Range },
        })
        const toCancel = await prisma.job.count({
          where: { locationId: { in: paraLocationIds }, status: 'SCHEDULED', invoiced: false },
        })
        results.para = {
          status: 'preview',
          jan2JobsFound: jan2Jobs,
          jan21JobsFound: jan21Jobs,
          wouldCancelOthers: toCancel,
        }
      } else {
        const jan2Completed = await prisma.job.updateMany({
          where: { locationId: { in: paraLocationIds }, date: jan2Range, status: { not: 'COMPLETED' } },
          data: { status: 'COMPLETED' },
        })
        const jan21Completed = await prisma.job.updateMany({
          where: { locationId: { in: paraLocationIds }, date: jan21Range, status: { not: 'COMPLETED' } },
          data: { status: 'COMPLETED' },
        })
        const cancelled = await prisma.job.updateMany({
          where: { locationId: { in: paraLocationIds }, status: 'SCHEDULED', invoiced: false },
          data: { status: 'CANCELLED' },
        })
        await prisma.schedule.updateMany({ where: { locationId: { in: paraLocationIds } }, data: { isActive: false } })
        await prisma.client.update({ where: { id: para.id }, data: { isActive: false } })
        results.para = {
          status: 'done',
          jan2Marked: jan2Completed.count,
          jan21Marked: jan21Completed.count,
          othersCancelled: cancelled.count,
        }
      }
    } else {
      results.para = { status: 'skipped', reason: 'Client not found' }
    }

    // ═══════════════════════════════════════════════════════════
    // 4. INTERIOR DOORS — Switch to bi-weekly Friday
    //    Completed cleans: Jan 5, 9, 16, 30, Feb 13, 27
    // ═══════════════════════════════════════════════════════════
    const interiorDoors = await prisma.client.findFirst({ where: { name: { contains: 'Interior Door' } } })
    if (interiorDoors) {
      const idLocations = await prisma.location.findMany({ where: { clientId: interiorDoors.id } })
      const idLocationIds = idLocations.map(l => l.id)
      const idSchedules = await prisma.schedule.findMany({ where: { locationId: { in: idLocationIds } } })
      const completedDates = ['2026-01-05', '2026-01-09', '2026-01-16', '2026-01-30', '2026-02-13', '2026-02-27']

      if (dryRun) {
        const jobsForDates = await Promise.all(
          completedDates.map(async (d) => {
            const range = dayRange(d)
            const count = await prisma.job.count({ where: { locationId: { in: idLocationIds }, date: range } })
            return { date: d, found: count }
          })
        )
        const totalScheduled = await prisma.job.count({
          where: { locationId: { in: idLocationIds }, status: 'SCHEDULED', invoiced: false },
        })
        results.interiorDoors = {
          status: 'preview',
          jobsForCompletedDates: jobsForDates,
          totalScheduledToCancel: totalScheduled,
          schedulesFound: idSchedules.length,
          wouldChangeToBI_WEEKLY: true,
        }
      } else {
        let markedCount = 0
        for (const dateStr of completedDates) {
          const range = dayRange(dateStr)
          const existingJob = await prisma.job.findFirst({
            where: { locationId: { in: idLocationIds }, date: range },
          })
          if (existingJob) {
            if (existingJob.status !== 'COMPLETED') {
              await prisma.job.update({ where: { id: existingJob.id }, data: { status: 'COMPLETED' } })
              markedCount++
            }
          } else if (idLocationIds.length > 0) {
            const schedule = idSchedules[0]
            await prisma.job.create({
              data: {
                locationId: idLocationIds[0],
                scheduleId: schedule?.id,
                subcontractorId: schedule?.subcontractorId,
                date: toNoonUTC(dateStr),
                clientRate: schedule?.defaultClientRate ?? 200,
                subcontractorRate: schedule?.defaultSubcontractorRate ?? 120,
                status: 'COMPLETED',
              },
            })
            markedCount++
          }
        }

        const cancelled = await prisma.job.updateMany({
          where: { locationId: { in: idLocationIds }, status: 'SCHEDULED', invoiced: false },
          data: { status: 'CANCELLED' },
        })

        for (const schedule of idSchedules) {
          await prisma.schedule.update({
            where: { id: schedule.id },
            data: {
              frequency: 'BI_WEEKLY',
              daysOfWeek: JSON.stringify([5]),
              startDate: toNoonUTC('2026-01-30'),
            },
          })
          await regenerateJobsForSchedule(schedule.id)
        }

        results.interiorDoors = {
          status: 'done',
          datesMarkedCompleted: markedCount,
          jobsCancelled: cancelled.count,
          schedulesUpdated: idSchedules.length,
        }
      }
    } else {
      results.interiorDoors = { status: 'skipped', reason: 'Client not found' }
    }

    // ═══════════════════════════════════════════════════════════
    // 5. FIG TREE THERAPY — Paused/cancelled
    // ═══════════════════════════════════════════════════════════
    const figTree = await prisma.client.findFirst({ where: { name: { contains: 'Fig Tree' } } })
    if (figTree) {
      const ftLocations = await prisma.location.findMany({ where: { clientId: figTree.id } })
      const ftLocationIds = ftLocations.map(l => l.id)

      if (dryRun) {
        const toCancel = await prisma.job.count({
          where: { locationId: { in: ftLocationIds }, status: 'SCHEDULED', invoiced: false },
        })
        results.figTree = { status: 'preview', wouldCancel: toCancel }
      } else {
        const cancelled = await prisma.job.updateMany({
          where: { locationId: { in: ftLocationIds }, status: 'SCHEDULED', invoiced: false },
          data: { status: 'CANCELLED' },
        })
        await prisma.schedule.updateMany({ where: { locationId: { in: ftLocationIds } }, data: { isActive: false } })
        await prisma.client.update({ where: { id: figTree.id }, data: { isActive: false } })
        results.figTree = { status: 'done', jobsCancelled: cancelled.count }
      }
    } else {
      results.figTree = { status: 'skipped', reason: 'Client not found' }
    }

    // ═══════════════════════════════════════════════════════════
    // 6. PINOK STUDIO — BI_WEEKLY Wed, Maggie, $229/$100
    // ═══════════════════════════════════════════════════════════
    const pinok = await prisma.client.findFirst({ where: { name: { contains: 'PINOK' } } })
    if (pinok) {
      const pinokLocations = await prisma.location.findMany({ where: { clientId: pinok.id } })
      const pinokLocationIds = pinokLocations.map(l => l.id)
      const pinokSchedules = await prisma.schedule.findMany({ where: { locationId: { in: pinokLocationIds } } })

      if (dryRun) {
        results.pinok = {
          status: 'preview',
          schedulesFound: pinokSchedules.length,
          currentFrequency: pinokSchedules[0]?.frequency,
          currentDays: pinokSchedules[0]?.daysOfWeek,
          currentClientRate: pinokSchedules[0]?.defaultClientRate,
          currentSubRate: pinokSchedules[0]?.defaultSubcontractorRate,
          wouldChangeTo: 'BI_WEEKLY Wed, $229/$100, Maggie',
        }
      } else {
        const maggie = await prisma.subcontractor.findFirst({ where: { name: { contains: 'Maggie' } } })
        if (!maggie) {
          results.pinok = { status: 'skipped', reason: 'Maggie not found in subcontractors' }
        } else {
          const today = new Date()
          const dayOfWeek = today.getUTCDay()
          const daysUntilWed = (3 - dayOfWeek + 7) % 7 || 7
          const nextWed = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + daysUntilWed, 12, 0, 0))
          const startWed = new Date(nextWed.getTime() - 14 * 24 * 60 * 60 * 1000)

          for (const schedule of pinokSchedules) {
            await prisma.schedule.update({
              where: { id: schedule.id },
              data: {
                frequency: 'BI_WEEKLY',
                daysOfWeek: JSON.stringify([3]),
                defaultClientRate: 229,
                defaultSubcontractorRate: 100,
                subcontractorId: maggie.id,
                startDate: startWed,
              },
            })
            await regenerateJobsForSchedule(schedule.id)
          }
          results.pinok = {
            status: 'done',
            schedulesUpdated: pinokSchedules.length,
            assignedTo: maggie.name,
            startDate: startWed.toISOString().split('T')[0],
          }
        }
      }
    } else {
      results.pinok = { status: 'skipped', reason: 'Client not found' }
    }

    // ═══════════════════════════════════════════════════════════
    // 7. SRU STUDIOS — Assign Maggie, sub rate $220
    // ═══════════════════════════════════════════════════════════
    const sru = await prisma.client.findFirst({ where: { name: { contains: 'SRU' } } })
    if (sru) {
      const sruLocations = await prisma.location.findMany({ where: { clientId: sru.id } })
      const sruLocationIds = sruLocations.map(l => l.id)
      const sruSchedules = await prisma.schedule.findMany({ where: { locationId: { in: sruLocationIds } } })

      if (dryRun) {
        results.sru = {
          status: 'preview',
          schedulesFound: sruSchedules.length,
          currentSubRate: sruSchedules[0]?.defaultSubcontractorRate,
          wouldChangeTo: '$220 with Maggie',
        }
      } else {
        const maggie = await prisma.subcontractor.findFirst({ where: { name: { contains: 'Maggie' } } })
        if (!maggie) {
          results.sru = { status: 'skipped', reason: 'Maggie not found in subcontractors' }
        } else {
          for (const schedule of sruSchedules) {
            await prisma.schedule.update({
              where: { id: schedule.id },
              data: { subcontractorId: maggie.id, defaultSubcontractorRate: 220 },
            })
            await regenerateJobsForSchedule(schedule.id)
          }
          results.sru = {
            status: 'done',
            schedulesUpdated: sruSchedules.length,
            assignedTo: maggie.name,
          }
        }
      }
    } else {
      results.sru = { status: 'skipped', reason: 'Client not found' }
    }

    return NextResponse.json({
      success: true,
      mode: dryRun ? 'DRY_RUN (send confirm:true to execute)' : 'EXECUTED',
      results,
    })
  } catch (error) {
    console.error('Data correction error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
