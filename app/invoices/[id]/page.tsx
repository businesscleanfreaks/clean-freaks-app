import { InvoiceDetailClient } from "@/components/invoices/invoice-detail-client"

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }> | { id: string }
}) {
  const resolvedParams = await Promise.resolve(params)
  return <InvoiceDetailClient invoiceId={resolvedParams.id} />
}
