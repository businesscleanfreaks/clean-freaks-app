import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  await requireAuth()
  const { searchParams } = new URL(request.url)
  const clientName = searchParams.get('clientName')

  const invoices = await prisma.invoice.findMany({
    where: clientName ? {
      client: { name: { contains: clientName } }
    } : undefined,
    include: {
      client: { select: { name: true } }
    },
    orderBy: { dateCreated: 'desc' },
    take: 20
  })

  return NextResponse.json({
    count: invoices.length,
    invoices: invoices.map(inv => ({
      id: inv.id,
      number: inv.invoiceNumber,
      client: inv.client.name,
      amount: inv.totalAmount,
      status: inv.status,
      created: inv.dateCreated
    }))
  })
}
