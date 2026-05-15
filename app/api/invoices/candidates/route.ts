import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { startOfMonth, endOfMonth, format } from "date-fns"
import { getBillingStartDate } from "@/lib/billing-settings"
import { logger } from "@/lib/logger"

export const dynamic = 'force-dynamic'

function jobMatchesScheduleDay(job: {
  date: Date
  schedule?: { frequency: string; daysOfWeek: string | null } | null
}) {
  if (!job.schedule?.daysOfWeek) return true

  const weeklyFrequencies = new Set(['WEEKLY', 'BI_WEEKLY', 'EVERY_3_WEEKS', 'EVERY_4_WEEKS', 'EVERY_6_WEEKS'])
  if (!weeklyFrequencies.has(job.schedule.frequency)) return true

  try {
    const daysOfWeek = JSON.parse(job.schedule.daysOfWeek) as number[]
    return daysOfWeek.includes(job.date.getUTCDay())
  } catch {
    return true
  }
}

function formatUtcCalendarDate(date: Date, includeYear = false) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    ...(includeYear ? { year: 'numeric' } : {}),
  }).format(date)
}

function compactLocationName(clientName: string, locationName: string) {
  let compact = locationName.trim()
  const escapedClient = clientName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  compact = compact
    .replace(new RegExp(`^${escapedClient}\\s*\\(([^)]+)\\)\\s*$`, 'i'), '$1')
    .replace(new RegExp(`^${escapedClient}\\s*[-–—:]?\\s*`, 'i'), '')
    .trim()
  return compact || locationName
}

/**
 * GET /api/invoices/candidates?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Generates invoice candidates for a billing period WITHOUT creating
 * any database records. This powers the Invoice Review Queue.
 *
 * Each candidate represents one client's expected invoice for the period,
 * with computed line items, exceptions, and status.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const startParam = searchParams.get('start')
    const endParam = searchParams.get('end')

    if (!startParam || !endParam) {
      return NextResponse.json(
        { error: 'start and end query parameters are required (YYYY-MM-DD)' },
        { status: 400 }
      )
    }

    const periodStart = new Date(startParam + 'T00:00:00')
    const periodEnd = new Date(endParam + 'T23:59:59.999')

    if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) {
      return NextResponse.json(
        { error: 'Invalid date format. Use YYYY-MM-DD.' },
        { status: 400 }
      )
    }

    const billingStartDate = await getBillingStartDate()
    const effectivePeriodStart = billingStartDate && billingStartDate > periodStart ? billingStartDate : periodStart
    const currentMonthStart = startOfMonth(new Date())
    const olderWorkCutoff = periodStart < currentMonthStart ? periodStart : currentMonthStart

    const [
      allJobs,
      existingInvoices,
      clientsWithSchedules,
    ] = await prisma.$transaction([
      // 1. Fetch ALL jobs in the period (including invoiced ones for detection)
      prisma.job.findMany({
        where: {
          date: { gte: effectivePeriodStart, lte: periodEnd },
        },
        include: {
          location: {
            include: { client: true },
          },
          schedule: {
            include: { recurringAddOnServices: true },
          },
          addOnServices: true,
          invoiceLineItems: {
            include: {
              invoice: {
                select: { id: true, invoiceNumber: true, status: true, billingPeriodStart: true, billingPeriodEnd: true },
              },
            },
          },
        },
        orderBy: { date: 'asc' },
      }),

      // 2. Fetch existing invoices that overlap the billing period
      prisma.invoice.findMany({
        where: {
          status: { not: 'VOID' },
          OR: [
            // Match by billing period fields
            {
              billingPeriodStart: { lte: periodEnd },
              billingPeriodEnd: { gte: periodStart },
            },
            // Fallback: match by creation date if no billing period set
            {
              billingPeriodStart: null,
              dateCreated: { gte: periodStart, lte: periodEnd },
            },
          ],
        },
        include: {
          client: true,
          lineItems: { include: { job: true } },
        },
      }),

      // 4. Also find clients with active schedules but NO jobs in the period
      //    (might be relevant for flat-rate clients)
      prisma.client.findMany({
        where: {
          isActive: true,
          locations: {
            some: {
              schedules: {
                some: { isActive: true },
              },
            },
          },
        },
        include: {
          locations: {
            include: {
              schedules: {
                where: { isActive: true },
                select: {
                  id: true,
                  frequency: true,
                  daysOfWeek: true,
                  startDate: true,
                  clientPayType: true,
                  defaultClientRate: true,
                  recurringAddOnServices: true,
                },
              },
            },
          },
        },
      }),
    ])

    // Index existing invoices by clientId
    const invoicesByClient = new Map<string, typeof existingInvoices>()
    existingInvoices.forEach(inv => {
      const arr = invoicesByClient.get(inv.clientId) || []
      arr.push(inv)
      invoicesByClient.set(inv.clientId, arr)
    })

    // 3. Group jobs by client
    type JobWithRelations = typeof allJobs[0]
    const jobsByClient = new Map<string, JobWithRelations[]>()

    allJobs.forEach(job => {
      const clientId = job.location.client.id
      if (!jobsByClient.has(clientId)) jobsByClient.set(clientId, [])
      jobsByClient.get(clientId)!.push(job)
    })

    // 5. Build candidates
    interface CandidateLineItem {
      description: string
      quantity: number
      price: number
      sourceType: 'JOB' | 'ADD_ON' | 'FLAT_RATE' | 'RECURRING_ADD_ON'
      sourceId?: string
      jobId?: string
      scheduleId?: string
      locationName?: string
    }

    interface CandidateException {
      type: 'SKIPPED' | 'RESCHEDULED' | 'ONE_TIME_ADD_ON' | 'MISSING_EMAIL' | 'PRICE_CHANGE' | 'ONE_OFF_JOB'
      message: string
      scheduleId?: string | null
      locationId?: string
    }

    interface Candidate {
      candidateId: string
      clientId: string
      clientName: string
      billingType: string
      status: 'READY' | 'NEEDS_ATTENTION' | 'DRAFT_EXISTS' | 'SENT' | 'PAID'
      scheduleSummary: string
      lineItems: CandidateLineItem[]
      exceptions: CandidateException[]
      total: number
      existingInvoiceId?: string
      existingInvoiceNumber?: string
      existingInvoiceStatus?: string
      jobCount: number
      completedCount: number
      hasEmail: boolean
      jobIds: string[]
    }

    const candidates: Candidate[] = []
    const representedInvoiceIds = new Set<string>()

    // Process each client with jobs
    for (const [clientId, jobs] of jobsByClient) {
      const client = jobs[0].location.client
      const clientInvoices = invoicesByClient.get(clientId) || []

      // Determine billing type from schedule or client
      const firstScheduleJob = jobs.find(j => j.scheduleId)
      const billingType = firstScheduleJob?.schedule?.clientPayType || client.billingType || 'PER_CLEAN'

      const hasEmail = !!(client.invoicingEmail || client.communicationEmail)

      // Check for existing invoices
      const existingDraft = clientInvoices.find(i => i.status === 'DRAFT')
      const existingSent = clientInvoices.find(i => i.status === 'SENT')
      const existingPaid = clientInvoices.find(i => i.status === 'PAID')
      const reservedJobIds = new Set<string>()
      const reservedScheduleMonths = new Set<string>()
      clientInvoices.forEach(invoice => {
        invoice.lineItems.forEach(item => {
          if (item.jobId) reservedJobIds.add(item.jobId)
          if (billingType === 'FLAT_RATE' && item.job?.scheduleId) {
            reservedScheduleMonths.add(`${item.job.scheduleId}:${format(item.job.date, 'yyyy-MM')}`)
          }
        })
      })
      const isReservedByInvoice = (job: JobWithRelations) => (
        reservedJobIds.has(job.id) ||
        (job.scheduleId ? reservedScheduleMonths.has(`${job.scheduleId}:${format(job.date, 'yyyy-MM')}`) : false)
      )

      // Separate jobs by type
      const uninvoicedJobs = jobs.filter(j => !j.invoiced && !isReservedByInvoice(j) && j.status !== 'CANCELLED')
      const skippedJobs = jobs.filter(j => j.status === 'CANCELLED' && jobMatchesScheduleDay(j))
      const recurringJobs = uninvoicedJobs.filter(j => j.scheduleId)
      const oneOffJobs = uninvoicedJobs.filter(j => !j.scheduleId)

      // Build exceptions
      const exceptions: CandidateException[] = []

      // Skipped cleans
      skippedJobs.forEach(job => {
        exceptions.push({
          type: 'SKIPPED',
          message: `${format(job.date, 'MMM d')} clean was skipped`,
          scheduleId: job.scheduleId,
          locationId: job.locationId,
        })
      })

      // One-off jobs (not part of recurring schedule)
      oneOffJobs.forEach(job => {
        if (job.clientRate > 0) {
          exceptions.push({
            type: 'ONE_OFF_JOB',
            message: `One-off job on ${format(job.date, 'MMM d')} — ${job.location.name}`,
            scheduleId: job.scheduleId,
            locationId: job.locationId,
          })
        }
      })

      // One-time add-ons (not recurring)
      uninvoicedJobs.forEach(job => {
        job.addOnServices.forEach(addOn => {
          // Only flag if it's a one-time add-on (not linked to schedule)
          if (!addOn.scheduleId) {
            exceptions.push({
              type: 'ONE_TIME_ADD_ON',
              message: `${addOn.description} add-on on ${format(job.date, 'MMM d')}`,
              scheduleId: job.scheduleId,
              locationId: job.locationId,
            })
          }
        })
      })

      // Price change detection
      recurringJobs.forEach(job => {
        if (job.schedule && job.clientRate !== job.schedule.defaultClientRate) {
          exceptions.push({
            type: 'PRICE_CHANGE',
            message: `${format(job.date, 'MMM d')}: Billed $${job.clientRate} instead of regular $${job.schedule.defaultClientRate}.`,
            scheduleId: job.scheduleId,
            locationId: job.locationId,
          })
        }
      })

      // Missing email
      if (!hasEmail) {
        exceptions.push({
          type: 'MISSING_EMAIL',
          message: 'No email address on file — cannot send invoice',
        })
      }

      const seenExceptions = new Set<string>()
      const dedupedExceptions = exceptions.filter((exception) => {
        const key = `${exception.type}:${exception.message}`
        if (seenExceptions.has(key)) return false
        seenExceptions.add(key)
        return true
      })

      // Build line items
      const lineItems: CandidateLineItem[] = []
      let total = 0

      if (billingType === 'FLAT_RATE') {
        // Group by schedule to get monthly rate per location
        const scheduleRates = new Map<string, { rate: number; locationName: string; jobCount: number; startDate: Date | null }>()
        const scheduleAddOns = new Map<string, Array<{ description: string; rate: number; id: string }>>()

        recurringJobs.forEach(job => {
          if (job.scheduleId && !scheduleRates.has(job.scheduleId)) {
            scheduleRates.set(job.scheduleId, {
              rate: job.schedule?.defaultClientRate ?? job.clientRate ?? 0,
              locationName: job.location.name,
              jobCount: 0,
              startDate: job.schedule?.startDate ?? null,
            })
            // Recurring add-ons (once per schedule per month)
            const recurring = job.schedule?.recurringAddOnServices || []
            if (recurring.length > 0) {
              scheduleAddOns.set(
                job.scheduleId,
                recurring.map(a => ({ description: a.description, rate: a.clientRate, id: a.id }))
              )
            }
          }
          if (job.scheduleId) {
            const entry = scheduleRates.get(job.scheduleId)!
            entry.jobCount++
          }
        })

        scheduleRates.forEach((info, scheduleId) => {
          const effectiveStart = info.startDate && info.startDate > periodStart ? info.startDate : periodStart
          const startLabel = info.startDate && info.startDate > periodStart
            ? formatUtcCalendarDate(effectiveStart)
            : format(periodStart, 'MMM d')
          const periodLabel = `${startLabel} – ${format(periodEnd, 'MMM d, yyyy')}`
          lineItems.push({
            description: `Monthly Cleaning — ${info.locationName} — ${periodLabel}`,
            quantity: 1,
            price: info.rate,
            sourceType: 'FLAT_RATE',
            sourceId: scheduleId,
            scheduleId,
            locationName: info.locationName,
          })
          total += info.rate

          // Recurring add-ons
          const addOns = scheduleAddOns.get(scheduleId) || []
          addOns.forEach(addOn => {
            lineItems.push({
              description: `${addOn.description} (recurring)`,
              quantity: 1,
              price: addOn.rate,
              sourceType: 'RECURRING_ADD_ON',
              sourceId: addOn.id,
              scheduleId,
              locationName: info.locationName,
            })
            total += addOn.rate
          })
        })

        // One-off jobs
        oneOffJobs.forEach(job => {
          if (job.clientRate > 0) {
            lineItems.push({
              description: `Additional Service — ${job.location.name} — ${format(job.date, 'MMM d')}`,
              quantity: 1,
              price: job.clientRate,
              sourceType: 'JOB',
              sourceId: job.id,
              jobId: job.id,
              locationName: job.location.name,
            })
            total += job.clientRate
          }
        })

        // One-time add-ons
        uninvoicedJobs.forEach(job => {
          job.addOnServices.forEach(addOn => {
            if (!addOn.scheduleId) {
              lineItems.push({
                description: `${addOn.description} — ${format(job.date, 'MMM d')}`,
                quantity: 1,
                price: addOn.clientRate,
                sourceType: 'ADD_ON',
                sourceId: addOn.id,
                jobId: job.id,
                locationName: job.location.name,
              })
              total += addOn.clientRate
            }
          })
        })
      } else {
        // PER_CLEAN: each job is a line item
        uninvoicedJobs.forEach(job => {
          lineItems.push({
            description: `Cleaning Services — ${job.location.name} — ${format(job.date, 'MMM d')}`,
            quantity: 1,
            price: job.clientRate,
            sourceType: 'JOB',
            sourceId: job.id,
            jobId: job.id,
            scheduleId: job.scheduleId || undefined,
            locationName: job.location.name,
          })
          total += job.clientRate

          // Add-on services for this job
          job.addOnServices.forEach(addOn => {
            lineItems.push({
              description: addOn.description,
              quantity: 1,
              price: addOn.clientRate,
              sourceType: 'ADD_ON',
              sourceId: addOn.id,
              jobId: job.id,
              scheduleId: job.scheduleId || undefined,
              locationName: job.location.name,
            })
            total += addOn.clientRate
          })
        })
      }

      // Build schedule summary
      const schedules = clientsWithSchedules.find(c => c.id === clientId)?.locations.flatMap(l => l.schedules) || []
      const freqLabels: Record<string, string> = {
        'WEEKLY': 'Weekly',
        'BI_WEEKLY': 'Bi-weekly',
        'MONTHLY': 'Monthly',
        '2X_MONTHLY': '2x/month',
        '2X_WEEKLY': '2x/week',
        '3X_WEEKLY': '3x/week',
      }
      const scheduleSummary = schedules.length > 0
        ? schedules.map(s => freqLabels[s.frequency] || s.frequency).join(', ')
        : 'No active schedule'

      // Determine status
      let status: Candidate['status'] = 'READY'
      let existingInvoiceId: string | undefined
      let existingInvoiceNumber: string | undefined
      let existingInvoiceStatus: string | undefined
      const existingInvoice = existingPaid || existingSent || existingDraft
      const hasRemainingWork = lineItems.length > 0

      if (hasRemainingWork) {
        status = dedupedExceptions.length > 0 ? 'NEEDS_ATTENTION' : 'READY'
      } else if (existingPaid) {
        status = 'PAID'
        existingInvoiceId = existingPaid.id
        existingInvoiceNumber = existingPaid.invoiceNumber
        existingInvoiceStatus = 'PAID'
      } else if (existingSent) {
        status = 'SENT'
        existingInvoiceId = existingSent.id
        existingInvoiceNumber = existingSent.invoiceNumber
        existingInvoiceStatus = 'SENT'
      } else if (existingDraft) {
        status = 'DRAFT_EXISTS'
        existingInvoiceId = existingDraft.id
        existingInvoiceNumber = existingDraft.invoiceNumber
        existingInvoiceStatus = 'DRAFT'
      } else if (dedupedExceptions.length > 0) {
        status = 'NEEDS_ATTENTION'
      }

      // Only include if there's something to invoice (line items or existing invoice)
      if (lineItems.length > 0 || existingInvoiceId) {
        if (existingInvoiceId) representedInvoiceIds.add(existingInvoiceId)
        const flatRateScheduleItems = billingType === 'FLAT_RATE'
          ? lineItems.filter(item => item.sourceType === 'FLAT_RATE' && item.scheduleId)
          : []

        const uniqueFlatRates = new Set(flatRateScheduleItems.map(item => item.price))
        const shouldSplitFlatRateBySchedule = flatRateScheduleItems.length > 1 && uniqueFlatRates.size > 1

        if (!existingInvoiceId && shouldSplitFlatRateBySchedule) {
          flatRateScheduleItems.forEach((scheduleItem) => {
            const scheduleId = scheduleItem.scheduleId!
            const scheduleJobs = uninvoicedJobs.filter(job => job.scheduleId === scheduleId)
            const scheduleJobIds = new Set(scheduleJobs.map(job => job.id))
            const scopedLineItems = lineItems.filter(item =>
              item.scheduleId === scheduleId ||
              (item.jobId ? scheduleJobIds.has(item.jobId) : false)
            )
            const scopedExceptions = dedupedExceptions.filter(exception =>
              !exception.scheduleId || exception.scheduleId === scheduleId
            )
            const scopedTotal = scopedLineItems.reduce((sum, item) => sum + item.price, 0)
            const locationLabel = scheduleItem.locationName
              ? ` - ${compactLocationName(client.name, scheduleItem.locationName)}`
              : ''

            candidates.push({
              candidateId: `${clientId}:${scheduleId}`,
              clientId,
              clientName: `${client.name}${locationLabel}`,
              billingType,
              status: scopedExceptions.length > 0 ? 'NEEDS_ATTENTION' : 'READY',
              scheduleSummary,
              lineItems: scopedLineItems,
              exceptions: scopedExceptions,
              total: scopedTotal,
              existingInvoiceId,
              existingInvoiceNumber,
              existingInvoiceStatus,
              jobCount: scheduleJobs.length,
              completedCount: scheduleJobs.filter(j => j.status === 'COMPLETED').length,
              hasEmail,
              jobIds: scheduleJobs.map(job => job.id),
            })
          })
        } else {
          candidates.push({
            candidateId: existingInvoiceId || clientId,
            clientId,
            clientName: client.name,
            billingType,
            status,
            scheduleSummary,
            lineItems,
            exceptions: dedupedExceptions,
            total: existingInvoiceId ? Number(existingInvoice?.totalAmount || total) : total,
            existingInvoiceId,
            existingInvoiceNumber,
            existingInvoiceStatus,
            jobCount: uninvoicedJobs.length,
            completedCount: uninvoicedJobs.filter(j => j.status === 'COMPLETED').length,
            hasEmail,
            jobIds: uninvoicedJobs.map(job => job.id),
          })
        }
      }
    }

    // Also add existing invoices that are not already represented above. This
    // lets partial invoices and remaining uninvoiced work show side by side.
    existingInvoices.forEach(inv => {
      if (representedInvoiceIds.has(inv.id)) return
      representedInvoiceIds.add(inv.id)

      let status: Candidate['status'] = 'DRAFT_EXISTS'
      if (inv.status === 'PAID') status = 'PAID'
      else if (inv.status === 'SENT') status = 'SENT'

      candidates.push({
        candidateId: inv.id,
        clientId: inv.clientId,
        clientName: inv.client.name,
        billingType: inv.client.billingType || 'PER_CLEAN',
        status,
        scheduleSummary: '',
        lineItems: [],
        exceptions: [],
        total: inv.totalAmount,
        existingInvoiceId: inv.id,
        existingInvoiceNumber: inv.invoiceNumber,
        existingInvoiceStatus: inv.status,
        jobCount: 0,
        completedCount: 0,
        hasEmail: !!(inv.client.invoicingEmail || inv.client.communicationEmail),
        jobIds: inv.lineItems.map(item => item.jobId).filter(Boolean) as string[],
      })
    })

    // 6. Check for older uninvoiced work (outside the selected period)
    const [olderUninvoicedCount, olderJobs] = await prisma.$transaction([
      prisma.job.count({
        where: {
          invoiced: false,
          status: { not: 'CANCELLED' },
          date: {
            lt: olderWorkCutoff,
            ...(billingStartDate ? { gte: billingStartDate } : {}),
          },
        },
      }),
      prisma.job.findMany({
        where: {
          invoiced: false,
          status: { not: 'CANCELLED' },
          date: {
            lt: olderWorkCutoff,
            ...(billingStartDate ? { gte: billingStartDate } : {}),
          },
        },
        select: { date: true },
        distinct: ['date'],
        orderBy: { date: 'asc' },
      }),
    ])

    // Get the months with older uninvoiced work
    let olderMonths: string[] = []
    if (olderUninvoicedCount > 0) {
      const months = new Set<string>()
      olderJobs.forEach(j => months.add(format(j.date, 'yyyy-MM')))
      olderMonths = Array.from(months)
    }

    // Sort candidates: NEEDS_ATTENTION first, then READY, then DRAFT_EXISTS, SENT, PAID
    const statusPriority: Record<string, number> = {
      'NEEDS_ATTENTION': 0,
      'READY': 1,
      'DRAFT_EXISTS': 2,
      'SENT': 3,
      'PAID': 4,
    }
    candidates.sort((a, b) => {
      const pa = statusPriority[a.status] ?? 99
      const pb = statusPriority[b.status] ?? 99
      if (pa !== pb) return pa - pb
      return a.clientName.localeCompare(b.clientName)
    })

    // Compute summary stats
    const readyCount = candidates.filter(c => c.status === 'READY').length
    const attentionCount = candidates.filter(c => c.status === 'NEEDS_ATTENTION').length
    const draftCount = candidates.filter(c => c.status === 'DRAFT_EXISTS').length
    const sentCount = candidates.filter(c => c.status === 'SENT').length
    const paidCount = candidates.filter(c => c.status === 'PAID').length
    const readyTotal = candidates
      .filter(c => c.status === 'READY' || c.status === 'NEEDS_ATTENTION')
      .reduce((sum, c) => sum + c.total, 0)

    return NextResponse.json({
      candidates,
      period: {
        start: startParam,
        end: endParam,
      },
      stats: {
        readyCount,
        attentionCount,
        draftCount,
        sentCount,
        paidCount,
        readyTotal,
        totalCandidates: candidates.length,
      },
      olderUninvoiced: {
        count: olderUninvoicedCount,
        months: olderMonths,
      },
    })
  } catch (error) {
    logger.error('Invoice candidates error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate invoice candidates' },
      { status: 500 }
    )
  }
}
