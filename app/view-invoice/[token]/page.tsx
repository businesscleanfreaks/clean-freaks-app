import { notFound } from "next/navigation"
import { PublicInvoiceView } from "@/components/invoices/public-invoice-view"
import { prisma } from "@/lib/db"
import { decodeInvoiceToken } from "@/lib/invoice-tokens"
import { PUBLIC_INVOICE_SELECT, type PublicInvoice } from "@/lib/public-invoice"

export const dynamic = 'force-dynamic'
export const revalidate = 0

async function getInvoice(id: string) {
  // An explicit allowlist, not an include. Everything handed to the client
  // component below is serialised into the page and readable by anyone with
  // the link · this page used to ship the client's gate codes and alarm
  // details, our internal account notes, and what we pay the cleaner, none of
  // which it ever displayed. See lib/public-invoice.ts.
  return prisma.invoice.findUnique({
    where: { id },
    select: PUBLIC_INVOICE_SELECT,
  })
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

  return <PublicInvoiceView invoice={invoice as PublicInvoice} token={resolvedParams.token} />
}
