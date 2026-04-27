import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'

async function generateInvoiceNumber(): Promise<string> {
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '')
  const latestInvoice = await prisma.invoice.findFirst({
    where: { invoiceNumber: { startsWith: `INV-${dateStr}-` } },
    orderBy: { invoiceNumber: 'desc' },
  })
  let sequence = 1
  if (latestInvoice) {
    const parts = latestInvoice.invoiceNumber.split('-')
    const lastSeq = parseInt(parts[parts.length - 1])
    if (!isNaN(lastSeq)) sequence = lastSeq + 1
  }
  return `INV-${dateStr}-${sequence.toString().padStart(4, '0')}`
}

export async function POST(request: Request) {
  try {
    const { clientId, amount, description, serviceDate } = await request.json()

    if (!clientId || !amount || amount <= 0) {
      return NextResponse.json(
        { error: 'clientId and a positive amount are required' },
        { status: 400 }
      )
    }

    const client = await prisma.client.findUnique({ where: { id: clientId } })
    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    const invoiceNumber = await generateInvoiceNumber()
    const dateDue = new Date()
    dateDue.setDate(dateDue.getDate() + 30)

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber,
        clientId,
        totalAmount: amount,
        status: 'DRAFT',
        dateDue,
        notes: 'Cancellation fee — created automatically',
        lineItems: {
          create: [{
            description: description || 'Cancellation fee',
            amount,
            serviceDate: serviceDate ? new Date(serviceDate) : new Date(),
          }],
        },
      },
      include: { client: true, lineItems: true },
    })

    logger.info('Cancellation fee invoice created:', invoice.invoiceNumber)
    return NextResponse.json({ success: true, invoice })
  } catch (error) {
    logger.error('Error creating cancellation fee invoice:', error)
    return NextResponse.json(
      { error: 'Failed to create cancellation fee invoice' },
      { status: 500 }
    )
  }
}
