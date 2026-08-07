import { requireAuth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { InvoiceWorkspaceView } from "@/components/invoices/invoice-workspace-view"

export const dynamic = "force-dynamic"

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }> | { id: string }
}) {
  await requireAuth()
  const { id } = await Promise.resolve(params)

  // Open the workspace on the invoice's own month, otherwise its row would not
  // be in the list. Falls back to the current month if the invoice is missing.
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    select: { dateCreated: true },
  })
  const initialMonth = invoice
    ? `${invoice.dateCreated.getUTCFullYear()}-${String(invoice.dateCreated.getUTCMonth() + 1).padStart(2, "0")}`
    : undefined

  return <InvoiceWorkspaceView invoiceId={id} initialMonth={initialMonth} />
}
