import { requireAuth } from "@/lib/auth"
import { InvoicingWorkspace } from "@/components/invoices/workspace/invoicing-workspace"

export const dynamic = "force-dynamic"

// Staged preview of the redesigned three-column invoicing workspace. Once the
// composer/send flow is wired, this becomes the main /invoices page.
export default async function InvoicingWorkspacePage() {
  await requireAuth()
  return <InvoicingWorkspace />
}
