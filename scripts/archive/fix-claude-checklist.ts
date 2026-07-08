import { PrismaClient, type Invoice, type InvoiceLineItem, type Job } from '@prisma/client'
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

function canDeleteJob(job: JobWithSafety) {
  if (job.paymentLineItems.length > 0 || job.subcontractorPaid) return false
  if (job.addOnServices.some(addon => addon.vendorPaymentLineItems.length > 0)) return false
  if (job.invoiceLineItems.some(item => isFinalInvoiceStatus(item.invoice.status))) return false
  return true
}

async function deleteJobsAndDraftReferences(jobIds: string[]) {
  if (jobIds.length === 0) return { jobsDeleted: 0, draftInvoicesDeleted: 0 }

  const lineItems = await prisma.invoiceLineItem.findMany({
    where: { jobId: { in: jobIds } },
    select: { invoiceId: true },
  })
  const invoiceIds = Array.from(new Set(lineItems.map(item => item.invoiceId)))

  if (!APPLY) {
    return { jobsDeleted: jobIds.length, draftInvoicesDeleted: invoiceIds.length }
  }

  await prisma.invoiceLineItem.deleteMany({ where: { jobId: { in: jobIds } } })
  const jobsDeleted = await prisma.job.deleteMany({ where: { id: { in: jobIds } } })

  let draftInvoicesDeleted = 0
  for (const invoiceId of invoiceIds) {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { lineItems: { select: { id: true } } },
    })

    if (invoice?.status === 'DRAFT' && invoice.lineItems.length === 0) {
      await prisma.invoice.delete({ where: { id: invoiceId } })
      draftInvoicesDeleted++
    }
  }

  return { jobsDeleted: jobsDeleted.count, draftInvoicesDeleted }
}

async function repairKnox() {
  const client = await prisma.client.findFirst({
    where: { name: { contains: 'Knox Presbyterian Church', mode: 'insensitive' } },
    include: {
      locations: {
        include: {
          schedules: true,
        },
      },
    },
  })

  if (!client) return { found: false }

  const schedule = client.locations.flatMap(location => location.schedules).find(item => item.isActive)
  if (!schedule) return { found: true, hasSchedule: false }

  const rangeStart = utcDate(2026, 1, 1)
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

  const jobs = await prisma.job.findMany({
    where: {
      locationId: { in: client.locations.map(location => location.id) },
      date: { gte: rangeStart, lte: rangeEnd },
    },
    include: {
      invoiceLineItems: { include: { invoice: { select: { id: true, status: true } } } },
      paymentLineItems: { select: { id: true } },
      addOnServices: { include: { vendorPaymentLineItems: { select: { id: true } } } },
    },
  })

  const staleJobs = jobs.filter(job => !desiredKeys.has(dateKey(job.date)))
  const deletableJobIds = staleJobs.filter(canDeleteJob).map(job => job.id)
  const skippedUnsafeJobs = staleJobs.length - deletableJobIds.length
  const deleteResult = await deleteJobsAndDraftReferences(deletableJobIds)

  const existingAfterDeleteKeys = new Set(
    jobs
      .filter(job => !deletableJobIds.includes(job.id))
      .map(job => dateKey(job.date))
  )
  const missingDates = desiredDates.filter(date => !existingAfterDeleteKeys.has(dateKey(date)))

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
    hasSchedule: true,
    desiredDates: Array.from(desiredKeys),
    staleJobs: staleJobs.map(job => ({ id: job.id, date: dateKey(job.date), status: job.status })),
    skippedUnsafeJobs,
    ...deleteResult,
    jobsCreated,
  }
}

async function repairDesignStudioVoid() {
  const client = await prisma.client.findFirst({
    where: { name: { contains: 'Design Studio VOID', mode: 'insensitive' } },
    include: { locations: { include: { schedules: true } } },
  })

  if (!client) return { found: false }

  const location = client.locations[0]
  if (!location) return { found: true, hasLocation: false }

  let juan = await prisma.subcontractor.findFirst({ where: { name: { equals: 'Juan', mode: 'insensitive' } } })
  if (!juan && APPLY) {
    juan = await prisma.subcontractor.create({ data: { name: 'Juan' } })
  }

  let schedule = location.schedules.find(item => item.isActive)
  let scheduleCreated = false
  if (!schedule && juan && APPLY) {
    schedule = await prisma.schedule.create({
      data: {
        locationId: location.id,
        subcontractorId: juan.id,
        frequency: 'EVERY_3_WEEKS',
        daysOfWeek: null,
        startDate: utcDate(2026, 2, 25),
        defaultClientRate: 145,
        defaultSubcontractorRate: 80,
        clientPayType: 'PER_CLEAN',
        subcontractorPayType: 'PER_CLEAN',
        timeType: 'WINDOW',
        startWindowBegin: '09:00',
        startWindowEnd: '11:00',
        isActive: true,
      },
    })
    scheduleCreated = true
  }

  const effectiveSchedule = schedule ?? location.schedules.find(item => item.isActive)
  if (!effectiveSchedule) {
    return { found: true, hasLocation: true, hasSchedule: false, juanFoundOrCreated: Boolean(juan), scheduleCreated, jobsCreated: 0 }
  }

  const rangeStart = utcDate(2026, 2, 1)
  const rangeEnd = utcDate(2026, 11, 31)
  const desiredDates = calculateScheduleDates({
    frequency: effectiveSchedule.frequency,
    startDate: effectiveSchedule.startDate,
    endDate: effectiveSchedule.endDate,
    daysOfWeek: effectiveSchedule.daysOfWeek,
    monthlyPattern: effectiveSchedule.monthlyPattern,
    customDates: effectiveSchedule.customDates,
    excludedDates: effectiveSchedule.excludedDates,
  }, rangeEnd).filter(date => date >= rangeStart && date <= rangeEnd)

  const existingJobs = await prisma.job.findMany({
    where: { scheduleId: effectiveSchedule.id, date: { gte: rangeStart, lte: rangeEnd } },
    select: { date: true },
  })
  const existingKeys = new Set(existingJobs.map(job => dateKey(job.date)))
  const missingDates = desiredDates.filter(date => !existingKeys.has(dateKey(date)))

  let jobsCreated = missingDates.length
  if (APPLY && missingDates.length > 0) {
    const result = await prisma.job.createMany({
      data: missingDates.map(date => ({
        locationId: effectiveSchedule.locationId,
        subcontractorId: effectiveSchedule.subcontractorId,
        scheduleId: effectiveSchedule.id,
        date,
        startTime: effectiveSchedule.timeType === 'SPECIFIC' ? effectiveSchedule.startTime : null,
        startWindowBegin: effectiveSchedule.timeType === 'WINDOW' ? effectiveSchedule.startWindowBegin : null,
        startWindowEnd: effectiveSchedule.timeType === 'WINDOW' ? effectiveSchedule.startWindowEnd : null,
        clientRate: effectiveSchedule.defaultClientRate,
        subcontractorRate: effectiveSchedule.defaultSubcontractorRate,
      })),
      skipDuplicates: true,
    })
    jobsCreated = result.count
  }

  return {
    found: true,
    hasLocation: true,
    hasSchedule: true,
    juanFoundOrCreated: Boolean(juan),
    scheduleCreated,
    desiredDates: desiredDates.map(dateKey),
    jobsCreated,
  }
}

async function repairYardGym() {
  const client = await prisma.client.findFirst({
    where: { name: { contains: 'Yard Gym', mode: 'insensitive' } },
    include: { locations: { include: { schedules: true } } },
  })
  if (!client) return { found: false }

  const duplicateSchedules = client.locations
    .flatMap(location => location.schedules)
    .filter(schedule => dateKey(schedule.endDate ?? new Date(0)) === '2026-05-12')

  let inactiveSchedulesDeleted = 0
  let protectedSchedulesKept = 0

  for (const schedule of duplicateSchedules) {
    const jobs = await prisma.job.findMany({
      where: { scheduleId: schedule.id },
      include: {
        invoiceLineItems: { include: { invoice: { select: { id: true, status: true } } } },
        paymentLineItems: { select: { id: true } },
        addOnServices: { include: { vendorPaymentLineItems: { select: { id: true } } } },
      },
    })
    const canDeleteSchedule = jobs.every(canDeleteJob)
    if (!canDeleteSchedule) {
      protectedSchedulesKept++
      continue
    }

    if (APPLY) {
      await deleteJobsAndDraftReferences(jobs.map(job => job.id))
      await prisma.schedule.delete({ where: { id: schedule.id } })
    }
    inactiveSchedulesDeleted++
  }

  return {
    found: true,
    duplicateSchedules: duplicateSchedules.map(schedule => schedule.id),
    inactiveSchedulesDeleted,
    protectedSchedulesKept,
  }
}

async function repairRajivAddOns() {
  const client = await prisma.client.findFirst({
    where: { name: { contains: 'Rajiv Menon', mode: 'insensitive' } },
    include: { locations: { include: { schedules: { include: { recurringAddOnServices: true } } } } },
  })
  if (!client) return { found: false }

  const schedule = client.locations.flatMap(location => location.schedules).find(item => item.isActive)
  if (!schedule) return { found: true, hasSchedule: false }

  const desired = [
    { description: 'Windows', clientRate: 125, subcontractorRate: 90, frequency: 'EVERY_6_WEEKS' },
    { description: 'Fridge Deep Clean', clientRate: 75, subcontractorRate: 0, frequency: 'EVERY_6_WEEKS' },
  ]

  const missing = desired.filter(item =>
    !schedule.recurringAddOnServices.some(existing =>
      existing.isRecurring && existing.description.toLowerCase() === item.description.toLowerCase()
    )
  )

  if (APPLY && missing.length > 0) {
    await prisma.addOnService.createMany({
      data: missing.map(item => ({
        scheduleId: schedule.id,
        description: item.description,
        clientRate: item.clientRate,
        subcontractorRate: item.subcontractorRate,
        frequency: item.frequency,
        isRecurring: true,
      })),
    })
  }

  return {
    found: true,
    hasSchedule: true,
    existingAddOns: schedule.recurringAddOnServices.map(item => item.description),
    addOnsCreated: missing.map(item => item.description),
  }
}

async function main() {
  console.log(APPLY ? 'Applying Claude checklist repairs...' : 'Dry run only. Re-run with --apply to write changes.')

  const result = {
    apply: APPLY,
    knox: await repairKnox(),
    designStudioVoid: await repairDesignStudioVoid(),
    yardGym: await repairYardGym(),
    rajivMenon: await repairRajivAddOns(),
  }

  console.log(JSON.stringify(result, null, 2))
}

main()
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
