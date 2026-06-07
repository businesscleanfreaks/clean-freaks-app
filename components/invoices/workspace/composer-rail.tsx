"use client"

import { useEffect, useMemo, useState } from "react"
import useSWR from "swr"
import { Send, TestTube, X, Plus, CheckCircle2, DollarSign, RotateCcw, ExternalLink, Clock, FileText } from "lucide-react"
import { fetcher } from "@/lib/fetcher"
import { formatCurrency } from "@/lib/utils"
import { showSuccess, showError, showApiError } from "@/lib/toast"
import { resolveTemplate } from "@/lib/invoice-template"
import { formatMonthLabel, type WorkspaceInvoice } from "./use-workspace"
import { ensureInvoiceId, sendInvoiceEmail } from "./invoice-send"
import { SendLaterPopover } from "./send-later-popover"

interface ClientContact { id: string; name: string | null; email: string | null; role?: string | null }

function uniqEmails(list: (string | null | undefined)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const e of list) {
    const v = (e || "").trim()
    if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); out.push(v) }
  }
  return out
}

export function ComposerRail({ inv, month, onChanged }: { inv: WorkspaceInvoice; month: string; onChanged: () => void }) {
  const isSent = inv.uiStatus === "Sent" || inv.uiStatus === "Paid"

  const { data: clientData } = useSWR(`/api/clients/${inv.clientId}`, fetcher)
  const { data: contactsData } = useSWR(`/api/clients/${inv.clientId}/contacts`, fetcher)
  const { data: templateData } = useSWR("/api/settings/email-template", fetcher)
  const { data: invoiceData } = useSWR(
    isSent && inv.existingInvoiceId ? `/api/invoices/${inv.existingInvoiceId}` : null,
    fetcher,
  )

  const dueDate = useMemo(() => {
    const [y, m] = month.split("-").map(Number)
    return new Date(y, m - 1, 10).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
  }, [month])

  const pool = useMemo(() => {
    const contactEmails = (contactsData?.contacts || []).map((c: ClientContact) => c.email)
    return uniqEmails([clientData?.invoicingEmail, clientData?.communicationEmail, ...contactEmails])
  }, [clientData, contactsData])

  // Display name for a recipient email, when we have one.
  const nameFor = (email: string): string | null => {
    const e = email.toLowerCase()
    const c = (contactsData?.contacts || []).find((x: ClientContact) => (x.email || "").toLowerCase() === e)
    if (c?.name) return c.name
    if ((clientData?.invoicingEmail || "").toLowerCase() === e) return clientData?.invoicingContactName || null
    if ((clientData?.communicationEmail || "").toLowerCase() === e) return clientData?.communicationContactName || null
    return null
  }

  const [to, setTo] = useState<string[]>([])
  const [cc, setCc] = useState("")
  const [subject, setSubject] = useState("")
  const [message, setMessage] = useState("")
  const [manual, setManual] = useState("")
  const [payNow, setPayNow] = useState(true)
  const [sending, setSending] = useState(false)
  const [marking, setMarking] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [schedAnchor, setSchedAnchor] = useState<DOMRect | null>(null)

  // (Re)initialise composer when the selected invoice, recipient pool, or template changes.
  useEffect(() => {
    const vars = {
      client: inv.clientName,
      month: formatMonthLabel(month),
      monthShort: formatMonthLabel(month),
      total: formatCurrency(inv.total),
      dueDate,
    }
    const tpl = templateData || { subject: "Invoice · {client} · {month}", message: "Hi {client}, please find attached your invoice for {total} for {month}. Payment is due by {due_date}. Thank you for your business." }
    setSubject(resolveTemplate(tpl.subject, vars))
    setMessage(resolveTemplate(tpl.message, vars))
    setCc(clientData?.invoicingCcEmail || "")
    const def = clientData?.invoicingEmail || clientData?.communicationEmail || pool[0]
    setTo(def ? [def] : [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inv.candidateId, templateData, clientData, pool.join(",")])

  const toggleRecipient = (email: string) =>
    setTo((prev) => (prev.some((e) => e.toLowerCase() === email.toLowerCase()) ? prev.filter((e) => e.toLowerCase() !== email.toLowerCase()) : [...prev, email]))

  // Saved contacts not already added as recipients.
  const availablePool = useMemo(
    () => pool.filter((e) => !to.some((t) => t.toLowerCase() === e.toLowerCase())),
    [pool, to],
  )

  const send = async (isTest: boolean) => {
    if (to.length === 0 && !isTest) { showError("Add at least one recipient."); return }
    setSending(true)
    try {
      const invoiceId = await ensureInvoiceId(inv)
      if (!invoiceId) return
      const r = await sendInvoiceEmail(invoiceId, { to, cc: cc || undefined, subject, message, isTest, showPaymentOptions: payNow })
      if (!r.ok) { showError(r.error || "Failed to send invoice"); return }
      if (r.warning === "SENDING_DISABLED" || r.warning === "FORCED_TEST") {
        showSuccess(isTest ? "Test sent" : "Saved — sending is in test mode (enable it in Settings → Email)")
      } else {
        showSuccess(isTest ? "Test email sent" : `Invoice sent to ${to.join(", ")}`)
      }
      if (!isTest) onChanged()
    } catch {
      showError("Failed to send invoice")
    } finally {
      setSending(false)
    }
  }

  // Create the invoice (as a draft) without emailing it.
  const saveDraft = async () => {
    setSavingDraft(true)
    try {
      const invoiceId = await ensureInvoiceId(inv)
      if (invoiceId) { showSuccess("Draft saved"); onChanged() }
    } catch { showError("Failed to save draft") } finally { setSavingDraft(false) }
  }

  // "Send later": save the draft now and note the chosen time. Timed auto-firing
  // is a follow-up (needs the scheduled-send cron); we don't fake an auto-send.
  const handleSchedule = async (when: Date) => {
    setSchedAnchor(null)
    setSending(true)
    try {
      const invoiceId = await ensureInvoiceId(inv)
      if (!invoiceId) return
      const label = when.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
      showSuccess(`Draft saved · you planned to send ${label}. Send it from here when ready.`)
      onChanged()
    } catch { showError("Failed to save draft") } finally { setSending(false) }
  }

  // Re-email an already-sent invoice to the client's primary address.
  const resend = async () => {
    if (!inv.existingInvoiceId) return
    const recipients = uniqEmails([clientData?.invoicingEmail, clientData?.communicationEmail])
    if (recipients.length === 0) { showError("No email on file to resend to."); return }
    setSending(true)
    try {
      const vars = { client: inv.clientName, month: formatMonthLabel(month), monthShort: formatMonthLabel(month), total: formatCurrency(inv.total), dueDate }
      const tpl = templateData || {
        subject: "Invoice · {client} · {month}",
        message: "Hi {client}, please find attached your invoice for {total} for {month}. Payment is due by {due_date}. Thank you for your business.",
      }
      const r = await sendInvoiceEmail(inv.existingInvoiceId, {
        to: recipients, subject: resolveTemplate(tpl.subject, vars), message: resolveTemplate(tpl.message, vars), isTest: false,
      })
      if (!r.ok) { showError(r.error || "Failed to resend"); return }
      showSuccess("Invoice resent")
      onChanged()
    } catch { showError("Failed to resend") } finally { setSending(false) }
  }

  const markPaid = async (paid: boolean) => {
    if (!inv.existingInvoiceId) return
    setMarking(true)
    try {
      const url = `/api/invoices/${inv.existingInvoiceId}/${paid ? "mark-paid" : "reset"}`
      const res = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(paid ? { paymentMethod: "Zelle", paymentNotes: "Marked paid from workspace" } : {}),
      })
      if (!res.ok) { await showApiError(res, "Failed to update payment status"); return }
      showSuccess(paid ? "Marked as paid" : "Marked as unpaid")
      onChanged()
    } catch { showError("Failed to update payment status") } finally { setMarking(false) }
  }

  // ── Receipt mode (sent / paid) ──
  if (isSent) {
    const paid = inv.uiStatus === "Paid"
    const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null)
    const lifecycle = [
      { key: "gen", label: "Generated", date: fmt(invoiceData?.dateCreated), Icon: FileText, done: true, accent: false },
      { key: "sent", label: "Sent", date: fmt(invoiceData?.dateSent), Icon: Send, done: !!invoiceData?.dateSent, accent: false },
      { key: "paid", label: `Paid${invoiceData?.paymentMethod ? ` via ${invoiceData.paymentMethod}` : ""}`, date: fmt(invoiceData?.datePaid), Icon: CheckCircle2, done: paid, accent: true },
    ]
    return (
      <div className="flex h-full flex-col p-5">
        <div className={`rounded-lg px-4 py-3 ${paid ? "bg-emerald-50" : "bg-sky-50"}`}>
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className={paid ? "text-emerald-600" : "text-sky-600"} />
            <span className={`text-[13px] font-semibold ${paid ? "text-emerald-800" : "text-sky-800"}`}>{paid ? "Paid" : "Sent"}</span>
          </div>
          <div className="mt-1 text-[12px] text-stone-600">{inv.clientName} · {formatCurrency(inv.total)}</div>
        </div>

        {/* Lifecycle */}
        <div className="mt-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">Lifecycle</div>
          <div className="mt-2 space-y-2.5 rounded-lg border border-stone-200 p-3">
            {lifecycle.map((s) => (
              <div key={s.key} className="flex items-center gap-2.5 text-[12px]">
                <s.Icon size={14} className={s.done ? (s.accent && paid ? "text-emerald-600" : "text-stone-500") : "text-stone-300"} />
                <span className={s.done ? "font-medium text-stone-700" : "text-stone-400"}>{s.label}</span>
                <span className="ml-auto tabular-nums text-stone-400">{s.date || "—"}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Sent to */}
        {invoiceData?.sentTo && (
          <div className="mt-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">Sent to</div>
            <div className="mt-1 break-words text-[12px] text-stone-700">{invoiceData.sentTo}</div>
          </div>
        )}

        <div className="mt-auto space-y-2 pt-4">
          {paid ? (
            <button onClick={() => markPaid(false)} disabled={marking}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-stone-200 py-2 text-[12px] font-semibold text-stone-500 hover:bg-stone-50 disabled:opacity-50">
              <RotateCcw size={13} /> {marking ? "…" : "Mark as unpaid"}
            </button>
          ) : (
            <button onClick={() => markPaid(true)} disabled={marking}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-md py-2.5 text-[13px] font-semibold text-white disabled:opacity-60"
              style={{ background: "#059669" }}>
              <DollarSign size={15} /> {marking ? "Marking…" : "Mark as paid"}
            </button>
          )}
          {inv.existingInvoiceId && (
            <div className="flex gap-2">
              <a href={`/api/invoices/${inv.existingInvoiceId}/generate-pdf`} target="_blank" rel="noopener noreferrer"
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-stone-200 py-2 text-[12px] font-semibold text-stone-600 hover:bg-stone-50">
                <ExternalLink size={13} /> Download PDF
              </a>
              <button onClick={resend} disabled={sending}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-stone-200 py-2 text-[12px] font-semibold text-stone-600 hover:bg-stone-50 disabled:opacity-50">
                <Send size={13} /> {sending ? "…" : "Resend"}
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Composer (not sent) ──
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto p-5">
        <label className="text-[11px] font-semibold text-stone-500">Recipients</label>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {to.map((e) => {
            const nm = nameFor(e)
            return (
              <span key={e} className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 py-1 pl-2.5 pr-1.5 text-[11px] text-teal-800">
                <span className="inline-flex items-center gap-1 truncate" style={{ maxWidth: 210 }}>
                  <span className="rounded bg-teal-100 px-1 text-[9px] font-bold uppercase text-teal-700">To</span>
                  {nm && <span className="font-semibold">{nm}</span>}
                  <span className="truncate text-teal-600">{e}</span>
                </span>
                <button onClick={() => toggleRecipient(e)} className="text-teal-500 hover:text-teal-700"><X size={11} /></button>
              </span>
            )
          })}
          {to.length === 0 && <span className="text-[12px] text-amber-600">No recipient selected</span>}
        </div>

        {availablePool.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {availablePool.map((e) => (
              <button key={e} onClick={() => toggleRecipient(e)}
                className="inline-flex items-center gap-1 rounded-full border border-stone-200 px-2 py-0.5 text-[11px] text-stone-500 hover:border-teal-300 hover:text-teal-700">
                <Plus size={10} /> <span className="max-w-[160px] truncate">{e}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-2 text-[11px] text-stone-400">No more saved contacts for this client</div>
        )}

        <label className="mt-2.5 block text-[11px] text-stone-400">Or type a new email and press Enter</label>
        <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="email@example.com"
          onKeyDown={(e) => { if (e.key === "Enter" && manual.includes("@")) { toggleRecipient(manual.trim()); setManual("") } }}
          className="mt-1 w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-[12px] outline-none focus:border-stone-400" />

        <label className="mt-4 block text-[11px] font-semibold text-stone-500">CC</label>
        <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="cc@example.com"
          className="mt-1 w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-[12px] outline-none focus:border-stone-400" />

        <label className="mt-4 block text-[11px] font-semibold text-stone-500">Subject</label>
        <input value={subject} onChange={(e) => setSubject(e.target.value)}
          className="mt-1 w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-stone-400" />

        <label className="mt-4 block text-[11px] font-semibold text-stone-500">Message</label>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={6}
          className="mt-1 w-full resize-y rounded-md border border-stone-200 px-2.5 py-2 text-[13px] leading-relaxed outline-none focus:border-stone-400" />
      </div>

      {/* Sticky send bar */}
      <div className="border-t border-stone-200 bg-white p-3">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12px] text-stone-700">
            <input type="checkbox" checked={payNow} onChange={(e) => setPayNow(e.target.checked)} className="h-3.5 w-3.5 accent-teal-600" />
            Pay Now (Zelle)
          </label>
          <button onClick={(e) => setSchedAnchor(e.currentTarget.getBoundingClientRect())} disabled={sending}
            className="inline-flex items-center gap-1.5 rounded-md border border-stone-200 px-2.5 py-1 text-[11px] font-medium text-stone-500 hover:bg-stone-50 disabled:opacity-50">
            <Clock size={12} /> Send later
          </button>
        </div>
        <button onClick={() => send(false)} disabled={sending}
          className="flex w-full items-center justify-center gap-1.5 rounded-md py-2.5 text-[13px] font-semibold text-white disabled:opacity-60"
          style={{ background: "#0D9488" }}>
          <Send size={15} /> {sending ? "Sending…" : "Send to client"}
        </button>
        <div className="mt-2 flex items-center gap-2">
          <button onClick={() => send(true)} disabled={sending}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-stone-200 py-1.5 text-[12px] font-semibold text-stone-600 hover:bg-stone-50 disabled:opacity-50">
            <TestTube size={13} /> Send test
          </button>
          <button onClick={saveDraft} disabled={savingDraft}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-stone-200 py-1.5 text-[12px] font-semibold text-stone-600 hover:bg-stone-50 disabled:opacity-50">
            <FileText size={13} /> {savingDraft ? "Saving…" : "Save draft"}
          </button>
        </div>
      </div>

      {schedAnchor && (
        <SendLaterPopover anchor={schedAnchor} onCancel={() => setSchedAnchor(null)} onSchedule={handleSchedule} />
      )}
    </div>
  )
}
