"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { loadComposeDraft, currentDraftMessage } from "./use-draft-message"

type Tab = "email" | "pdf"

/**
 * The whole thing, as the client gets it — the covering email on one tab and
 * the invoice document on the other.
 *
 * Read-only by design: this is the last look before sending, so nothing here
 * is editable. Corrections go back to the review pane or the compose window.
 */
export function PreviewModal({ open, initialTab = "email", onClose, from, to, subject, clientName, payMethodLabel, message, children }: {
  open: boolean
  initialTab?: Tab
  onClose: () => void
  from: string
  to: string
  subject: string
  clientName: string
  /** How this client pays · read-only here, it is set on their billing profile. */
  payMethodLabel?: string | null
  /** The covering note, shown above the invoice on the email tab. */
  message: string
  /** The invoice document, shared with the right-hand pane. */
  children: React.ReactNode
}) {
  const [tab, setTab] = useState<Tab>(initialTab)

  useEffect(() => { if (open) setTab(initialTab) }, [open, initialTab])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open || typeof document === "undefined") return null

  const tabStyle = (active: boolean) => active
    ? { background: "#fff", color: "#111827", fontWeight: 700, boxShadow: "0 1px 2px rgba(16,24,40,.08)" }
    : { background: "transparent", color: "#64748b", fontWeight: 600 }

  return createPortal(
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Invoice preview"
      className="fixed inset-0 z-[60] flex items-center justify-center p-[34px]"
      style={{ background: "rgba(15,23,42,.4)" }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="flex w-[600px] max-w-full flex-col overflow-hidden rounded-[14px] bg-white"
        // Fixed height: the two tabs hold different amounts of content, and a
        // dialog that resizes as you switch moves the tabs out from under the
        // cursor.
        style={{ height: "min(78vh, 760px)", boxShadow: "0 20px 60px rgba(15,23,42,.3)" }}
      >
        <div className="flex flex-none items-center gap-3 px-4 py-3" style={{ borderBottom: "1px solid #eef0f3" }}>
          <div className="flex gap-0.5 rounded-[9px] p-[3px]" style={{ background: "#f1f3f6" }}>
            <button type="button" onClick={() => setTab("email")}
              className="rounded-[7px] px-2.5 py-1.5 text-[12px]" style={tabStyle(tab === "email")}>
              Email to client
            </button>
            <button type="button" onClick={() => setTab("pdf")}
              className="rounded-[7px] px-2.5 py-1.5 text-[12px]" style={tabStyle(tab === "pdf")}>
              Invoice PDF
            </button>
          </div>
          {payMethodLabel && (
            <span
              className="ml-auto rounded-full px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.04em]"
              style={{ background: "#eaf0fa", color: "#3a66b0" }}
              title="Set in the client's billing profile, not from a preview"
            >
              {payMethodLabel}
            </span>
          )}
          <span className={`${payMethodLabel ? "" : "ml-auto"} text-[11.5px]`} style={{ color: "#98a2b3" }}>
            Preview only
          </span>
          <button type="button" onClick={onClose} aria-label="Close preview"
            className="flex h-7 w-7 flex-none items-center justify-center rounded-[7px] transition-colors hover:bg-stone-100"
            style={{ color: "#94a3b8" }}>
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto" style={{ background: "#fbfcfd" }}>
          {tab === "email" ? (
            <>
              <div className="bg-white px-[22px] py-[15px]" style={{ borderBottom: "1px solid #eef0f3" }}>
                <div className="flex items-center gap-[9px]">
                  <div className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full text-[12.5px] font-extrabold text-white"
                    style={{ background: "#182a44" }}>
                    CF
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-bold text-[#1f2937]">
                      The Clean Freaks <span className="font-medium text-[#98a2b3]">&lt;{from}&gt;</span>
                    </div>
                    <div className="truncate text-[11.5px] text-[#98a2b3]">to {to || clientName}</div>
                  </div>
                </div>
                <div className="mt-[11px] text-[14px] font-bold text-[#111827]">{subject}</div>
              </div>
              <div className="px-5 pb-[30px] pt-6">
                {message.trim() && (
                  <div className="mx-auto mb-3.5 whitespace-pre-wrap"
                    style={{ maxWidth: 456, fontSize: 13, lineHeight: 1.65, color: "#26303c" }}>
                    {message}
                  </div>
                )}
                {children}
              </div>
            </>
          ) : (
            // Scaled to fit so the whole document is visible at once, which is
            // the point of a preview.
            <div className="flex h-full items-start justify-center overflow-hidden px-5 py-4">
              <div style={{ transform: "scale(0.82)", transformOrigin: "top center", width: "100%" }}>
                {children}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** The message body the client will read, from whichever draft is live. */
export function previewMessage(candidateId: string, fallback: string): string {
  const shared = currentDraftMessage(candidateId)
  if (shared !== null) return shared
  return loadComposeDraft(candidateId)?.message || fallback
}
