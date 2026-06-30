/**
 * Payment Cadence Engine
 * 
 * Determines whether a job is eligible for subcontractor payout
 * based on the cleaner's payment cadence rules.
 */

import { addDays, endOfMonth, addMonths, setDate } from 'date-fns'

// ── Cadence types ──────────────────────────────────────────────

export const PAYMENT_CADENCES = {
  IMMEDIATE: 'IMMEDIATE',
  AFTER_CLIENT_PAYS: 'AFTER_CLIENT_PAYS',
  END_OF_MONTH: 'END_OF_MONTH',
  SEMI_MONTHLY: 'SEMI_MONTHLY',
  RESIDENTIAL_7_DAY: 'RESIDENTIAL_7_DAY',
  COMMERCIAL_CLIENT_PAID_OR_7TH: 'COMMERCIAL_CLIENT_PAID_OR_7TH',
  ON_CLEANER_INVOICE: 'ON_CLEANER_INVOICE',
} as const

export type PaymentCadence = keyof typeof PAYMENT_CADENCES

export const CADENCE_LABELS: Record<string, string> = {
  IMMEDIATE: 'Immediate',
  AFTER_CLIENT_PAYS: 'After Client Pays',
  END_OF_MONTH: 'End of Month',
  SEMI_MONTHLY: 'Semi-Monthly',
  RESIDENTIAL_7_DAY: 'Residential 7-Day',
  COMMERCIAL_CLIENT_PAID_OR_7TH: 'Commercial Paid/7th',
  ON_CLEANER_INVOICE: 'On Cleaner Invoice',
}

export const CADENCE_DESCRIPTIONS: Record<string, string> = {
  IMMEDIATE: 'Payable as soon as the job date passes (default behavior)',
  AFTER_CLIENT_PAYS: 'Payable only after the client\'s invoice covering this job is marked PAID',
  END_OF_MONTH: 'Payable after the calendar month containing the job ends',
  SEMI_MONTHLY: 'Jobs from 1st–15th payable after the 20th; jobs from 16th–end payable after the 5th of next month',
  RESIDENTIAL_7_DAY: 'Residential work is payable 7 days after service; fast-pay releases after 72 hours',
  COMMERCIAL_CLIENT_PAID_OR_7TH: 'Commercial work is payable when the client pays or by the 7th of the next month, whichever comes first',
  ON_CLEANER_INVOICE: 'Only payable when manually released (cleaner must submit their own invoice first)',
}

// ── Input types ────────────────────────────────────────────────

export interface CadenceJobInfo {
  id: string
  date: Date | string
  scheduleId: string | null
  invoiced: boolean
  subcontractorPaid: boolean
  // Location/client info for exclusion check
  location: {
    client: {
      id: string
    }
  }
  // Invoice info for AFTER_CLIENT_PAYS
  invoiceLineItems?: Array<{
    invoice: {
      status: string
    }
  }>
}

export interface CadenceSubcontractorInfo {
  paymentCadence: string
  excludeClientIds: string | null
  fastPay?: boolean
}

export interface CadenceScheduleInfo {
  paymentCadenceOverride: string | null
}

// ── Core logic ─────────────────────────────────────────────────

/**
 * Get the effective cadence for a job, considering schedule-level overrides.
 */
export function getEffectiveCadence(
  subcontractor: CadenceSubcontractorInfo,
  schedule: CadenceScheduleInfo | null
): string {
  if (schedule?.paymentCadenceOverride) {
    return schedule.paymentCadenceOverride
  }
  return subcontractor.paymentCadence || 'IMMEDIATE'
}

/**
 * Check if a job's client is excluded from this subcontractor's payouts.
 */
export function isClientExcluded(
  clientId: string,
  subcontractor: CadenceSubcontractorInfo
): boolean {
  if (!subcontractor.excludeClientIds) return false
  try {
    const excluded: string[] = JSON.parse(subcontractor.excludeClientIds)
    return excluded.includes(clientId)
  } catch {
    return false
  }
}

function hasPaidClientInvoice(job: CadenceJobInfo): boolean {
  if (!job.invoiced) return false
  return (job.invoiceLineItems || []).some(li => li.invoice.status === 'PAID')
}

function isFastPayReady(
  jobDate: Date,
  subcontractor: CadenceSubcontractorInfo,
  now: Date
): boolean {
  if (!subcontractor.fastPay) return false
  return now.getTime() - jobDate.getTime() >= 3 * 86400000
}

function seventhOfNextMonth(jobDate: Date): Date {
  const nextMonth = addMonths(jobDate, 1)
  const seventh = setDate(new Date(nextMonth), 7)
  seventh.setHours(0, 0, 0, 0)
  return seventh
}

/**
 * Determine if a job is eligible for payout based on cadence rules.
 * 
 * @returns true if the job can be included in a payment
 */
export function isJobPayable(
  job: CadenceJobInfo,
  subcontractor: CadenceSubcontractorInfo,
  schedule: CadenceScheduleInfo | null,
  now: Date = new Date()
): boolean {
  // Already paid — not payable again
  if (job.subcontractorPaid) return false

  // Client exclusion check
  if (isClientExcluded(job.location.client.id, subcontractor)) return false

  // Job must be in the past (or today)
  const jobDate = new Date(job.date)
  if (jobDate > now) return false

  const cadence = getEffectiveCadence(subcontractor, schedule)

  switch (cadence) {
    case 'IMMEDIATE':
      // Payable as soon as job date passes — current default behavior
      return true

    case 'AFTER_CLIENT_PAYS':
      return hasPaidClientInvoice(job)

    case 'END_OF_MONTH': {
      // Payable after the calendar month of the job ends
      const monthEnd = endOfMonth(jobDate)
      return now > monthEnd
    }

    case 'SEMI_MONTHLY': {
      // 1st-15th → payable after the 20th of the same month
      // 16th-end → payable after the 5th of the next month
      const dayOfMonth = jobDate.getDate()

      if (dayOfMonth <= 15) {
        // First half: payable after the 20th of the same month
        const payableAfter = setDate(new Date(jobDate), 20)
        return now > payableAfter
      } else {
        // Second half: payable after the 5th of the next month
        const nextMonth = addMonths(jobDate, 1)
        const payableAfter = setDate(new Date(nextMonth), 5)
        return now > payableAfter
      }
    }

    case 'RESIDENTIAL_7_DAY':
      return isFastPayReady(jobDate, subcontractor, now) || now >= addDays(jobDate, 7)

    case 'COMMERCIAL_CLIENT_PAID_OR_7TH':
      return isFastPayReady(jobDate, subcontractor, now) || hasPaidClientInvoice(job) || now >= seventhOfNextMonth(jobDate)

    case 'ON_CLEANER_INVOICE':
      // Never auto-payable — requires manual release
      // This is handled by a separate "release" action in the UI
      return false

    default:
      // Unknown cadence — treat as IMMEDIATE for safety
      return true
  }
}

/**
 * Filter a list of jobs to only those that are payable under cadence rules.
 */
export function filterPayableJobs<T extends CadenceJobInfo>(
  jobs: T[],
  subcontractor: CadenceSubcontractorInfo,
  scheduleMap: Map<string | null, CadenceScheduleInfo | null>,
  now: Date = new Date()
): T[] {
  return jobs.filter(job => {
    const schedule = job.scheduleId ? (scheduleMap.get(job.scheduleId) || null) : null
    return isJobPayable(job, subcontractor, schedule, now)
  })
}

/**
 * Get a human-readable summary of when a job will become payable.
 */
export function getPayableStatusText(
  job: CadenceJobInfo,
  subcontractor: CadenceSubcontractorInfo,
  schedule: CadenceScheduleInfo | null
): string {
  if (job.subcontractorPaid) return 'Paid'
  if (isClientExcluded(job.location.client.id, subcontractor)) return 'Excluded'

  const cadence = getEffectiveCadence(subcontractor, schedule)

  switch (cadence) {
    case 'IMMEDIATE':
      return new Date(job.date) <= new Date() ? 'Ready to pay' : 'Scheduled'

    case 'AFTER_CLIENT_PAYS': {
      if (!job.invoiced) return 'Awaiting invoice'
      const lineItems = job.invoiceLineItems || []
      const hasPaidInvoice = lineItems.some(li => li.invoice.status === 'PAID')
      if (hasPaidInvoice) return 'Ready to pay'
      return 'Awaiting client payment'
    }

    case 'END_OF_MONTH': {
      const monthEnd = endOfMonth(new Date(job.date))
      if (new Date() > monthEnd) return 'Ready to pay'
      return `Payable after month-end`
    }

    case 'SEMI_MONTHLY': {
      const dayOfMonth = new Date(job.date).getDate()
      if (dayOfMonth <= 15) return 'Payable after the 20th'
      return 'Payable after the 5th'
    }

    case 'RESIDENTIAL_7_DAY': {
      const jobDate = new Date(job.date)
      const now = new Date()
      if (isFastPayReady(jobDate, subcontractor, now) || now >= addDays(jobDate, 7)) return 'Ready to pay'
      return subcontractor.fastPay ? 'Fast-pay after 72h' : 'Payable 7 days after service'
    }

    case 'COMMERCIAL_CLIENT_PAID_OR_7TH': {
      const jobDate = new Date(job.date)
      const now = new Date()
      if (isFastPayReady(jobDate, subcontractor, now) || hasPaidClientInvoice(job) || now >= seventhOfNextMonth(jobDate)) return 'Ready to pay'
      return 'Awaiting client payment or 7th of next month'
    }

    case 'ON_CLEANER_INVOICE':
      return 'Awaiting cleaner invoice'

    default:
      return 'Ready to pay'
  }
}
