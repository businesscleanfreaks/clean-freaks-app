import { requireAuth } from "@/lib/auth"
import { InvoicesOverview } from "@/components/invoices/invoices-overview"

export const dynamic = "force-dynamic"

// Invoices overview: month picker + the four money cards + that month's list.
// The left-to-right review workspace now lives at /invoices/workspace.
export default async function InvoicesPage() {
  await requireAuth()
  return <InvoicesOverview />
}
