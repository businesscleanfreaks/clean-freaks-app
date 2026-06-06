import { InvoicesClient } from "@/components/invoices/invoices-client"

// Previous invoicing review-queue, kept as a fallback while the redesigned
// workspace (now the main /invoices page) is verified on real data.
export default function InvoicesClassicPage() {
  return <InvoicesClient />
}
