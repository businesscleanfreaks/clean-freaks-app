"use client"

import { useCallback, useState } from "react"
import { InvoicingWorkspace } from "./workspace/invoicing-workspace"
import { InvoiceDetailClient } from "./invoice-detail-client"

/**
 * Opening an invoice shows the left-to-right workspace focused on it.
 *
 * Not every invoice has a workspace row — a standalone invoice (cancellation
 * fee, off-calendar charge) has no candidate to match. Rather than let the
 * workspace fall back to whatever row is first (which would show the WRONG
 * invoice), those fall back to the classic detail page.
 */
export function InvoiceWorkspaceView({
  invoiceId,
  initialMonth,
}: {
  invoiceId: string
  initialMonth?: string
}) {
  const [unavailable, setUnavailable] = useState(false)
  const handleUnavailable = useCallback(() => setUnavailable(true), [])

  if (unavailable) return <InvoiceDetailClient invoiceId={invoiceId} />

  return (
    <InvoicingWorkspace
      initialMonth={initialMonth}
      focusInvoiceId={invoiceId}
      onFocusUnavailable={handleUnavailable}
    />
  )
}
