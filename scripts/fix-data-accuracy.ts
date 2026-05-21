import { PrismaClient, type Job, type InvoiceLineItem, type Invoice } from '@prisma/client'
import { calculateScheduleDates } from '../lib/regenerate-schedule-jobs'

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')

type JobWithSafety = Job & {
  invoiceLineItems: Array<InvoiceLineItem & { invoice: Pick<Invoice, 'id' | 'status'> }>
  paymentLineItems: Array<{ id: string }>
  addOnServices: Array<{ id: string; vendorPaymentLineItems: Array<{ id: string }> }>
}

function utcDate(year: number, monthIndex: number, day: number) {
  return new Date(Date.UTC(year, monthIndex, day, 12, 0, 0))
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

function isFinalInvoiceStatus(status: string | null | undefined) {
  return status === 'SENT' || status === 'PAID'
}

function isVoidOrCancelledInvoiceStatus(status: string | null | undefined) {
  return status === 'VOID' || status === 'CANCELLED'
}

function canDeleteGeneratedJob(job: JobWithSafety) {
  if (job.paymentLineItems.length > 0) return false
  if (job.addOnServices.some(addon => addon.vendorPaymentLineItems.length > 0)) return false
  if (job.invoiceLineItems.some(item => isFinalInvoiceStatus(item.invoice.status))) return false

  // Draft invoices should be regenerated explicitly, not silently changed by a data repair.
  if (job.invoiceLineItems.some(item => !isVoidOrCancelledInvoiceStatus(item.invoice.status))) return false

  return true
}

async function deleteJobs(jobIds: string[]) {
  if (jobIds.length === 0) return 0
  if (!APPLY) return jobIds.length

  await prisma.invoiceLineItem.deleteMany({ where: { jobId: { in: jobIds } } })
  const result = await prisma.job.deleteMany({ where: { id: { in: jobIds } } })
  return result.count
}

async function repairDtlaVisuals() {
  const dtla = await prisma.client.findFirst({
    where: { name: 'DTLA Visuals' },
    include: {
      locations: {
        include: {
          schedules: true,
        },
      },
    },
  })

  if (!dtla) {
    return { found: false, schedulesInactivated: 0, jobsConvertedToOneOff: 0, postConstructionMoved: false, futureIvannaJobsDeleted: 0 }
  }

  const oneOffScheduleIds = dtla.locations
    .flatMap(location => location.schedules)
    .filter(schedule => schedule.isActive && schedule.frequency === 'CUSTOM' && !schedule.customDates)
    .map(schedule => schedule.id)

  const linkedJobs = oneOffScheduleIds.length
    ? await prisma.job.findMany({
        where: { scheduleId: { in: oneOffScheduleIds } },
        include: {
          invoiceLineItems: { include: { invoice: { select: { id: true, status: true } } } },
          paymentLineItems: { select: { id: true } },
          addOnServices: { include: { vendorPaymentLineItems: { select: { id: true } } } },
        },
      })
    : []

  const jobsConvertibleToOneOff = linkedJobs.filter(job => !job.invoiceLineItems.some(item => isFinalInvoiceStatus(item.invoice.status)))

  if (APPLY) {
    await prisma.client.update({
      where: { id: dtla.id },
      data: {
        communicationContactName: 'Ivanna Gantous',
        invoicingContactName: 'Ivanna Gantous',
      },
    })

    if (jobsConvertibleToOneOff.length > 0) {
      await prisma.job.updateMany({
        where: { id: { in: jobsConvertibleToOneOff.map(job => job.id) } },
        data: { scheduleId: null },
      })
    }

    if (oneOffScheduleIds.length > 0) {
      await prisma.schedule.updateMany({
        where: { id: { in: oneOffScheduleIds } },
        data: { isActive: false },
      })
    }
  }

  const residentialLocation = dtla.locations.find(location =>
    location.name.toLowerCase().includes('post-construction') ||
    location.address.toLowerCase().includes('2611 sichel')
  )

  const ivannaClient = await prisma.client.findFirst({
    where: { name: 'Ivanna Post Construction' },
    include: {
      locations: {
        include: { schedules: true },
      },
    },
  })

  let postConstructionMoved = false
  let futureIvannaJobsDeleted = 0

  if (ivannaClient && residentialLocation) {
    const ivannaScheduleIds = ivannaClient.locations.flatMap(location => location.schedules.map(schedule => schedule.id))
    const ivannaJobs = await prisma.job.findMany({
      where: { scheduleId: { in: ivannaScheduleIds } },
      include: {
        invoiceLineItems: { include: { invoice: { select: { id: true, status: true } } } },
        paymentLineItems: { select: { id: true } },
        addOnServices: { include: { vendorPaymentLineItems: { select: { id: true } } } },
      },
      orderBy: { date: 'asc' },
    })

    const completedOneOff = ivannaJobs.find(job => job.status === 'COMPLETED')
    if (completedOneOff && !completedOneOff.invoiceLineItems.some(item => isFinalInvoiceStatus(item.invoice.status))) {
      postConstructionMoved = true
      if (APPLY) {
        await prisma.job.update({
          where: { id: completedOneOff.id },
          data: {
            locationId: residentialLocation.id,
            scheduleId: null,
            clientRate: 785,
            subcontractorRate: completedOneOff.subcontractorRate || 650,
            notes: [completedOneOff.notes, 'One-time DTLA Visuals post-construction clean at 2611 Sichel St.; discounted from $1,120 to $785.']
              .filter(Boolean)
              .join('\n'),
          },
        })
      }
    }

    const deletableFutureJobs = ivannaJobs
      .filter(job => job.id !== completedOneOff?.id)
      .filter(job => job.status === 'CANCELLED' || job.status === 'SCHEDULED')
      .filter(canDeleteGeneratedJob)
      .map(job => job.id)

    futureIvannaJobsDeleted = await deleteJobs(deletableFutureJobs)

    if (APPLY && ivannaScheduleIds.length > 0) {
      await prisma.schedule.updateMany({
        where: { id: { in: ivannaScheduleIds } },
        data: { isActive: false },
      })
    }
  }

  return {
    found: true,
    schedulesInactivated: oneOffScheduleIds.length,
    jobsConvertedToOneOff: jobsConvertibleToOneOff.length,
    postConstructionMoved,
    futureIvannaJobsDeleted,
  }
}

async function repairSoundcheckJobs() {
  const soundcheck = await prisma.client.findFirst({
    where: { name: 'Soundcheck Studios' },
    include: {
      locations: {
        include: {
          schedules: true,
        },
      },
    },
  })

  if (!soundcheck) {
    return { found: false, wrongJobsDeleted: 0, jobsCreated: 0, skippedUnsafeJobs: 0, desiredDates: [] as string[] }
  }

  const schedule = soundcheck.locations
    .flatMap(location => location.schedules)
    .find(candidate => candidate.isActive)

  if (!schedule) {
    return { found: true, wrongJobsDeleted: 0, jobsCreated: 0, skippedUnsafeJobs: 0, desiredDates: [] as string[] }
  }

  const rangeStart = utcDate(2025, 11, 1)
  const rangeEnd = utcDate(2026, 11, 31)
  const desiredDates = calculateScheduleDates({
    frequency: schedule.frequency,
    startDate: schedule.startDate,
    endDate: schedule.endDate,
    daysOfWeek: schedule.daysOfWeek,
    monthlyPattern: schedule.monthlyPattern,
    customDates: schedule.customDates,
    excludedDates: schedule.excludedDates,
  }, rangeEnd).filter(date => date >= rangeStart && date <= rangeEnd)

  const desiredKeys = new Set(desiredDates.map(dateKey))

  const existingJobs = await prisma.job.findMany({
    where: {
      scheduleId: schedule.id,
      date: { gte: rangeStart, lte: rangeEnd },
    },
    include: {
      invoiceLineItems: { include: { invoice: { select: { id: true, status: true } } } },
      paymentLineItems: { select: { id: true } },
      addOnServices: { include: { vendorPaymentLineItems: { select: { id: true } } } },
    },
    orderBy: { date: 'asc' },
  })

  const wrongJobs = existingJobs.filter(job => !desiredKeys.has(dateKey(job.date)))
  const deletableWrongJobIds = wrongJobs.filter(canDeleteGeneratedJob).map(job => job.id)
  const skippedUnsafeJobs = wrongJobs.length - deletableWrongJobIds.length
  const wrongJobsDeleted = await deleteJobs(deletableWrongJobIds)

  const existingAfterDeletes = existingJobs.filter(job => !deletableWrongJobIds.includes(job.id))
  const existingKeys = new Set(existingAfterDeletes.map(job => dateKey(job.date)))
  const missingDates = desiredDates.filter(date => !existingKeys.has(dateKey(date)))

  let jobsCreated = missingDates.length
  if (APPLY && missingDates.length > 0) {
    const result = await prisma.job.createMany({
      data: missingDates.map(date => ({
        locationId: schedule.locationId,
        subcontractorId: schedule.subcontractorId,
        scheduleId: schedule.id,
        date,
        startTime: schedule.timeType === 'SPECIFIC' ? schedule.startTime : null,
        startWindowBegin: schedule.timeType === 'WINDOW' ? schedule.startWindowBegin : null,
        startWindowEnd: schedule.timeType === 'WINDOW' ? schedule.startWindowEnd : null,
        clientRate: schedule.defaultClientRate,
        subcontractorRate: schedule.defaultSubcontractorRate,
      })),
      skipDuplicates: true,
    })
    jobsCreated = result.count
  }

  return {
    found: true,
    wrongJobsDeleted,
    jobsCreated,
    skippedUnsafeJobs,
    desiredDates: desiredDates.map(dateKey),
  }
}

async function main() {
  console.log(APPLY ? 'Applying data accuracy repair...' : 'Dry run only. Re-run with --apply to write changes.')

  const dtla = await repairDtlaVisuals()
  const soundcheck = await repairSoundcheckJobs()

  console.log(JSON.stringify({ apply: APPLY, dtla, soundcheck }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
