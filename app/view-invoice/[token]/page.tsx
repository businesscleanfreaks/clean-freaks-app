import { notFound } from "next/navigation"
import { PublicInvoiceView } from "@/components/invoices/public-invoice-view"
import { prisma } from "@/lib/db"
import { decodeInvoiceToken } from "@/lib/invoice-tokens"
import type { InvoiceWithRelations } from "@/types"

export const dynamic = 'force-dynamic'
export const revalidate = 0

async function getInvoice(id: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      client: {
        include: {
          locations: true,
        },
      },
      lineItems: {
        include: {
          job: {
            include: {
              location: true,
            },
          },
        },
        orderBy: {
          serviceDate: 'asc',
        },
      },
    },
  })

  if (!invoice) {
    return null
  }

  return invoice
}

export default async function PublicInvoicePage({
  params,
}: {
  params: Promise<{ token: string }> | { token: string }
}) {
  const resolvedParams = await Promise.resolve(params)
  const invoiceId = decodeInvoiceToken(resolvedParams.token)
  
  if (!invoiceId) {
    notFound() // Invalid or expired token
  }
  
  const invoice = await getInvoice(invoiceId)
  
  if (!invoice) {
    notFound() // Invoice not found
  }
  
  return <PublicInvoiceView invoice={invoice as unknown as InvoiceWithRelations} />
}

