import { redirect } from "next/navigation"

// The workspace is now the main invoices page; keep this staging URL working.
export default function InvoicingWorkspaceRedirect() {
  redirect("/invoices")
}
