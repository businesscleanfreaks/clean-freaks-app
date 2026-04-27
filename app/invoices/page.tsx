import { InvoicesClient } from "@/components/invoices/invoices-client"

// This page now loads instantly - all data fetching happens client-side
export default function InvoicesPage() {
  return <InvoicesClient />
}
