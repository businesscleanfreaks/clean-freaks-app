import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/auth"
import { format } from "date-fns"

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    await requireAuth()

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') // SENT, PAID, DRAFT, or all
    const startDate = searchParams.get('start')
    const endDate = searchParams.get('end')

    const where: Record<string, unknown> = {}
    if (status && status !== 'all') {
      where.status = status
    }
    if (startDate || endDate) {
      where.dateCreated = {}
      if (startDate) (where.dateCreated as Record<string, unknown>).gte = new Date(startDate)
      if (endDate) (where.dateCreated as Record<string, unknown>).lte = new Date(endDate + 'T23:59:59.999Z')
    }

    const invoices = await prisma.invoice.findMany({
      where,
      include: {
        client: { select: { name: true } },
        lineItems: true,
      },
      orderBy: { dateCreated: 'desc' },
    })

    const lines: string[] = []
    lines.push('Invoice Number,Client,Date Created,Date Due,Status,Total Amount,Line Items Count')

    for (const inv of invoices) {
      const clientName = (inv.client?.name || 'Unknown').replace(/,/g, ';')
      const dateCreated = format(new Date(inv.dateCreated), 'yyyy-MM-dd')
      const dateDue = inv.dateDue ? format(new Date(inv.dateDue), 'yyyy-MM-dd') : ''
      const total = inv.totalAmount.toFixed(2)
      const lineItemCount = inv.lineItems?.length || 0

      lines.push(`${inv.invoiceNumber},${clientName},${dateCreated},${dateDue},${inv.status},${total},${lineItemCount}`)
    }

    const csv = lines.join('\n')
    const statusLabel = status || 'all'
    const filename = `Invoices_${statusLabel}_${format(new Date(), 'yyyy-MM-dd')}.csv`

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    console.error('Bulk invoice export error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to export invoices' },
      { status: 500 }
    )
  }
}
