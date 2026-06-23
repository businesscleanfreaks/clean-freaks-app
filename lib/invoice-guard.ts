import { prisma } from '@/lib/db'

export type GuardCleanStatus = string // 'SCHEDULED' | 'COMPLETED' | 'CANCELLED'

export interface GuardPeriodJob {
  iso: string
  status: GuardCleanStatus
  onThisInvoice: boolean
  invoicedElsewhere: boolean
}

export interface InvoiceGuardInput {
  billingType: 'FLAT_RATE' | 'PER_CLEAN'
  periodJobs: GuardPeriodJob[]
}

export type InvoiceGuardCode = 'BILLED_BUT_CANCELLED' | 'MISSING_CLEAN'

export interface InvoiceGuardFinding {
  code: InvoiceGuardCode
  message: string
}

export interface InvoiceGuardResult {
  matches: boolean
  findings: InvoiceGuardFinding[]
}

/**
 * Pure pre-send check: does the invoice's billed work still line up with the
 * cleans actually in its billing period?
 *
 *  - BILLED_BUT_CANCELLED: a clean billed on this invoice was since cancelled
 *    (you'd be charging for work that didn't happen).
 *  - MISSING_CLEAN (per-clean only): a real clean sits in the period, isn't
 *    billed here, and isn't already on another invoice (under-billing). Flat-rate
 *    bills the month as one line, so individual missing cleans don't apply.
 */
export function checkInvoiceAgainstSchedule(input: InvoiceGuardInput): InvoiceGuardResult {
  const findings: InvoiceGuardFinding[] = []

  for (const job of input.periodJobs) {
    if (job.onThisInvoice && job.status === 'CANCELLED') {
      findings.push({
        code: 'BILLED_BUT_CANCELLED',
        message: `This invoice bills a clean that was cancelled (${job.iso}).`,
      })
    }
  }

  if (input.billingType === 'PER_CLEAN') {
    for (const job of input.periodJobs) {
      if (job.status !== 'CANCELLED' && !job.onThisInvoice && !job.invoicedElsewhere) {
        findings.push({
          code: 'MISSING_CLEAN',
          message: `A clean on ${job.iso} isn't on this invoice yet.`,
        })
      }
    }
  }

  return { matches: findings.length === 0, findings }
}

/**
 * DB-backed evaluator the send routes call before flipping an invoice to SENT.
 * Read-only. If the invoice has no billing period we can't compare, so we don't
 * block (return matches: true).
 */
export async function evaluateInvoiceForSend(invoiceId: string): Promise<InvoiceGuardResult> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      clientId: true,
      billingPeriodStart: true,
      billingPeriodEnd: true,
      client: { select: { billingType: true } },
      lineItems: { select: { jobId: true } },
    },
  })

  if (!invoice || !invoice.billingPeriodStart || !invoice.billingPeriodEnd) {
    return { matches: true, findings: [] }
  }

  const billedJobIds = new Set(
    invoice.lineItems.map((li) => li.jobId).filter((x): x is string => !!x),
  )

  const periodJobsRaw = await prisma.job.findMany({
    where: {
      location: { clientId: invoice.clientId },
      date: { gte: invoice.billingPeriodStart, lte: invoice.billingPeriodEnd },
    },
    select: {
      id: true,
      date: true,
      status: true,
      invoiceLineItems: { select: { invoice: { select: { id: true, status: true } } } },
    },
  })

  const periodJobs: GuardPeriodJob[] = periodJobsRaw.map((job) => ({
    iso: job.date.toISOString().slice(0, 10),
    status: job.status,
    onThisInvoice: billedJobIds.has(job.id),
    invoicedElsewhere: job.invoiceLineItems.some(
      (li) => li.invoice && li.invoice.id !== invoice.id && li.invoice.status !== 'VOID',
    ),
  }))

  return checkInvoiceAgainstSchedule({
    billingType: invoice.client.billingType === 'FLAT_RATE' ? 'FLAT_RATE' : 'PER_CLEAN',
    periodJobs,
  })
}
