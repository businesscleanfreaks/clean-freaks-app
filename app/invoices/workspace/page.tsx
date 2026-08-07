import { requireAuth } from "@/lib/auth"
import { InvoicingWorkspace } from "@/components/invoices/workspace/invoicing-workspace"

export const dynamic = "force-dynamic"

// The left-to-right review workspace (list │ verdict │ preview │ recipients).
// /invoices is now the overview, so the workspace lives here.
export default async function InvoicingWorkspacePage() {
  await requireAuth()
  return <InvoicingWorkspace />
}
