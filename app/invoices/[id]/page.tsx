import { requireAuth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { InvoiceWorkspaceView } from "@/components/invoices/invoice-workspace-view"
import { invoiceWorkspaceMonth } from "@/lib/invoice-month"

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
  //
  // The billing period is what matters, not the day the invoice was written:
  // billing in arrears means an August invoice is created in September, and
  // reading `dateCreated` here opened the workspace a month away from the row.
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    select: { dateCreated: true, billingPeriodStart: true },
  })
  const initialMonth = invoice ? invoiceWorkspaceMonth(invoice) ?? undefined : undefined

  return <InvoiceWorkspaceView invoiceId={id} initialMonth={initialMonth} />
}
