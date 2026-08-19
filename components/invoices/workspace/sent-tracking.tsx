"use client"

import { useMemo, useState } from "react"
import useSWR, { useSWRConfig } from "swr"
import { Check, Phone, Send, X } from "lucide-react"
import { fetcher } from "@/lib/fetcher"
import { showSuccess, showError } from "@/lib/toast"
import { formatCurrency } from "@/lib/utils"
import {
  buildTimeline,
  daysLate,
  fillReminderTemplate,
  formatShortDate,
  primaryAction,
  reminderStage,
  type StepState,
  type TrackedInvoice,
} from "@/lib/invoice-tracking"

/**
 * Tracking view for an invoice that has already gone out: the Sent → Due → Paid
 * timeline, exactly one primary action for the current state, and the quiet row
 * of secondary links. Replaces the review UI once there is nothing left to
 * review.
 */

const DOT: Record<StepState, { bg: string; border: string; label: string; sub: string }> = {
  done: { bg: "#16a34a", border: "#16a34a", label: "#15803d", sub: "#8b95a1" },
  pending: { bg: "#ffffff", border: "#cbd5e1", label: "#374151", sub: "#8b95a1" },
  late: { bg: "#dc2626", border: "#dc2626", label: "#dc2626", sub: "#c0392b" },
  clearing: { bg: "#c98a1a", border: "#c98a1a", label: "#a8710e", sub: "#a8710e" },
}

interface Props {
  invoiceId: string
  invoice: TrackedInvoice & { invoiceNumber: string; totalAmount: number }
  /** Opens the compose window to correct and resend this invoice. */
  onEditResend?: () => void
}

export function SentTracking({ invoiceId, invoice, onEditResend }: Props) {
  const { mutate } = useSWRConfig()

  // Every action here changes what the ledger and the rail should show, so
  // refresh the lists as well as this invoice rather than only the local view.
  const refreshAll = () =>
    mutate(
      key =>
        typeof key === "string" &&
        (key.startsWith("/api/invoices/candidates") ||
          key.startsWith("/api/invoices/overdue") ||
          key.startsWith("/api/invoices/overview") ||
          key.startsWith(`/api/invoices/${invoiceId}`)),
    )

  const steps = useMemo(() => buildTimeline(invoice), [invoice])
  const action = useMemo(() => primaryAction(invoice), [invoice])
  const ladder = useMemo(() => reminderStage(invoice), [invoice])
  const late = daysLate(invoice)

  const { data: historyData, mutate: refetchHistory } = useSWR(
    `/api/invoices/${invoiceId}/reminder`,
    fetcher,
  )
  const history: Array<{ id: string; stage: number; channel: string; sentAt: string; daysLate: number }> =
    historyData?.reminders || []

  const [remindOpen, setRemindOpen] = useState(false)
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)

  if (!steps) return null

  const openRemind = () => {
    if (!ladder) return
    const due = invoice.dateDue ? formatShortDate(new Date(invoice.dateDue)) : "the due date"
    setDraft(
      fillReminderTemplate(ladder.body, {
        invoiceNumber: invoice.invoiceNumber,
        amount: formatCurrency(invoice.totalAmount),
        due,
        days: late,
      }),
    )
    setRemindOpen(true)
  }

  const post = async (url: string, body?: unknown) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || "Something went wrong.")
    return data
  }

  const sendReminder = async () => {
    if (!draft.trim()) return showError("Add a message before sending.")
    setBusy(true)
    try {
      const data = await post(`/api/invoices/${invoiceId}/reminder`, { body: draft })
      setRemindOpen(false)
      refetchHistory()
      await refreshAll()
      showSuccess(
        data.channel === "CALL"
          ? "Call logged."
          : data.warning === "SENDING_DISABLED"
            ? "Reminder recorded. Email is in test mode, so nothing went to the client."
            : data.threaded
              ? "Reminder sent in the original email thread."
              : "Reminder sent.",
      )
    } catch (e) {
      showError(e instanceof Error ? e.message : "Failed to send the reminder.")
    } finally {
      setBusy(false)
    }
  }

  const markPaid = async () => {
    setBusy(true)
    try {
      await post(`/api/invoices/${invoiceId}/mark-paid`, { paymentMethod: "MANUAL" })
      await refreshAll()
      showSuccess("Marked paid.")
    } catch (e) {
      showError(e instanceof Error ? e.message : "Failed to mark paid.")
    } finally {
      setBusy(false)
    }
  }

  const setClearing = async (on: boolean) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/clearing`, { method: on ? "POST" : "DELETE" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Something went wrong.")
      await refreshAll()
      showSuccess(on ? "Marked as clearing." : "No longer clearing.")
    } catch (e) {
      showError(e instanceof Error ? e.message : "Failed to update.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3">
      {/* Sent → Due → Paid */}
      <div className="flex items-start rounded-xl border border-[#eef0f3] bg-[#fafbfc] px-4 py-3">
        {steps.map((step, i) => {
          const c = DOT[step.state]
          return (
            <div key={step.key} className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex items-center">
                <span
                  className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full border-2 text-white"
                  style={{ background: c.bg, borderColor: c.border }}
                >
                  {step.state === "done" && <Check className="h-2.5 w-2.5" strokeWidth={3.4} />}
                </span>
                {i < steps.length - 1 && (
                  <span
                    className="mx-2 h-0.5 flex-1 rounded"
                    style={{ background: step.lineDone ? "#bfe3cb" : "#e2e5e9" }}
                  />
                )}
              </div>
              <div className="min-w-0">
                <div className="whitespace-nowrap text-[12.5px] font-bold tracking-tight" style={{ color: c.label }}>
                  {step.label}
                </div>
                <div className="mt-px whitespace-nowrap text-[11px] font-semibold" style={{ color: c.sub }}>
                  {step.sub}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Exactly one primary action for the current state. */}
      {action === "remind" && (
        <button
          type="button"
          onClick={openRemind}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-[10px] border border-[#f5c2c2] bg-[#fdecec] px-4 py-3 text-[14px] font-bold text-[#dc2626] transition-colors hover:bg-[#fce0e0] disabled:opacity-60"
        >
          <Send className="h-4 w-4" />
          Send reminder
        </button>
      )}
      {action === "call" && (
        <button
          type="button"
          onClick={openRemind}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-[10px] border border-[#f5c2c2] bg-[#fdecec] px-4 py-3 text-[14px] font-bold text-[#dc2626] transition-colors hover:bg-[#fce0e0] disabled:opacity-60"
        >
          <Phone className="h-4 w-4" />
          Call them · log what they say
        </button>
      )}
      {(action === "mark-paid" || action === "confirm-deposit") && (
        <button
          type="button"
          onClick={markPaid}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-[10px] bg-[#16a34a] px-4 py-3.5 text-[14px] font-bold text-white shadow-[0_2px_6px_rgba(22,163,74,.24)] transition-transform hover:brightness-105 active:translate-y-px disabled:opacity-60"
        >
          <Check className="h-4 w-4" strokeWidth={2.4} />
          {action === "confirm-deposit" ? "Confirm the deposit landed" : "Payment landed · mark paid"}
        </button>
      )}

      {/* Quiet secondary row. */}
      {invoice.status !== "PAID" && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] font-semibold text-stone-400">
          {invoice.clearingSince ? (
            <button type="button" onClick={() => setClearing(false)} disabled={busy} className="transition-colors hover:text-stone-700">
              Not actually clearing
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setClearing(true)}
              disabled={busy}
              title="Payment is on its way. ACH and checks take about 5 to 7 days to land."
              className="transition-colors hover:text-stone-700"
            >
              Mark clearing
            </button>
          )}
          {onEditResend && (
            <>
              <span className="text-stone-200">·</span>
              <button type="button" onClick={onEditResend} className="transition-colors hover:text-stone-700">
                Edit &amp; resend
              </button>
            </>
          )}
          <span className="text-stone-200">·</span>
          <a href={`/invoices/${invoiceId}`} className="transition-colors hover:text-stone-700">View invoice</a>
          {late > 0 && ladder && (
            <>
              <span className="text-stone-200">·</span>
              <span className="font-semibold text-stone-500">{ladder.label}</span>
            </>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div className="rounded-lg border border-stone-200 bg-white px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">Reminders sent</div>
          <ul className="mt-1.5 space-y-1">
            {history.map(h => (
              <li key={h.id} className="flex items-center justify-between gap-3 text-[11.5px]">
                <span className="text-stone-600">
                  {h.channel === "CALL" ? "Phone call" : `Reminder #${h.stage}`} · {h.daysLate} days late
                </span>
                <span className="tabular-nums text-stone-400">
                  {new Date(h.sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {remindOpen && ladder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setRemindOpen(false)}>
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 border-b border-stone-100 px-5 py-4">
              <div>
                <div className="text-[15px] font-semibold text-stone-900">{ladder.title}</div>
                <div className="mt-0.5 text-[12px] text-stone-500">
                  {late} days past due · invoice #{invoice.invoiceNumber}
                </div>
              </div>
              <button type="button" onClick={() => setRemindOpen(false)} className="text-stone-400 transition-colors hover:text-stone-700">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-5 py-4">
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                rows={7}
                className="w-full rounded-lg border border-stone-200 px-3 py-2.5 text-[12.5px] leading-relaxed text-stone-800 outline-none focus:border-stone-400"
              />
              <p className="mt-2 text-[11px] text-stone-400">
                {ladder.isCall
                  ? "Nothing is emailed · this is a human call."
                  : "Sends as a reply in the original invoice email thread · nothing goes out until you send it."}
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-stone-100 px-5 py-3">
              <button type="button" onClick={() => setRemindOpen(false)} className="rounded-lg px-3 py-2 text-[12.5px] font-semibold text-stone-500 transition-colors hover:text-stone-800">
                Cancel
              </button>
              <button
                type="button"
                onClick={sendReminder}
                disabled={busy}
                className="rounded-lg bg-[#0f5a36] px-4 py-2 text-[12.5px] font-bold text-white transition-colors hover:brightness-110 disabled:opacity-60"
              >
                {ladder.isCall ? "Log a call" : "Send reminder"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
