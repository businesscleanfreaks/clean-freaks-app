"use client"

import { useEffect, useState } from "react"
import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"
import { showError, showSuccess } from "@/lib/toast"
import { PAY_METHOD_LABELS } from "@/lib/billing-schedule"
import { resolveInvoiceFooter, type InvoiceFooterTemplates } from "@/lib/billing-sections"
import { resolvePayMethod } from "@/lib/invoice-client-message"

interface Sections {
  invoiceFooterTemplates: InvoiceFooterTemplates
}

/**
 * What prints at the bottom of the invoice: the payment instructions for how
 * this client pays, and an optional one-off note.
 *
 * The instructions are the SHARED per-pay-method template, not a per-invoice
 * override — editing here changes it for every client who pays that way, which
 * is why the editor says so out loud before you save.
 */
export function InvoiceFooterAndNote({ clientId, invoiceId, initialNote }: {
  clientId: string
  /** Null until the invoice exists; the note is held locally until then. */
  invoiceId: string | null
  initialNote?: string | null
}) {
  const { data: client } = useSWR(`/api/clients/${clientId}`, fetcher)
  const { data: sections, mutate: mutateSections } = useSWR<Sections>(
    "/api/settings/billing-sections",
    fetcher,
    { revalidateOnFocus: false },
  )

  const payMethod = resolvePayMethod(client?.payMethod, client?.preferredPaymentMethod)
  const methodKey = (payMethod || "").trim().toUpperCase()
  const methodLabel = PAY_METHOD_LABELS[methodKey] ?? "No method set"

  const footerText = sections
    ? resolveInvoiceFooter(sections.invoiceFooterTemplates, payMethod, null)
    : null

  const [editing, setEditing] = useState<string | null>(null)
  const [savingFooter, setSavingFooter] = useState(false)

  const [noteOpen, setNoteOpen] = useState(!!initialNote)
  const [note, setNote] = useState(initialNote ?? "")
  const [savingNote, setSavingNote] = useState(false)

  useEffect(() => {
    setNote(initialNote ?? "")
    setNoteOpen(!!initialNote)
  }, [initialNote, invoiceId])

  const saveFooter = async () => {
    if (editing === null || !sections) return
    setSavingFooter(true)
    try {
      const res = await fetch("/api/settings/billing-sections", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: "invoiceFooterTemplates",
          value: { ...sections.invoiceFooterTemplates, [methodKey]: editing },
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        showError(err?.error || "Could not save the payment instructions")
        return
      }
      mutateSections(await res.json(), false)
      setEditing(null)
      showSuccess(`Saved · updated for every client who pays by ${methodLabel}`)
    } catch {
      showError("Could not save the payment instructions")
    } finally {
      setSavingFooter(false)
    }
  }

  // Only persistable once the invoice exists; before that the text stays on
  // screen and is written when the invoice is created.
  const saveNote = async () => {
    if (!invoiceId) return
    setSavingNote(true)
    try {
      const res = await fetch(`/api/invoices/${invoiceId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: note }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        showError(err?.error || "Could not save the note")
        return
      }
      showSuccess(note.trim() ? "Note saved · prints on the invoice" : "Note removed")
    } catch {
      showError("Could not save the note")
    } finally {
      setSavingNote(false)
    }
  }

  const canEdit = (["ZELLE", "ACH", "PORTAL", "CHECK"] as string[]).includes(methodKey)

  return (
    <div>
      <div style={{ background: "#fafbfc", border: "1px solid #f1f3f6", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ padding: "12px 15px 13px" }}>
          <div className="mb-2 flex items-baseline justify-between gap-2.5">
            <div className="text-[12.5px] font-bold text-[#5b6470]">
              Client Payment Instructions{" "}
              <span className="font-medium text-[#9aa3af]">· printed at the bottom of the invoice</span>
            </div>
            {editing === null && canEdit && (
              <button
                type="button"
                onClick={() => setEditing(footerText ?? "")}
                className="flex-none text-[11.5px] font-bold text-[#15793f]"
              >
                Edit
              </button>
            )}
          </div>

          {editing === null ? (
            <div
              className="flex items-start gap-2.5"
              style={{ background: "#fff", border: "1px solid #eef0f3", borderRadius: 10, padding: "10px 12px" }}
            >
              <span
                className="mt-px flex-none rounded-[5px] px-2 py-[3px] text-[10px] font-extrabold uppercase tracking-[0.04em]"
                style={{ background: "#eaf0fa", color: "#3a66b0" }}
              >
                {methodLabel}
              </span>
              <div className="min-w-0 text-[12px] leading-[1.5] text-[#475467]">
                {footerText || "No payment instructions for this method yet."}
              </div>
            </div>
          ) : (
            <>
              <textarea
                value={editing}
                onChange={e => setEditing(e.target.value)}
                aria-label="Payment instructions"
                className="w-full resize-y rounded-[9px] px-2.5 py-2 text-[12.5px] leading-[1.5] text-[#111827] outline-none"
                style={{ minHeight: 64, border: "1.5px solid #15793f" }}
              />
              <div className="mt-2 flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={saveFooter}
                  disabled={savingFooter}
                  className="rounded-[8px] px-3.5 py-[7px] text-[12px] font-bold text-white disabled:opacity-60"
                  style={{ background: "#15793f" }}
                >
                  {savingFooter ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="text-[12px] font-semibold text-[#64748b]"
                >
                  Cancel
                </button>
                {/* Says the blast radius before you commit to it. */}
                <span className="ml-auto text-[11px] text-[#9aa3af]">
                  Applies to every client who pays by {methodLabel}
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {!noteOpen ? (
        <button
          type="button"
          onClick={() => setNoteOpen(true)}
          className="mt-2.5 flex items-center gap-[7px] px-0.5 pt-0.5"
        >
          <span className="text-[12.5px] font-bold text-[#5b6470]">+ Add a note</span>
          <span className="text-[11.5px] text-[#9aa3af]">optional · shows on the invoice</span>
        </button>
      ) : (
        <div
          className="mt-2.5"
          style={{ background: "#fafbfc", border: "1px solid #f1f3f6", borderRadius: 14, padding: "12px 15px 13px" }}
        >
          <div className="mb-[7px] text-[12.5px] font-bold text-[#5b6470]">
            Note on this invoice <span className="font-medium text-[#9aa3af]">(optional)</span>
          </div>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            onBlur={saveNote}
            placeholder="e.g. Includes the carpet deep clean we discussed"
            aria-label="Note on this invoice"
            className="w-full resize-y rounded-[9px] bg-white px-2.5 py-2 text-[12.5px] leading-[1.5] text-[#111827] outline-none"
            style={{ minHeight: 56, border: "1px solid #e2e5e9" }}
          />
          <div className="mt-1.5 text-[11px] text-[#9aa3af]">
            {savingNote
              ? "Saving…"
              : invoiceId
                ? "Saved when you click away."
                : "Saved with the invoice when it is created."}
          </div>
        </div>
      )}
    </div>
  )
}
