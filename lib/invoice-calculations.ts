// Pure functions for invoice line item generation and total calculation.
// No database or framework dependencies — fully testable.

export interface InvoiceJob {
  id: string
  date: Date | string
  clientRate: number
  scheduleId: string | null
  status: string
  invoiced?: boolean
  location: { name: string }
  addOnServices: Array<{ id: string; description: string; clientRate: number }>
  schedule?: {
    defaultClientRate?: number | null
    recurringAddOnServices?: Array<{ id: string; description: string; clientRate: number }>
  } | null
}

export interface LineItemResult {
  jobId: string | null
  addOnServiceId?: string | null
  description: string
  amount: number
  serviceDate: Date
}

function formatMonth(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function formatServiceDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function toDate(d: Date | string): Date {
  return typeof d === 'string' ? new Date(d) : d
}

/**
 * Generate line items for PER_CLEAN billing.
 * One line item per job + separate line items for each add-on service.
 */
export function generatePerCleanLineItems(jobs: InvoiceJob[]): LineItemResult[] {
  const validJobs = jobs.filter(j => j.status !== 'CANCELLED')
  const items: LineItemResult[] = []

  validJobs.forEach(job => {
    const jobDate = toDate(job.date)
    items.push({
      jobId: job.id,
      addOnServiceId: null,
      description: `Cleaning - ${job.location.name} - ${formatServiceDate(jobDate)}`,
      amount: job.clientRate,
      serviceDate: jobDate,
    })

    job.addOnServices.forEach(addOn => {
      items.push({
        jobId: job.id,
        addOnServiceId: addOn.id,
        description: `${addOn.description} - ${formatServiceDate(jobDate)}`,
        amount: addOn.clientRate,
        serviceDate: jobDate,
      })
    })
  })

  return items
}

/**
 * Generate line items for FLAT_RATE billing.
 * One monthly line item per schedule (using schedule rate), plus recurring add-ons,
 * plus one-time add-ons, plus one-off jobs.
 */
export function generateFlatRateLineItems(jobs: InvoiceJob[]): LineItemResult[] {
  const validJobs = jobs.filter(j => j.status !== 'CANCELLED')
  const recurringJobs = validJobs.filter(j => j.scheduleId !== null)
  const oneOffJobs = validJobs.filter(j => j.scheduleId === null)

  const items: LineItemResult[] = []

  // Group recurring jobs by scheduleId
  if (recurringJobs.length > 0) {
    const jobsBySchedule = new Map<string, InvoiceJob[]>()
    recurringJobs.forEach(job => {
      const key = job.scheduleId || 'no-schedule'
      if (!jobsBySchedule.has(key)) {
        jobsBySchedule.set(key, [])
      }
      jobsBySchedule.get(key)!.push(job)
    })

    jobsBySchedule.forEach((scheduleJobs) => {
      if (scheduleJobs.length === 0) return
      const firstJob = scheduleJobs[0]
      const jobDate = toDate(firstJob.date)
      const monthName = formatMonth(jobDate)
      const locationName = firstJob.location?.name || 'Unknown Location'
      // Use schedule rate (source of truth) instead of job rate
      const monthlyRate = firstJob.schedule?.defaultClientRate ?? firstJob.clientRate

      items.push({
        jobId: firstJob.id,
        addOnServiceId: null,
        description: `Monthly Cleaning - ${locationName} - ${monthName}`,
        amount: monthlyRate,
        serviceDate: jobDate,
      })

      // Add recurring add-ons from the schedule (once per schedule per month)
      const recurringAddOns = firstJob.schedule?.recurringAddOnServices || []
      recurringAddOns.forEach(addOn => {
        items.push({
          jobId: firstJob.id,
          addOnServiceId: addOn.id,
          description: `${addOn.description} (recurring) - ${monthName}`,
          amount: addOn.clientRate,
          serviceDate: jobDate,
        })
      })

      // Add one-time add-ons from individual jobs
      scheduleJobs.forEach(job => {
        job.addOnServices.forEach(addOn => {
          items.push({
            jobId: job.id,
            addOnServiceId: addOn.id,
            description: `${addOn.description} - ${formatServiceDate(toDate(job.date))}`,
            amount: addOn.clientRate,
            serviceDate: toDate(job.date),
          })
        })
      })
    })
  }

  // Add one-off jobs separately
  oneOffJobs.forEach(job => {
    const jobDate = toDate(job.date)
    if (job.clientRate > 0) {
      items.push({
        jobId: job.id,
        addOnServiceId: null,
        description: `Additional Service - ${job.location.name} - ${formatServiceDate(jobDate)}`,
        amount: job.clientRate,
        serviceDate: jobDate,
      })
    }

    job.addOnServices.forEach(addOn => {
      items.push({
        jobId: job.id,
        addOnServiceId: addOn.id,
        description: `${addOn.description} - ${formatServiceDate(jobDate)}`,
        amount: addOn.clientRate,
        serviceDate: jobDate,
      })
    })
  })

  return items
}

/**
 * Calculate the ready-to-bill total for a set of jobs (including all add-ons).
 * For FLAT_RATE: uses schedule rate + recurring add-ons (once per schedule) + one-time add-ons
 * For PER_CLEAN: sums all job rates + all add-ons
 */
export function calculateReadyToBillTotal(
  jobs: InvoiceJob[],
  billingType: 'FLAT_RATE' | 'PER_CLEAN'
): number {
  const validJobs = jobs.filter(j => j.status !== 'CANCELLED')

  if (billingType === 'FLAT_RATE') {
    const scheduleRates = new Map<string, number>()
    const scheduleAddOnTotals = new Map<string, number>()
    let oneOffTotal = 0

    validJobs.forEach(job => {
      if (job.scheduleId) {
        if (!scheduleRates.has(job.scheduleId)) {
          scheduleRates.set(job.scheduleId, job.schedule?.defaultClientRate ?? job.clientRate)
          const addOns = job.schedule?.recurringAddOnServices || []
          scheduleAddOnTotals.set(
            job.scheduleId,
            addOns.reduce((sum, a) => sum + a.clientRate, 0)
          )
        }
      } else {
        oneOffTotal += job.clientRate
      }
      // One-time add-ons from individual jobs
      job.addOnServices.forEach(a => {
        oneOffTotal += a.clientRate
      })
    })

    const recurring = Array.from(scheduleRates.values()).reduce((s, r) => s + r, 0)
    const recurringAddOns = Array.from(scheduleAddOnTotals.values()).reduce((s, r) => s + r, 0)
    return recurring + recurringAddOns + oneOffTotal
  } else {
    return validJobs.reduce((sum, job) => {
      const jobAddOns = job.addOnServices.reduce((s, a) => s + a.clientRate, 0)
      return sum + job.clientRate + jobAddOns
    }, 0)
  }
}
