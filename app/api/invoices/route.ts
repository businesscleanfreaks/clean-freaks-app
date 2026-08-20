import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { revalidateInvoicePages } from '@/lib/revalidate'
import { createInvoiceSchema } from '@/lib/validations'
import { logger } from '@/lib/logger'
import { requireAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error-handler'
import { getInvoiceDefaults, computeDefaultDueDate } from '@/lib/invoice-defaults'
import { sendBlockedReason } from '@/lib/invoice-adjustments'
import { invoiceCandidateKey } from '@/lib/invoice-candidate-key'
import { isValidPeriod as isValidAdjPeriod } from '@/lib/invoice-overview'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Generate invoice number (format: INV-YYYYMMDD-XXXX)
async function generateInvoiceNumber(): Promise<string> {
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '')

  // Find the latest invoice number for today
  const latestInvoice = await prisma.invoice.findFirst({
    where: {
      invoiceNumber: {
        startsWith: `INV-${dateStr}-`,
      },
    },
    orderBy: {
      invoiceNumber: 'desc',
    },
  })

  let sequence = 1
  if (latestInvoice) {
    const lastSequence = parseInt(latestInvoice.invoiceNumber.split('-')[2])
    sequence = lastSequence + 1
  }

  return `INV-${dateStr}-${sequence.toString().padStart(4, '0')}`
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID()
  let isPreviewRequest = false
  try {
    await requireAuth()

    const body = await request.json()
    const { clientId, jobIds: rawJobIds, dateDue, notes, showPaymentOptions, status, previewOnly } = body
    // Normalised once: an ad-hoc invoice (a fee, supplies, damage) carries no
    // jobs at all, and every query below would otherwise see `undefined`.
    const jobIds: string[] = Array.isArray(rawJobIds) ? rawJobIds : []
    // Supplied by the review workspace so adjustments can be gated and folded in.
    const adjustmentCandidateId: string | null = typeof body.candidateId === 'string' ? body.candidateId : null
    const adjustmentPeriod: string | null = typeof body.period === 'string' ? body.period : null
    isPreviewRequest = Boolean(previewOnly)
    const customLineItems = Array.isArray(body.lineItems) ? body.lineItems : null

    if (isPreviewRequest) {
      console.info('[invoice:create-preview] start', {
        requestId,
        clientId,
        jobCount: jobIds.length,
        customLineItemCount: customLineItems?.length || 0,
        dateDue: dateDue || null,
      })
    }

    // An invoice needs a client and something to bill. Usually that is cleans,
    // but an ad-hoc invoice (a fee, supplies, damage) has no jobs at all and
    // carries its own line items instead.
    const hasCustomLines = !!customLineItems && customLineItems.length > 0
    if (!clientId) {
      return NextResponse.json({ error: 'Client is required' }, { status: 400 })
    }
    if (jobIds.length === 0 && !hasCustomLines) {
      return NextResponse.json(
        { error: 'Add at least one clean or a line item to invoice.' },
        { status: 400 }
      )
    }

    // Get client to check billing type
    const client = await prisma.client.findUnique({
      where: { id: clientId },
    })

    if (!client) {
      return NextResponse.json(
        { error: 'Client not found' },
        { status: 404 }
      )
    }

    const jobs = await prisma.job.findMany({
      where: {
        id: { in: jobIds },
        status: { not: 'CANCELLED' },
        ...(previewOnly ? {} : { invoiced: false }),
      },
      include: {
        location: true,
        addOnServices: true,
        schedule: {
          include: {
            recurringAddOnServices: true,
          },
        },
      },
    })

    // If no valid jobs found, the jobs may have already been invoiced (double-click prevention).
    // An ad-hoc invoice legitimately has none — it bills its own line items.
    if (jobs.length === 0 && !hasCustomLines) {
      if (isPreviewRequest) {
        console.warn('[invoice:create-preview] no-valid-jobs', {
          requestId,
          clientId,
          requestedJobCount: jobIds.length,
        })
      }
      return NextResponse.json(
        { error: 'No jobs available to invoice. They may have already been invoiced.' },
        { status: 400 }
      )
    }

    // Calculate total based on billing type, unless the caller supplied reviewed line items.
    let totalAmount: number
    let lineItems: Array<{
      jobId: string | null
      addOnServiceId?: string | null
      description: string
      amount: number
      serviceDate: Date
    }>

    if (customLineItems && customLineItems.length > 0) {
      lineItems = customLineItems.map((item: {
        jobId?: string | null
        addOnServiceId?: string | null
        description?: string
        amount?: number
        serviceDate?: string | Date | null
      }) => ({
        jobId: item.jobId || null,
        addOnServiceId: item.addOnServiceId || null,
        description: item.description || 'Invoice item',
        amount: Number(item.amount || 0),
        serviceDate: item.serviceDate ? new Date(item.serviceDate) : new Date(),
      }))
      totalAmount = lineItems.reduce((sum, item) => sum + item.amount, 0)
    } else {

    // Helper to format month name
    const formatMonth = (date: Date) => {
      return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    }

    // Helper to format date professionally
    const formatServiceDate = (date: Date) => {
      return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    }

    // Determine billing type from the first recurring job's schedule
    const firstRecurringJob = jobs.find(job => job.scheduleId !== null)
    const clientPayType = firstRecurringJob?.schedule?.clientPayType || client.billingType || 'PER_CLEAN'

    if (clientPayType === 'FLAT_RATE') {
      // Separate recurring jobs (have scheduleId) from one-off jobs (no scheduleId)
      const recurringJobs = jobs.filter(job => job.scheduleId !== null)
      const oneOffJobs = jobs.filter(job => job.scheduleId === null)

      lineItems = []
      totalAmount = 0

      // Group recurring jobs by scheduleId to create separate line items per location/schedule
      if (recurringJobs.length > 0) {
        // Group jobs by scheduleId
        const jobsBySchedule = new Map<string | null, typeof recurringJobs>()
        recurringJobs.forEach(job => {
          const scheduleId = job.scheduleId || 'no-schedule'
          if (!jobsBySchedule.has(scheduleId)) {
            jobsBySchedule.set(scheduleId, [])
          }
          jobsBySchedule.get(scheduleId)!.push(job)
        })

        // Create a separate line item for each schedule/location
        jobsBySchedule.forEach((scheduleJobs) => {
          if (scheduleJobs.length > 0) {
            const firstJob = scheduleJobs[0]
            // Use the schedule's rate (source of truth) instead of the job's rate
            const monthlyRate = firstJob.schedule?.defaultClientRate || firstJob.clientRate || 0
            const serviceMonth = formatMonth(firstJob.date || new Date())
            const locationName = firstJob.location?.name || 'Unknown Location'

            // Add monthly rate line item
            lineItems.push({
              jobId: firstJob.id,
              addOnServiceId: null,
              description: `Monthly Cleaning - ${locationName} - ${serviceMonth}`,
              amount: monthlyRate,
              serviceDate: firstJob.date || new Date(),
            })
            totalAmount += monthlyRate

            // Add recurring add-on services from the schedule (billed once per schedule per month)
            const schedule = firstJob.schedule
            if (schedule?.recurringAddOnServices) {
              schedule.recurringAddOnServices.forEach(addOn => {
                lineItems.push({
                  jobId: firstJob.id,
                  addOnServiceId: addOn.id,
                  description: `${addOn.description} (recurring) - ${serviceMonth}`,
                  amount: addOn.clientRate,
                  serviceDate: firstJob.date || new Date(),
                })
                totalAmount += addOn.clientRate
              })
            }

            // Add one-time add-on line items from individual jobs in this schedule group
            scheduleJobs.forEach(scheduleJob => {
              scheduleJob.addOnServices.forEach(addOn => {
                lineItems.push({
                  jobId: scheduleJob.id,
                  addOnServiceId: addOn.id,
                  description: `${addOn.description} - ${formatServiceDate(scheduleJob.date)}`,
                  amount: addOn.clientRate,
                  serviceDate: scheduleJob.date || new Date(),
                })
                totalAmount += addOn.clientRate
              })
            })
          }
        })
      }

      // Add separate line items for one-off jobs (billed at their individual rates)
      oneOffJobs.forEach(job => {
        // Only add a job line item when it has a real rate (skip $0 container jobs)
        if (job.clientRate > 0) {
          lineItems.push({
            jobId: job.id,
            addOnServiceId: null,
            description: `Additional Service - ${job.location.name} - ${formatServiceDate(job.date)}`,
            amount: job.clientRate,
            serviceDate: job.date,
          })
          totalAmount += job.clientRate
        }

        // Add add-on line items for this job, appending the date for context
        job.addOnServices.forEach(addOn => {
          lineItems.push({
            jobId: job.id,
            addOnServiceId: addOn.id,
            description: `${addOn.description} - ${formatServiceDate(job.date)}`,
            amount: addOn.clientRate,
            serviceDate: job.date,
          })
          totalAmount += addOn.clientRate
        })
      })
    } else {
      // For per-clean: sum all job rates with professional descriptions
      lineItems = []
      totalAmount = 0

      jobs.forEach(job => {
        // Add job line item
        lineItems.push({
          jobId: job.id,
          addOnServiceId: null,
          description: `Commercial Cleaning Services - ${job.location.name} - ${formatServiceDate(job.date)}`,
          amount: job.clientRate,
          serviceDate: job.date,
        })
        totalAmount += job.clientRate

        // Add add-on line items for this job
        job.addOnServices.forEach(addOn => {
          lineItems.push({
            jobId: job.id,
            addOnServiceId: addOn.id,
            description: addOn.description,
            amount: addOn.clientRate,
            serviceDate: job.date,
          })
          totalAmount += addOn.clientRate
        })
      })
    }
    }

    // ── Review adjustments ────────────────────────────────────────────────
    // Credits/charges added while reviewing. Read from the DB rather than
    // trusting client-supplied amounts, and refuse outright while any are
    // unapproved: the design makes approval a hard gate on sending.
    if (adjustmentCandidateId && isValidAdjPeriod(adjustmentPeriod)) {
      const adjustments = await prisma.invoiceAdjustment.findMany({
        where: { candidateId: adjustmentCandidateId, period: adjustmentPeriod },
        orderBy: { createdAt: 'asc' },
      })

      const blocked = sendBlockedReason(adjustments)
      if (blocked) {
        return NextResponse.json({ error: blocked, code: 'ADJUSTMENTS_UNAPPROVED' }, { status: 409 })
      }

      for (const adj of adjustments) {
        lineItems.push({
          jobId: null,
          addOnServiceId: null,
          description: adj.label,
          amount: adj.amount, // already signed: credits negative, charges positive
          serviceDate: new Date(),
        })
        totalAmount += adj.amount
      }
    }

    // Generate invoice number
    const invoiceNumber = await generateInvoiceNumber()

    // Resolve the due date: use the explicit one, otherwise fall back to the
    // configured payment-terms default for this client's property type.
    let resolvedDateDue: Date | null = dateDue ? new Date(dateDue + 'T12:00:00') : null
    if (!resolvedDateDue) {
      const invoiceDefaults = await getInvoiceDefaults()
      resolvedDateDue = computeDefaultDueDate(client.propertyType, new Date(), invoiceDefaults)
    }

    // Identify which candidate this invoice is, so a retry recognises itself.
    //
    // The workspace creates a VOID preview and finalizes it immediately. The
    // double-billing guards below are skipped for previews on purpose, so
    // without this a failed send that was retried left a second finalized
    // invoice behind. Keyed on locations rather than the caller's candidate id
    // so a client invoiced separately per location keeps its separate invoices.
    let candidateKey: string | null = null
    if (adjustmentPeriod) {
      const jobLocations = await prisma.job.findMany({
        where: { id: { in: jobIds } },
        select: { locationId: true },
      })
      candidateKey = invoiceCandidateKey(adjustmentPeriod, jobLocations.map((j) => j.locationId))
    }

    if (candidateKey) {
      const existing = await prisma.invoice.findFirst({
        where: {
          clientId,
          status: { not: 'VOID' },
          OR: [
            { candidateKey },
            // Invoices created before this column existed carry no key. Job
            // overlap still identifies the per-clean ones; a legacy flat-rate
            // invoice has no job-linked line items and is only recognised once
            // it has been through here. Scoped to this path on purpose: the
            // quick-invoice flow sends no period and is left alone.
            { lineItems: { some: { jobId: { in: jobIds } } } },
          ],
        },
        select: { id: true, invoiceNumber: true, status: true, totalAmount: true },
        orderBy: { dateCreated: 'asc' },
      })
      if (existing) {
        if (isPreviewRequest) {
          console.info('[invoice:create-preview] reusing existing invoice', {
            requestId,
            invoiceId: existing.id,
            invoiceNumber: existing.invoiceNumber,
            candidateKey,
          })
        }
        return NextResponse.json(
          {
            error: `An invoice already exists for this client and billing period (${existing.invoiceNumber}).`,
            existingInvoice: existing,
          },
          { status: 409 },
        )
      }
    }

    // Use transaction to ensure invoice creation and job updates happen atomically
    const invoice = await prisma.$transaction(async (tx) => {
      // Double-billing prevention: do not create another real invoice for jobs
      // already represented by an active draft/sent/paid invoice. Preview
      // invoices are disposable and should not block opening the review modal,
      // especially on live data where older preview drafts may exist.
      if (!previewOnly) {
        const existingLineItems = await tx.invoiceLineItem.findMany({
          where: {
            jobId: { in: jobIds },
            invoice: { status: { not: 'VOID' } },
          },
          select: {
            invoice: {
              select: { invoiceNumber: true, status: true },
            },
          },
          take: 1,
        })
        if (existingLineItems.length > 0) {
          const existingInvoice = existingLineItems[0].invoice
          throw new Error(`These jobs are already on ${existingInvoice.status.toLowerCase()} invoice ${existingInvoice.invoiceNumber}.`)
        }
      }

      // Double-billing prevention: re-check no jobs are already invoiced
      if (!previewOnly) {
        const alreadyInvoiced = await tx.job.findMany({
          where: { id: { in: jobIds }, invoiced: true },
          select: { id: true },
        })
        if (alreadyInvoiced.length > 0) {
          throw new Error(`${alreadyInvoiced.length} job(s) are already invoiced. Please refresh and try again.`)
        }
      }

      // Create invoice with line items
      const newInvoice = await tx.invoice.create({
        data: {
          invoiceNumber,
          clientId,
          totalAmount,
          status: previewOnly ? 'VOID' : 'DRAFT',
          candidateKey,
          dateDue: resolvedDateDue,
          notes,
          showPaymentOptions: showPaymentOptions !== undefined ? showPaymentOptions : true,
          lineItems: {
            create: lineItems,
          },
        },
        include: {
          client: true,
          lineItems: {
            include: {
              job: {
                include: {
                  location: true,
                },
              },
            },
          },
        },
      })

      // Mark jobs as invoiced (only if not preview mode)
      if (!previewOnly) {
        await tx.job.updateMany({
          where: {
            id: { in: jobIds },
          },
          data: {
            invoiced: true,
          },
        })
      }

      return newInvoice
    })

    // Revalidate all invoice-related pages
    revalidateInvoicePages(invoice.client.id)

    if (isPreviewRequest) {
      console.info('[invoice:create-preview] success', {
        requestId,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        sourceJobCount: jobIds.length,
        lineItemCount: invoice.lineItems.length,
        totalAmount: invoice.totalAmount,
      })
    }

    return NextResponse.json(invoice)
  } catch (error) {
    logger.error('Error creating invoice:', error)
    if (error instanceof Error && error.message === 'Unauthorized') {
      return handleApiError(error, 'Failed to create invoice')
    }
    if (isPreviewRequest) {
      console.error('[invoice:create-preview] failed', {
        requestId,
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      })
    }
    let errorMessage = 'Failed to create invoice'
    
    if (error instanceof Error) {
      if (error.message.includes('Foreign key constraint')) {
        errorMessage = 'Invalid client or job selected. Please refresh the page and try again.'
      } else if (error.message.includes('Unique constraint')) {
        errorMessage = 'An invoice with this number already exists. Please try again.'
      } else if (error.message.includes('validation')) {
        errorMessage = 'Please check that all required fields are filled correctly.'
      } else {
        errorMessage = `Failed to create invoice: ${error.message}`
      }
    }
    
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}
