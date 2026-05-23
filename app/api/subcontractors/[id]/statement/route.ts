import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/auth"
import { format, endOfDay } from "date-fns"
import { getBillingStartDate } from "@/lib/billing-settings"

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth()
    const { id } = await params
    const billingStartDate = await getBillingStartDate()
    const today = endOfDay(new Date())

    const subcontractor = await prisma.subcontractor.findUnique({
      where: { id },
      select: { name: true },
    })

    if (!subcontractor) {
      return NextResponse.json({ error: "Subcontractor not found" }, { status: 404 })
    }

    // Get all unpaid jobs (assumed completion model)
    const unpaidJobs = await prisma.job.findMany({
      where: {
        subcontractorId: id,
        subcontractorPaid: false,
        OR: [
          { status: "COMPLETED" },
          { status: "SCHEDULED", date: { lte: today } },
        ],
        ...(billingStartDate ? { date: { gte: billingStartDate } } : {}),
      },
      include: {
        location: {
          include: { client: true },
        },
        addOnServices: true,
      },
      orderBy: { date: 'asc' },
    })

    // Get paid jobs (history) from payments
    const payments = await prisma.subcontractorPayment.findMany({
      where: { subcontractorId: id },
      include: {
        lineItems: {
          include: {
            job: {
              include: {
                location: {
                  include: { client: true },
                },
              },
            },
          },
        },
      },
      orderBy: { datePaid: 'desc' },
    })

    // Build CSV content
    const lines: string[] = []

    // Header
    lines.push(`Statement for: ${subcontractor.name}`)
    lines.push(`Generated: ${format(new Date(), 'MMMM d, yyyy')}`)
    lines.push('')

    // UNPAID SECTION
    lines.push('=== UNPAID JOBS ===')
    lines.push('Date,Client,Location,Rate,Add-Ons,Total,Status')

    let unpaidTotal = 0
    for (const job of unpaidJobs) {
      const jobDate = format(new Date(job.date), 'yyyy-MM-dd')
      const clientName = job.location.client.name.replace(/,/g, ';')
      const locationName = job.location.name.replace(/,/g, ';')
      const rate = job.subcontractorRate || 0
      const addOnTotal = (job.addOnServices || []).reduce(
        (sum, a) => sum + (a.subcontractorRate || 0), 0
      )
      const total = rate + addOnTotal
      unpaidTotal += total
      // Past SCHEDULED jobs are assumed completed per business rules
      const displayStatus = job.status === 'SCHEDULED' && new Date(job.date) <= today
        ? 'Completed (assumed)'
        : job.status
      lines.push(`${jobDate},${clientName},${locationName},${rate.toFixed(2)},${addOnTotal.toFixed(2)},${total.toFixed(2)},${displayStatus}`)
    }

    lines.push(`,,,,TOTAL,${unpaidTotal.toFixed(2)},`)
    lines.push('')

    // PAYMENT HISTORY SECTION
    lines.push('=== PAYMENT HISTORY ===')
    lines.push('Payment Date,Amount,Jobs Count,Notes')

    for (const payment of payments) {
      const paidDate = format(new Date(payment.datePaid), 'yyyy-MM-dd')
      const notes = (payment.notes || '').replace(/,/g, ';').replace(/\n/g, ' ')
      lines.push(`${paidDate},${payment.totalAmount.toFixed(2)},${payment.lineItems.length},${notes}`)
    }

    const csv = lines.join('\n')

    const safeName = subcontractor.name.replace(/[^a-zA-Z0-9]/g, '_')
    const filename = `Statement_${safeName}_${format(new Date(), 'yyyy-MM-dd')}.csv`

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, max-age=10, stale-while-revalidate=59',
      },
    })
  } catch (error) {
    console.error('Statement export error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate statement' },
      { status: 500 }
    )
  }
}
