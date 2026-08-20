"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import useSWR from "swr"
import { AlertTriangle, ChevronDown, Paperclip, Send, TestTube, X } from "lucide-react"
import { fetcher } from "@/lib/fetcher"
import { formatCurrency } from "@/lib/utils"
import { showSuccess, showError, showApiError } from "@/lib/toast"
import { resolveTemplate } from "@/lib/invoice-template"
import { useConfirm } from "@/hooks/use-confirm"
import { sendBlockedReason, type Adjustment } from "@/lib/invoice-adjustments"
import { buildClientMessage, firstNameOf, paysByZelle, resolvePayMethod } from "@/lib/invoice-client-message"
import {
  addRecipient,
  applyWarningFix,
  composeCopy,
  DEFAULT_SUBJECT,
  isValidEmail,
  MONTH_NAMES,
  parseEmails,
  preflight,
  type ComposeMode,
  type ComposeWarning,
} from "@/lib/invoice-compose"
import { formatMonthLabel, type WorkspaceInvoice } from "./use-workspace"
import { ensureInvoiceId, sendInvoiceEmail } from "./invoice-send"
import { SendLaterPopover } from "./send-later-popover"
import {
  clearComposeDraft,
  loadComposeDraft,
  saveComposeDraft,
  subscribeDraftMessage,
  currentDraftMessage,
  publishDraftMessage,
} from "./use-draft-message"

interface ClientContact { id: string; name: string | null; email: string | null; role?: string | null }

const ACCENT = "#0f5a36"

/**
 * The compose window: a Gmail-style sheet over the workspace, opened by
 * "Review email & send".
 *
 * Nothing sends from the ledger or the review pane directly — every send path
 * lands here first, because a VA is signing off on someone else's money and
 * needs to see the actual email before it goes.
 */
export function ComposeWindow({
  inv,
  month,
  mode = "send",
  onClose,
  onSent,
}: {
  inv: WorkspaceInvoice
  month: string
  mode?: ComposeMode
  onClose: () => void
  onSent: () => void
}) {
  const { data: clientData } = useSWR(`/api/clients/${inv.clientId}`, fetcher)
  const { data: contactsData } = useSWR(`/api/clients/${inv.clientId}/contacts`, fetcher)
  const { data: templateData } = useSWR("/api/settings/email-template", fetcher)
  const { data: business } = useSWR("/api/settings/business", fetcher)
  const { data: emailSettings } = useSWR("/api/settings/email", fetcher)
  const { data: contactNames } = useSWR<{ names: { clientId: string; firstNames: string[] }[] }>(
    "/api/clients/contact-names",
    fetcher,
  )
  const { data: adjData } = useSWR<{ adjustments: Adjustment[] }>(
    `/api/invoices/adjustments?candidateId=${encodeURIComponent(inv.candidateId)}&period=${month}`,
    fetcher,
  )

  const copy = composeCopy(mode)
  const monthLabel = formatMonthLabel(month)
  // The bare month name ("August"), which is how the email itself refers to the
  // period. The label carries the year too, and comparing against that would
  // flag the correct month as stale on every single invoice.
  const monthName = MONTH_NAMES[Number(month.split("-")[1]) - 1] ?? monthLabel
  const dueDate = useMemo(() => {
    const [y, m] = month.split("-").map(Number)
    return new Date(y, m - 1, 10).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
  }, [month])
  const dueShort = useMemo(() => {
    const [y, m] = month.split("-").map(Number)
    return new Date(y, m - 1, 10).toLocaleDateString("en-US", { month: "short", day: "numeric" })
  }, [month])

  const contactName: string | null = clientData?.invoicingContactName || clientData?.communicationContactName || null
  const toName = contactName || inv.clientName
  const payMethod = resolvePayMethod(clientData?.payMethod, clientData?.preferredPaymentMethod)
  const zelleEmail: string = business?.paymentEmail || "admin@thecleanfreaks.co"
  const invoiceNumber = inv.existingInvoiceNumber || "Draft"

  const fromName: string = emailSettings?.fromName || "The Clean Freaks"
  const fromEmail: string | null = emailSettings?.fromEmail || null

  // Saved addresses for this client, for the Cc suggestions.
  const pool = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const raw of [
      clientData?.invoicingEmail,
      clientData?.communicationEmail,
      ...((contactsData?.contacts || []) as ClientContact[]).map(c => c.email),
    ]) {
      const v = (raw || "").trim()
      if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); out.push(v) }
    }
    return out
  }, [clientData, contactsData])

  const nameFor = (email: string): string | null => {
    const e = email.toLowerCase()
    const c = ((contactsData?.contacts || []) as ClientContact[]).find(x => (x.email || "").toLowerCase() === e)
    if (c?.name) return c.name
    if ((clientData?.invoicingEmail || "").toLowerCase() === e) return clientData?.invoicingContactName || null
    if ((clientData?.communicationEmail || "").toLowerCase() === e) return clientData?.communicationContactName || null
    return null
  }

  const [to, setTo] = useState<string[]>([])
  const [cc, setCc] = useState<string[]>([])
  const [ccOpen, setCcOpen] = useState(false)
  const [toDraft, setToDraft] = useState("")
  const [ccDraft, setCcDraft] = useState("")
  const [subject, setSubject] = useState("")
  const [message, setMessage] = useState("")
  const [payNow, setPayNow] = useState(true)
  const [sending, setSending] = useState(false)
  const [schedAnchor, setSchedAnchor] = useState<DOMRect | null>(null)
  const [warnings, setWarnings] = useState<ComposeWarning[] | null>(null)
  const [acknowledged, setAcknowledged] = useState<string[]>([])

  const touchedRef = useRef(false)
  const hydratedRef = useRef(false)
  // The invoice this window created, if it had to create one. A failed send
  // leaves the window open with Send re-enabled, and creating the invoice again
  // on the retry would leave a second finalized invoice behind: the server's
  // double-billing guards are deliberately skipped for the previewOnly path
  // this uses.
  const createdIdRef = useRef<string | null>(null)

  const invoiceIdForSend = async (): Promise<string | null> => {
    if (createdIdRef.current) return createdIdRef.current
    const id = await ensureInvoiceId(inv, month)
    if (id) createdIdRef.current = id
    return id
  }
  const markTouched = () => { touchedRef.current = true }

  // The server refuses these too; disabling here just avoids a pointless click.
  const adjustmentsBlockedReason = sendBlockedReason(adjData?.adjustments ?? [])

  // Fill from the saved draft if one exists, else from the template and the
  // client's defaults. Keeps refreshing from those until the reviewer types.
  useEffect(() => {
    if (!hydratedRef.current) {
      hydratedRef.current = true
      const saved = loadComposeDraft(inv.candidateId)
      // A draft with no recipient is a seeded message, not a composed email:
      // restoring its empty `to` would silently clear the prefilled address.
      if (saved && saved.to.length > 0) {
        setTo(saved.to)
        setCc(parseEmails(saved.cc))
        setCcOpen(parseEmails(saved.cc).length > 0)
        setSubject(saved.subject)
        setMessage(saved.message)
        setPayNow(saved.payNow)
        touchedRef.current = true
        return
      }
    }
    if (touchedRef.current) return

    const vars = {
      client: inv.clientName,
      month: monthLabel,
      monthShort: monthLabel,
      total: formatCurrency(inv.total),
      dueDate,
      invoice_number: invoiceNumber,
    }
    const tpl = templateData || { subject: DEFAULT_SUBJECT, message: "" }
    setSubject(resolveTemplate(tpl.subject || DEFAULT_SUBJECT, vars))
    // An edit already made for this invoice wins. Otherwise seed the designed
    // copy — which includes the Zelle paragraph only for clients who pay that
    // way — falling back to the configured template.
    const shared = currentDraftMessage(inv.candidateId)
    if (shared !== null) {
      setMessage(shared)
    } else {
      const seeded = buildClientMessage({
        firstName: firstNameOf(contactName, inv.clientName),
        month: monthName,
        payMethod,
        zelleEmail,
      })
      setMessage(seeded || (tpl.message ? resolveTemplate(tpl.message, vars) : ""))
    }
    setCc(parseEmails(clientData?.invoicingCcEmail || ""))
    const def = clientData?.invoicingEmail || clientData?.communicationEmail || pool[0]
    setTo(def ? [def] : [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inv.candidateId, templateData, clientData, pool.join(",")])

  // Stay in step with the "Client will receive" pane behind the window.
  useEffect(() => subscribeDraftMessage(inv.candidateId, next => setMessage(next)), [inv.candidateId])

  // Auto-save (debounced) once the reviewer has edited anything.
  useEffect(() => {
    if (!touchedRef.current) return
    const t = setTimeout(() => {
      saveComposeDraft(inv.candidateId, { to, cc: cc.join(", "), subject, message, payNow })
    }, 600)
    return () => clearTimeout(t)
  }, [to, cc, subject, message, payNow, inv.candidateId])

  // Esc closes, matching every other sheet in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  const bodyRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [message])

  const otherFirstNames = useMemo(() => {
    const rows = contactNames?.names || []
    return rows.filter(r => r.clientId !== inv.clientId).flatMap(r => r.firstNames)
  }, [contactNames, inv.clientId])

  const commitChip = (which: "to" | "cc") => {
    const raw = which === "to" ? toDraft : ccDraft
    const emails = parseEmails(raw)
    if (emails.length === 0) return
    const bad = emails.find(e => !isValidEmail(e))
    if (bad) { showError(`"${bad}" is not an email address.`); return }
    markTouched()
    if (which === "to") { setTo(prev => emails.reduce(addRecipient, prev)); setToDraft("") }
    else { setCc(prev => emails.reduce(addRecipient, prev)); setCcDraft("") }
  }

  const chipKey = (which: "to" | "cc") => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commitChip(which) }
    if (e.key === "Backspace" && !(which === "to" ? toDraft : ccDraft)) {
      markTouched()
      if (which === "to") setTo(prev => prev.slice(0, -1))
      else setCc(prev => prev.slice(0, -1))
    }
  }

  const { confirm, ConfirmDialog } = useConfirm()

  const confirmMismatch = async (findings?: { message: string }[]) =>
    confirm({
      title: "This invoice no longer matches the schedule",
      description: `${(findings ?? []).map(f => `• ${f.message}`).join("\n") || "The cleans on this invoice no longer match the schedule."}\n\nSend it anyway?`,
      confirmText: "Send anyway",
    })

  const fixWarning = (w: ComposeWarning) => {
    markTouched()
    if (w.kind === "month") {
      const next = applyWarningFix(w, { subject, body: message })
      setSubject(next.subject)
      setMessage(next.body)
      publishDraftMessage(inv.candidateId, next.body)
    }
    setAcknowledged(prev => [...prev, w.from])
    setWarnings(prev => (prev || []).filter(x => x.id !== w.id))
  }

  const dismissWarning = (w: ComposeWarning) => {
    setAcknowledged(prev => [...prev, w.from])
    setWarnings(prev => (prev || []).filter(x => x.id !== w.id))
  }

  const send = async (isTest: boolean) => {
    if (to.length === 0 && !isTest) { showError("Add at least one recipient."); return }
    if (adjustmentsBlockedReason) { showError(adjustmentsBlockedReason); return }

    // Pre-send check. A real send stops once to show what looks wrong; a test
    // send does not, since nothing reaches the client.
    if (!isTest) {
      const found = preflight({
        body: message,
        subject,
        monthLabel: monthName,
        contactFirstName: firstNameOf(contactName, inv.clientName),
        otherFirstNames,
        acknowledged,
      })
      if (found.length > 0) {
        setWarnings(found)
        showError("Please review before sending")
        return
      }
    }

    setSending(true)
    try {
      const invoiceId = await invoiceIdForSend()
      if (!invoiceId) return
      const base = { to, cc: cc.length ? cc : undefined, subject, message, isTest, showPaymentOptions: payNow }
      let r = await sendInvoiceEmail(invoiceId, base)
      if (!r.ok && r.mismatch) {
        if (!(await confirmMismatch(r.findings))) return
        r = await sendInvoiceEmail(invoiceId, { ...base, confirmMismatch: true })
      }
      if (!r.ok) { showError(r.error || "Failed to send invoice"); return }
      if (r.warning === "SENDING_DISABLED" || r.warning === "FORCED_TEST") {
        showSuccess(isTest ? "Test sent" : "Saved · sending is in test mode (enable it in Settings → Email)")
      } else {
        showSuccess(isTest ? "Test email sent" : mode === "resend" ? "Corrected invoice resent" : `Invoice sent to ${to.join(", ")}`)
      }
      if (!isTest) { clearComposeDraft(inv.candidateId); onSent(); onClose() }
    } catch {
      showError("Failed to send invoice")
    } finally {
      setSending(false)
    }
  }

  const handleSchedule = async (when: Date) => {
    setSchedAnchor(null)
    if (to.length === 0) { showError("Add at least one recipient before scheduling."); return }
    setSending(true)
    try {
      const invoiceId = await invoiceIdForSend()
      if (!invoiceId) return
      const res = await fetch(`/api/invoices/${invoiceId}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduledSendAt: when.toISOString(),
          to,
          cc: cc.length ? cc.join(", ") : undefined,
          subject,
          message,
          showPaymentOptions: payNow,
        }),
      })
      if (!res.ok) { await showApiError(res, "Failed to schedule send"); return }
      clearComposeDraft(inv.candidateId)
      showSuccess(`Scheduled to send ${when.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`)
      onSent()
      onClose()
    } catch { showError("Failed to schedule send") } finally { setSending(false) }
  }

  const ccSuggestions = pool.filter(
    e => !to.some(t => t.toLowerCase() === e.toLowerCase()) && !cc.some(c => c.toLowerCase() === e.toLowerCase()),
  )

  const Chip = ({ email, onRemove }: { email: string; onRemove: () => void }) => (
    <span
      className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-stone-700"
      style={{ background: "#eef2f1", border: "1px solid #dde7e4", borderRadius: 20, padding: "3px 5px 3px 10px" }}
    >
      <span className="max-w-[230px] truncate">{email}</span>
      <button onClick={onRemove} aria-label={`Remove ${email}`}
        className="flex h-4 w-4 items-center justify-center rounded-full text-[11px] transition-colors hover:bg-white"
        style={{ color: "#8a9a95" }}>
        <X size={10} />
      </button>
    </span>
  )

  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[80] flex items-end justify-end"
      style={{ background: "rgba(15,23,42,.34)", padding: "0 30px 0 0" }}
    >
      <ConfirmDialog />
      <div
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label={copy.heading}
        className="flex flex-col overflow-hidden bg-white"
        style={{
          width: 600,
          maxWidth: "calc(100% - 40px)",
          height: "calc(100vh - 44px)",
          borderRadius: "16px 16px 0 0",
          boxShadow: "0 -8px 40px rgba(15,23,42,.22)",
        }}
      >
        {/* Header */}
        <div className="flex flex-none items-center gap-2.5 text-white" style={{ background: "#0f172a", padding: "13px 18px" }}>
          <Send size={16} />
          <span className="text-[13.5px] font-bold">{copy.heading}</span>
          <button onClick={onClose} aria-label="Close compose"
            className="ml-auto flex h-[26px] w-[26px] items-center justify-center rounded-md transition-colors hover:bg-white/10"
            style={{ color: "#cbd5e1" }}>
            <X size={14} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* From · the address the app is actually configured to send from */}
          <div className="flex items-center gap-2.5" style={{ padding: "11px 18px", borderBottom: "1px solid #f1f3f6" }}>
            <span className="w-[30px] flex-none text-[12px]" style={{ color: "#94a3af" }}>From</span>
            {fromEmail ? (
              <span className="inline-flex items-center gap-1.5 text-[12.5px]"
                style={{ background: "#f5f7f9", border: "1px solid #e7ebef", borderRadius: 8, padding: "5px 10px", color: "#0f172a", fontWeight: 650 }}>
                <span>{fromName}</span>
                <span style={{ color: "#94a3af", fontWeight: 500 }}>&lt;{fromEmail}&gt;</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-[12px] font-semibold text-amber-800">
                <AlertTriangle size={12} /> No send address set · Settings → Email
              </span>
            )}
          </div>

          {/* To */}
          <div className="flex items-start gap-2.5" style={{ padding: "11px 18px", borderBottom: "1px solid #f1f3f6" }}>
            <span className="w-[30px] flex-none pt-[5px] text-[12px]" style={{ color: "#94a3af" }}>To</span>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {to.map(e => (
                <Chip key={e} email={e} onRemove={() => { markTouched(); setTo(prev => prev.filter(x => x !== e)) }} />
              ))}
              <input
                value={toDraft}
                onChange={e => setToDraft(e.target.value)}
                onKeyDown={chipKey("to")}
                onBlur={() => commitChip("to")}
                placeholder="Add recipient…"
                className="min-w-[120px] flex-1 border-none bg-transparent py-[5px] text-[12.5px] outline-none"
              />
            </div>
            {!ccOpen && (
              <button onClick={() => setCcOpen(true)} className="flex-none pt-[5px] text-[12px]"
                style={{ color: "#15793f", fontWeight: 650 }}>Cc</button>
            )}
          </div>

          {/* Cc */}
          {ccOpen && (
            <div className="flex items-start gap-2.5" style={{ padding: "11px 18px", borderBottom: "1px solid #f1f3f6" }}>
              <span className="w-[30px] flex-none pt-[5px] text-[12px]" style={{ color: "#94a3af" }}>Cc</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  {cc.map(e => (
                    <Chip key={e} email={e} onRemove={() => { markTouched(); setCc(prev => prev.filter(x => x !== e)) }} />
                  ))}
                  <input
                    value={ccDraft}
                    onChange={e => setCcDraft(e.target.value)}
                    onKeyDown={chipKey("cc")}
                    onBlur={() => commitChip("cc")}
                    placeholder="Add cc…"
                    className="min-w-[120px] flex-1 border-none bg-transparent py-[5px] text-[12.5px] outline-none"
                  />
                </div>
                {ccSuggestions.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {ccSuggestions.map(e => {
                      const nm = nameFor(e)
                      return (
                        <button key={e} onClick={() => { markTouched(); setCc(prev => addRecipient(prev, e)) }} title={e}
                          className="inline-flex items-center gap-1.5 text-[12px] font-semibold"
                          style={{ background: "#fff", border: "1px solid #dfe3e8", borderRadius: 16, padding: "3px 11px 3px 4px", color: "#42505f" }}>
                          <span className="flex h-[19px] w-[19px] flex-none items-center justify-center rounded-full text-[10px]"
                            style={{ background: "#eaf5ee", color: "#15793f", fontWeight: 750 }}>
                            {(nm || e)[0]?.toUpperCase()}
                          </span>
                          <span className="max-w-[170px] truncate">{nm || e}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Subject */}
          <div className="flex items-center gap-2.5" style={{ padding: "11px 18px", borderBottom: "1px solid #f1f3f6" }}>
            <span className="w-[44px] flex-none text-[12px]" style={{ color: "#94a3af" }}>Subject</span>
            <input value={subject} onChange={e => { markTouched(); setSubject(e.target.value) }}
              className="flex-1 border-none bg-transparent py-1 text-[13px] font-semibold outline-none" style={{ color: "#0f172a" }} />
          </div>

          {/* Attachment */}
          <div className="flex items-center gap-2.5" style={{ padding: "9px 18px", borderBottom: "1px solid #f1f3f6" }}>
            <span className="flex w-[44px] flex-none items-center" style={{ color: "#94a3af" }}><Paperclip size={13} /></span>
            <a
              href={inv.existingInvoiceId ? `/api/invoices/${inv.existingInvoiceId}/generate-pdf` : undefined}
              target="_blank"
              rel="noopener noreferrer"
              title={inv.existingInvoiceId ? "Preview the attached invoice PDF" : "The PDF is generated when this invoice is sent"}
              className="inline-flex items-center gap-2"
              style={{ background: "#f7f8fa", border: "1px solid #e3e7ec", borderRadius: 9, padding: "5px 12px 5px 7px", cursor: inv.existingInvoiceId ? "pointer" : "default" }}
            >
              <span className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[5px] text-[8px] font-extrabold"
                style={{ background: "#fbecea", color: "#c0392b", letterSpacing: ".03em" }}>PDF</span>
              <span className="text-[12px] font-bold" style={{ color: "#3b4754" }}>Invoice {invoiceNumber}.pdf</span>
              <span className="text-[11px] tabular-nums" style={{ color: "#8b95a1" }}>{formatCurrency(inv.total)}</span>
            </a>
          </div>

          {/* Client will receive */}
          <div style={{ padding: "14px 18px 4px" }}>
            <div className="mb-2.5 flex flex-wrap items-baseline gap-2">
              <span className="text-[11px] font-bold uppercase" style={{ letterSpacing: ".05em", color: "#aab2bd" }}>Client will receive</span>
              <span className="text-[11.5px]" style={{ color: "#8b95a1" }}>
                To <strong style={{ color: "#4b5563", fontWeight: 700 }}>{toName}</strong>
                {to[0] ? ` · ${to[0]}` : ""}
              </span>
            </div>

            <div style={{ background: "#fff", border: "1px solid #e7ebef", borderRadius: 14, padding: 20 }}>
              <div className="mx-auto mb-3.5" style={{ maxWidth: 456 }}>
                <textarea
                  ref={bodyRef}
                  value={message}
                  onChange={e => { markTouched(); setMessage(e.target.value); publishDraftMessage(inv.candidateId, e.target.value) }}
                  spellCheck
                  title="Click to edit · this message appears above the invoice in the client's email"
                  className="w-full resize-none overflow-hidden border-none bg-transparent outline-none"
                  style={{ fontSize: 13, lineHeight: 1.65, color: "#26303c", borderRadius: 8, padding: "4px 6px" }}
                />
              </div>

              {/* The invoice card, as the client sees it in the email */}
              <div className="mx-auto overflow-hidden"
                style={{ maxWidth: 456, background: "#fff", border: "1px solid #e7ebef", borderRadius: 14, boxShadow: "0 1px 2px rgba(16,24,40,.05)" }}>
                <div className="flex items-center gap-2" style={{ padding: "16px 26px", borderBottom: "1px solid #eef1f4" }}>
                  <span style={{ fontSize: 15 }}>🧼</span>
                  <div style={{ lineHeight: 1.2 }}>
                    <div className="text-[12.5px] font-extrabold" style={{ color: "#182a44", letterSpacing: ".01em" }}>The Clean Freaks</div>
                    <div className="text-[10.5px] font-semibold" style={{ color: "#8a95a1" }}>Janitorial Services</div>
                  </div>
                </div>
                <div style={{ padding: "18px 26px 0" }}>
                  <div className="text-[10.5px] font-bold uppercase" style={{ letterSpacing: ".05em", color: "#98a2b3" }}>Amount due</div>
                  <div className="tabular-nums" style={{ fontSize: 31, fontWeight: 800, letterSpacing: "-.02em", color: "#182a44", lineHeight: 1.1, marginTop: 3 }}>
                    {formatCurrency(inv.total)}
                  </div>
                  <div className="text-[12.5px]" style={{ color: "#5a6b7d", marginTop: 6 }}>Invoice {invoiceNumber} · Due {dueShort}</div>
                  <div className="text-[12.5px]" style={{ color: "#98a2b3", marginTop: 2 }}>{monthLabel} cleaning services</div>
                </div>
                {paysByZelle(payMethod) && (
                  <div style={{ margin: "16px 26px 0", border: "1px solid #d5e6de", background: "#f5faf7", borderRadius: 10, padding: "13px 15px" }}>
                    <div className="text-[10.5px] font-extrabold uppercase" style={{ letterSpacing: ".04em", color: "#0f7a4e", marginBottom: 9 }}>Pay by Zelle</div>
                    <div className="flex justify-between gap-3 py-[3px] text-[12.5px]">
                      <span style={{ color: "#8a95a1" }}>Send to</span>
                      <span className="text-right" style={{ color: "#26303c", fontWeight: 650 }}>{zelleEmail}</span>
                    </div>
                    <div className="flex justify-between gap-3 py-[3px] text-[12.5px]">
                      <span style={{ color: "#8a95a1" }}>Amount</span>
                      <span className="tabular-nums" style={{ color: "#26303c", fontWeight: 650 }}>{formatCurrency(inv.total)}</span>
                    </div>
                  </div>
                )}
                <div style={{ height: 18 }} />
              </div>
            </div>

            {/* What is attached, and whether the invoice offers payment options */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex items-center gap-2.5"
                style={{ background: "#f6f8f7", border: "1px solid #e6ece9", borderRadius: 10, padding: "9px 13px" }}>
                <span className="flex flex-none items-center justify-center"
                  style={{ width: 30, height: 36, borderRadius: 5, background: "#fff", border: "1px solid #e1e7e4", color: ACCENT, fontSize: 8, fontWeight: 700 }}>
                  PDF
                </span>
                <div>
                  <div className="text-[12px]" style={{ fontWeight: 650 }}>Invoice {invoiceNumber}.pdf</div>
                  <div className="text-[11px] font-semibold" style={{ color: "#98a2b3" }}>Attached to this email</div>
                </div>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12px] text-stone-600">
                <input type="checkbox" checked={payNow} onChange={e => { markTouched(); setPayNow(e.target.checked) }}
                  className="h-3.5 w-3.5 accent-teal-600" />
                Show payment options on the invoice
              </label>
            </div>
          </div>
        </div>

        {/* Pre-send check */}
        {warnings && warnings.length > 0 && (
          <div className="flex-none" style={{ padding: "11px 18px", background: "#fef6ec", borderTop: "1px solid #f4e2c4" }}>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-extrabold uppercase" style={{ letterSpacing: ".02em", color: "#b45309" }}>
              <AlertTriangle size={13} /> Check before sending
            </div>
            {warnings.map(w => (
              <div key={w.id} className="flex items-center gap-2.5 py-1">
                <span className="min-w-0 flex-1 text-[12.5px]" style={{ color: "#7c5312" }}>{w.text}</span>
                {w.fixLabel && (
                  <button onClick={() => fixWarning(w)} className="flex-none rounded-lg bg-white px-2.5 py-1 text-[11.5px] font-bold"
                    style={{ color: "#b45309", border: "1px solid #e6c78a" }}>
                    {w.fixLabel}
                  </button>
                )}
                <button onClick={() => dismissWarning(w)} className="flex-none text-[11.5px] font-semibold" style={{ color: "#a9803a" }}>
                  {w.fixLabel ? "Ignore" : "It's fine"}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Send bar */}
        <div className="flex flex-none items-center gap-3" style={{ padding: "13px 18px", borderTop: "1px solid #f1f3f6" }}>
          <div className="relative flex flex-none">
            <button
              onClick={() => send(false)}
              disabled={sending || !!adjustmentsBlockedReason || to.length === 0}
              title={adjustmentsBlockedReason || undefined}
              className="text-[13.5px] font-bold text-white disabled:opacity-60"
              style={{ background: ACCENT, padding: "11px 22px", borderRadius: "11px 0 0 11px" }}
            >
              {sending ? "Sending…" : copy.sendLabel}
            </button>
            <button
              onClick={e => setSchedAnchor(e.currentTarget.getBoundingClientRect())}
              disabled={sending || !!adjustmentsBlockedReason}
              title="Schedule send"
              aria-label="Schedule send"
              className="flex items-center text-white disabled:opacity-60"
              style={{ background: ACCENT, borderLeft: "1px solid rgba(255,255,255,.22)", padding: "11px", borderRadius: "0 11px 11px 0" }}
            >
              <ChevronDown size={14} />
            </button>
          </div>

          <button onClick={() => send(true)} disabled={sending}
            className="inline-flex flex-none items-center gap-1.5 text-[12px] font-semibold text-stone-500 transition-colors hover:text-stone-800 disabled:opacity-50">
            <TestTube size={13} /> Send test
          </button>

          {adjustmentsBlockedReason && (
            <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-amber-700">{adjustmentsBlockedReason}</span>
          )}

          <button onClick={onClose} className="ml-auto flex-none text-[12.5px] font-semibold" style={{ color: "#94a3af" }}>
            Discard
          </button>
        </div>
      </div>

      {schedAnchor && (
        <SendLaterPopover anchor={schedAnchor} onCancel={() => setSchedAnchor(null)} onSchedule={handleSchedule} />
      )}
    </div>,
    document.body,
  )
}
