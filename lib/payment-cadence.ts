/**
 * Payment Cadence Engine
 * 
 * Determines whether a job is eligible for subcontractor payout
 * based on the cleaner's payment cadence rules.
 */

import { endOfMonth, addMonths, setDate } from 'date-fns'

// ── Cadence types ──────────────────────────────────────────────

export const PAYMENT_CADENCES = {
  IMMEDIATE: 'IMMEDIATE',
  AFTER_CLIENT_PAYS: 'AFTER_CLIENT_PAYS',
  END_OF_MONTH: 'END_OF_MONTH',
  SEMI_MONTHLY: 'SEMI_MONTHLY',
  ON_CLEANER_INVOICE: 'ON_CLEANER_INVOICE',
} as const

export type PaymentCadence = keyof typeof PAYMENT_CADENCES

export const CADENCE_LABELS: Record<string, string> = {
  IMMEDIATE: 'Immediate',
  AFTER_CLIENT_PAYS: 'After Client Pays',
  END_OF_MONTH: 'End of Month',
  SEMI_MONTHLY: 'Semi-Monthly',
  ON_CLEANER_INVOICE: 'On Cleaner Invoice',
}

export const CADENCE_DESCRIPTIONS: Record<string, string> = {
  IMMEDIATE: 'Payable as soon as the job date passes (default behavior)',
  AFTER_CLIENT_PAYS: 'Payable only after the client\'s invoice covering this job is marked PAID',
  END_OF_MONTH: 'Payable after the calendar month containing the job ends',
  SEMI_MONTHLY: 'Jobs from 1st–15th payable after the 20th; jobs from 16th–end payable after the 5th of next month',
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

    case 'AFTER_CLIENT_PAYS': {
      // Payable only when the specific linked invoice is PAID
      // If job is not yet on an invoice, it's NOT payable
      if (!job.invoiced) return false
      
      const lineItems = job.invoiceLineItems || []
      if (lineItems.length === 0) return false

      // Job is payable if ANY linked invoice is PAID
      // (a job could theoretically appear on multiple invoices in edge cases)
      return lineItems.some(li => li.invoice.status === 'PAID')
    }

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

    case 'ON_CLEANER_INVOICE':
      return 'Awaiting cleaner invoice'

    default:
      return 'Ready to pay'
  }
}
