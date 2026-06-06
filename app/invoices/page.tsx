import { requireAuth } from "@/lib/auth"
import { InvoicingWorkspace } from "@/components/invoices/workspace/invoicing-workspace"

export const dynamic = "force-dynamic"

// Redesigned three-column invoicing workspace (was the review-queue). The
// previous page is preserved at /invoices/classic during rollout.
export default async function InvoicesPage() {
  await requireAuth()
  return <InvoicingWorkspace />
}
