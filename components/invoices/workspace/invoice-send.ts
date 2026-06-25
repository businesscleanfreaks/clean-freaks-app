import { formatCurrency } from "@/lib/utils"
import { showApiError, showError } from "@/lib/toast"
import { resolveTemplate, DEFAULT_SUBJECT, DEFAULT_MESSAGE } from "@/lib/invoice-template"
import { formatMonthLabel, type WorkspaceInvoice } from "./use-workspace"

/** Create the invoice from a candidate if it doesn't exist yet (preview → finalize). */
export async function ensureInvoiceId(inv: WorkspaceInvoice): Promise<string | null> {
  if (inv.existingInvoiceId) return inv.existingInvoiceId
  if (!inv.jobIds || inv.jobIds.length === 0) {
    showError(`${inv.clientName}: no billable cleans to invoice this month.`)
    return null
  }
  const res = await fetch("/api/invoices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: inv.clientId,
      jobIds: inv.jobIds,
      previewOnly: true,
      showPaymentOptions: true,
      lineItems: (inv.lineItems || []).map((li) => ({
        description: li.description,
        amount: li.quantity * li.price,
        jobId: li.jobId || null,
        addOnServiceId: li.sourceType === "ADD_ON" ? li.sourceId || null : null,
        serviceDate: new Date().toISOString(),
      })),
    }),
  })
  if (res.status === 409) {
    const body = await res.json().catch(() => null)
    if (body?.existingInvoice?.id) return body.existingInvoice.id
  }
  if (!res.ok) { await showApiError(res, `Failed to create invoice for ${inv.clientName}`); return null }
  const created = await res.json()
  await fetch(`/api/invoices/${created.id}/finalize`, { method: "POST" })
  return created.id as string
}

export interface InvoiceMismatchFinding { code: string; message: string }
export interface SendInvoiceResult {
  ok: boolean
  warning?: string
  error?: string
  mismatch?: boolean
  findings?: InvoiceMismatchFinding[]
}

/** Generate (host) the PDF, then send the invoice email. */
export async function sendInvoiceEmail(
  invoiceId: string,
  payload: { to: string[]; cc?: string; subject: string; message: string; isTest: boolean; showPaymentOptions?: boolean; confirmMismatch?: boolean },
): Promise<SendInvoiceResult> {
  await fetch(`/api/invoices/${invoiceId}/generate-pdf`, { method: "POST" })
  const res = await fetch(`/api/invoices/${invoiceId}/send-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, showPaymentOptions: payload.showPaymentOptions ?? true }),
  })
  const data = await res.json().catch(() => ({}))
  // The pre-invoice guard returns 409 when the invoice no longer matches the
  // schedule; surface the findings so the caller can confirm-and-resend.
  if (res.status === 409 && data?.code === "INVOICE_MISMATCH") {
    return { ok: false, mismatch: true, findings: data.findings ?? [], error: data?.error }
  }
  if (!res.ok) return { ok: false, error: data?.error || "Send failed" }
  return { ok: true, warning: data?.warning || data?.safetyMode }
}

export interface BatchResult { sent: number; skipped: number; failed: number; needsReview: number }

/**
 * Sequentially send every supplied (verified) invoice: resolve recipients from
 * each client + the workspace template, create the invoice if needed, then email
 * it. Reports progress as it goes; never claims more sent than actually went.
 */
export async function runBatchSend(
  invoices: WorkspaceInvoice[],
  month: string,
  onProgress: (done: number, total: number) => void,
): Promise<BatchResult> {
  const tpl = await fetch("/api/settings/email-template")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
  const subjectTpl: string = tpl?.subject || DEFAULT_SUBJECT
  const messageTpl: string = tpl?.message || DEFAULT_MESSAGE

  const [y, m] = month.split("-").map(Number)
  const dueDate = new Date(y, m - 1, 10).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
  const monthLabel = formatMonthLabel(month)

  const result: BatchResult = { sent: 0, skipped: 0, failed: 0, needsReview: 0 }

  for (let i = 0; i < invoices.length; i++) {
    onProgress(i, invoices.length)
    const inv = invoices[i]
    try {
      const client = await fetch(`/api/clients/${inv.clientId}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      const to = [client?.invoicingEmail || client?.communicationEmail].filter(Boolean) as string[]
      if (to.length === 0) { result.skipped++; continue }

      const vars = {
        client: inv.clientName,
        month: monthLabel,
        monthShort: monthLabel,
        total: formatCurrency(inv.total),
        dueDate,
      }
      const invoiceId = await ensureInvoiceId(inv)
      if (!invoiceId) { result.failed++; continue }

      const r = await sendInvoiceEmail(invoiceId, {
        to,
        cc: client?.invoicingCcEmail || undefined,
        subject: resolveTemplate(subjectTpl, vars),
        message: resolveTemplate(messageTpl, vars),
        isTest: false,
      })
      if (r.ok) result.sent++
      else if (r.mismatch) result.needsReview++ // doesn't match schedule — leave for per-invoice review
      else result.failed++
    } catch {
      result.failed++
    }
  }
  onProgress(invoices.length, invoices.length)
  return result
}
