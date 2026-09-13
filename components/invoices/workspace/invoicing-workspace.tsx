"use client"

import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import useSWR from "swr"
import { Plus, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Search, CheckCircle2, AlertTriangle, ExternalLink, FileText, Loader2, Settings, Send, CalendarDays, Building2, MapPin, Lock, Check, PanelLeftClose, Eye } from "lucide-react"
import { fetcher } from "@/lib/fetcher"
import { formatCurrency } from "@/lib/utils"
import { showSuccess, showError } from "@/lib/toast"
import { ScheduleCheck, type ScheduleCheckClean } from "./schedule-check"
import { NewInvoicePanel } from "../new-invoice-panel"
import { billableCleanCount, countCleans } from "@/lib/schedule-check"
import { DEFAULT_CLIENT_PAY_METHOD, type InvoiceFooterTemplates } from "@/lib/billing-sections"
import { buildPaymentBlock } from "@/lib/invoice-payment-block"
import { buildInvoiceDocument } from "@/lib/invoice-document"
import { TemplatesModal } from "./templates-modal"
import {
  useWorkspace, formatMonthLabel, shiftMonth, shortReason,
  type WorkspaceInvoice, type WorkspaceTab,
} from "./use-workspace"
import { ComposeWindow } from "./compose-window"
import { AdjustmentsPanel } from "./adjustments-panel"
import { InvoiceFooterAndNote } from "./invoice-footer-note"
import { ScrollWithMoreBelow } from "./scroll-more"
import { PreviewModal, previewMessage } from "./preview-modal"
import { loadComposeDraft } from "./use-draft-message"
import { SentTracking } from "./sent-tracking"
import { runBatchSend, ensureInvoiceId } from "./invoice-send"
import { type Adjustment } from "@/lib/invoice-adjustments"
import { confirmBlockedReason, confirmationText, needsConfirmation } from "@/lib/invoice-confirmation"
import { buildPayoutSummary, shouldShowPayout } from "@/lib/invoice-payout"
import { TERMS, TERM_LABELS } from "@/lib/billing-schedule"
import { longestQueueGroupPhrase } from "@/lib/review-queue"
import { CUSTOM_TERM, resolveDueDate, selectedTerm } from "@/lib/payment-terms"
import type { ComposeMode } from "@/lib/invoice-compose"
import Link from "next/link"
import { PAY_METHOD_LABELS } from "@/lib/billing-schedule"

const TABS: WorkspaceTab[] = ["All", "Not sent", "Sent", "Overdue", "Paid"]
const STATUS_DOT: Record<string, string> = { "Not sent": "#F59E0B", Sent: "#0EA5E9", Paid: "#10B981" }

export function InvoicingWorkspace({
  initialMonth,
  focusInvoiceId,
  onFocusUnavailable,
}: {
  initialMonth?: string
  focusInvoiceId?: string
  /** Called when the focused invoice has no row in this month's workspace. */
  onFocusUnavailable?: () => void
} = {}) {
  const ws = useWorkspace({ initialMonth, focusInvoiceId })

  // Never silently show a different invoice than the one that was opened.
  useEffect(() => {
    if (ws.focusMissing) onFocusUnavailable?.()
  }, [ws.focusMissing, onFocusUnavailable])
  const [confirmSend, setConfirmSend] = useState<{ targets: WorkspaceInvoice[]; isAll: boolean } | null>(null)
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null)
  const [mounted, setMounted] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  // Which invoice the compose window is open for, and why it was opened.
  const [composeFor, setComposeFor] = useState<{ inv: WorkspaceInvoice; mode: ComposeMode } | null>(null)
  const [detailWidth, setDetailWidth] = useState(340)
  const [listWidth, setListWidth] = useState(330)
  // The design opens an invoice in TWO panes — the review and what the client
  // receives — and only reveals the list when you ask for it via the
  // "N to send in the queue" pill. The list is a way back to the queue, not
  // something that competes with the invoice you are reviewing.
  const [listCollapsed, setListCollapsed] = useState(true)
  const [newInvoiceOpen, setNewInvoiceOpen] = useState(false)
  useEffect(() => setMounted(true), [])

  // Keyboard queue navigation. Ignored while typing in a field or with a modal
  // open, so it never fights with normal editing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return
      const el = e.target as HTMLElement | null
      const tag = el?.tagName?.toLowerCase()
      if (tag === "input" || tag === "textarea" || tag === "select" || el?.isContentEditable) return
      if (confirmSend || templatesOpen) return
      e.preventDefault()
      ws.stepReview(e.key === "ArrowDown" ? 1 : -1)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [ws, confirmSend, templatesOpen])

  // Restore saved column widths — list width persists across sessions (Ticket 1).
  useEffect(() => {
    try {
      const l = Number(localStorage.getItem("cf-inv-listW")); if (l >= 240 && l <= 480) setListWidth(l)
      const d = Number(localStorage.getItem("cf-inv-detailW")); if (d >= 280 && d <= 560) setDetailWidth(d)
    } catch { /* localStorage unavailable */ }
  }, [])

  // Drag-to-resize the left invoice list (Ticket 1 — clamp 240–480, persisted).
  const startListResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = listWidth
    let finalW = startW
    const onMove = (ev: MouseEvent) => { finalW = Math.min(480, Math.max(240, startW + (ev.clientX - startX))); setListWidth(finalW) }
    const onUp = () => {
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      try { localStorage.setItem("cf-inv-listW", String(finalW)) } catch { /* noop */ }
    }
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }

  // Drag-to-resize the detail column (interior handle → delta from drag start).
  const startDetailResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = detailWidth
    let finalW = startW
    const onMove = (ev: MouseEvent) => { finalW = Math.min(560, Math.max(280, startW + (ev.clientX - startX))); setDetailWidth(finalW) }
    const onUp = () => {
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      try { localStorage.setItem("cf-inv-detailW", String(finalW)) } catch { /* noop */ }
    }
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }

  const runBatch = async (targets: WorkspaceInvoice[]) => {
    if (targets.length === 0) return
    setBatch({ done: 0, total: targets.length })
    try {
      const result = await runBatchSend(targets, ws.month, (done, total) => setBatch({ done, total }))
      const parts = [`${result.sent} sent`]
      if (result.skipped) parts.push(`${result.skipped} skipped (no email)`)
      if (result.needsReview) parts.push(`${result.needsReview} need review (don't match schedule)`)
      if (result.failed) parts.push(`${result.failed} failed`)
      if (result.sent > 0) showSuccess(parts.join(" · "))
      else showError(parts.join(" · "))
    } catch {
      showError("Batch send failed")
    } finally {
      setBatch(null)
      ws.clearChecked()
      ws.mutate()
    }
  }
  const confirmAndSend = () => { if (!confirmSend) return; const t = confirmSend.targets; setConfirmSend(null); runBatch(t) }

  const verifiedTotal = ws.verifiedReady.reduce((s, i) => s + i.total, 0)
  const checkedTotal = ws.checkedList.reduce((s, i) => s + i.total, 0)
  const overdueCount = ws.invoices.filter(i => !!i.overdueDays && i.overdueDays > 0).length
  const toSendCount = ws.invoices.filter(i => i.uiStatus === "Not sent").length
  const attentionCount = ws.verifiedReady.length > 0
    ? ws.invoices.filter((i) => i.uiStatus === "Not sent" && i.verification.level === "yellow").length
    : 0

  return (
    <div className="flex flex-col bg-stone-50" style={{ height: "100dvh" }}>
      {/* ── Top bar: title · new invoice ──
          The status totals moved to the All invoices list, and the reviewer
          control moved down to sit above the card it applies to. A review
          screen's header should say where you are, not summarise the ledger. */}
      <header className="flex items-center justify-between gap-6 border-b border-stone-200 bg-white px-6 py-3">
        <div className="min-w-0">
          {/* The way back to the full list. The workspace shows one invoice at
              a time, so without this the only route out is the browser. */}
          <Link
            href="/invoices"
            className="mb-0.5 inline-flex items-center gap-[5px] text-[12.5px] font-bold text-[#6b7480] transition-colors hover:text-stone-800"
          >
            <ChevronLeft size={15} strokeWidth={2.2} /> All invoices
          </Link>
          <h1 className="text-[23px] font-bold leading-[1.1] tracking-[-0.025em] text-stone-900">Invoices</h1>
        </div>

        <button
          type="button"
          onClick={() => setNewInvoiceOpen(true)}
          title="For charges that don't come from a scheduled clean · fees, supplies, or work done off-calendar."
          className="inline-flex flex-none items-center gap-1.5 rounded-[9px] border border-[#e4e7ec] bg-white px-3.5 py-[9px] text-[12.5px] font-bold text-[#475467] transition-colors hover:bg-[#f7f8fa]"
        >
          <Plus className="h-[15px] w-[15px]" /> New Invoice
        </button>
      </header>

      {/* ── Filter bar: tabs + search ──
          Only while the list is open. In review mode these are the controls of
          the invoice INDEX, and sitting them between the review queue and the
          client being reviewed made a focused screen read like a list page. */}
      {!listCollapsed && (
      <div className="flex items-center gap-3 border-b border-stone-200 bg-white px-6 py-2.5">
        <div className="flex items-center gap-0.5 rounded-md bg-stone-100 p-0.5">
          {TABS.map((t) => (
            <button key={t} onClick={() => ws.setTab(t)}
              className={`inline-flex items-center gap-1 rounded px-3 py-1 text-xs font-medium transition-colors ${ws.tab === t ? "bg-white text-stone-900 shadow-sm" : "text-stone-600 hover:text-stone-800"}`}>
              {t}
              {t === "Overdue" && ws.overdueCount > 0 && (
                <span className="rounded-full bg-rose-100 px-1.5 text-[10px] font-bold text-rose-700">{ws.overdueCount}</span>
              )}
            </button>
          ))}
        </div>
        <div className="relative max-w-md flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
          <input value={ws.search} onChange={(e) => ws.setSearch(e.target.value)} placeholder="Search clients"
            className="w-full rounded-md border border-stone-200 bg-stone-50 py-1.5 pl-8 pr-3 text-sm outline-none transition-colors focus:border-stone-400 focus:bg-white" />
        </div>
        <button onClick={() => setTemplatesOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-stone-200 px-2.5 py-1.5 text-[12px] font-medium text-stone-600 transition-colors hover:bg-stone-50">
          <Settings size={13} /> Template
        </button>
      </div>
      )}

      {/* ── The panes ──
          In review mode this is two equal halves on a common ground with a
          real gutter between them, rather than columns divided by a rule. */}
      <div
        className={
          listCollapsed
            ? "flex min-h-0 flex-1 gap-4 bg-[#f6f6f3] p-4"
            : "flex min-h-0 flex-1"
        }
      >
        {/* Left: invoice list */}
        {!listCollapsed && (
        <div className="flex shrink-0 flex-col border-r border-stone-200 bg-white" style={{ width: listWidth }}>
          {/* Month nav lives with the list it filters, per the design. */}
          <div className="flex items-center gap-1 border-b border-stone-100 px-2 py-2">
            <button onClick={() => ws.setMonth(shiftMonth(ws.month, -1))} className="rounded p-1 text-stone-500 transition-colors hover:bg-stone-100" aria-label="Previous month"><ChevronLeft size={15} /></button>
            <span className="flex-1 text-center text-[13px] font-semibold tabular-nums text-stone-700">{formatMonthLabel(ws.month)}</span>
            <button onClick={() => ws.setMonth(shiftMonth(ws.month, 1))} className="rounded p-1 text-stone-500 transition-colors hover:bg-stone-100" aria-label="Next month"><ChevronRight size={15} /></button>
            <button
              onClick={() => setListCollapsed(true)}
              aria-label="Hide the invoice list"
              title="Hide the list · back to the two-pane review"
              className="rounded p-1 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
            >
              <PanelLeftClose size={15} />
            </button>
          </div>

          {(
            <div className="flex items-center gap-2 border-b border-stone-100 px-3 py-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-stone-400">Clients</span>
              {overdueCount > 0 && (
                <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold" style={{ background: "#fdecec", color: "#c0342a" }}>
                  {overdueCount} overdue
                </span>
              )}
              {toSendCount > 0 && (
                <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold" style={{ background: "#fdf6ea", color: "#8a5e12" }}>
                  {toSendCount} to send
                </span>
              )}
            </div>
          )}

          {!listCollapsed && ws.verifiedReady.length > 0 && (
            <div className="border-b border-stone-100 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[12px] text-stone-600">
                  <span className="font-semibold text-stone-800">{ws.verifiedReady.length} verified</span> · {formatCurrency(verifiedTotal)}
                </div>
                <button onClick={() => setConfirmSend({ targets: ws.verifiedReady, isAll: true })} disabled={!!batch}
                  className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-50 disabled:opacity-60">
                  <Send size={12} /> Send all
                </button>
              </div>
              {attentionCount > 0 && (
                <div className="mt-1.5 flex items-center gap-1 text-[11px] text-amber-600">
                  <AlertTriangle size={11} /> {attentionCount} invoice{attentionCount === 1 ? "" : "s"} need attention first
                </div>
              )}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {ws.isLoading ? (
              <div className="p-6 text-center text-sm text-stone-400">Loading…</div>
            ) : ws.groups.length === 0 ? (
              <div className="p-6 text-center text-sm text-stone-400">No invoices for {formatMonthLabel(ws.month)}.</div>
            ) : (
              ws.groups.map((g) => {
                const allChecked = g.notSentIds.length > 0 && g.notSentIds.every((id) => ws.checked.has(id))
                return (
                  <div key={g.label} className="px-2 pb-2">
                    <div className="flex items-center gap-2 px-2 py-1.5">
                      {g.notSentIds.length > 0 && (
                        <button onClick={() => ws.toggleCheckMany(g.notSentIds)} aria-label={`Select all ${g.label}`}><Box checked={allChecked} /></button>
                      )}
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">{g.label}</span>
                      <span className="text-[10px] text-stone-400">{g.items.length}</span>
                      {g.yellowCount > 0 && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1 py-0.5 text-[9px] font-semibold text-amber-600"><AlertTriangle size={8} />{g.yellowCount}</span>
                      )}
                      <span className="ml-auto font-mono text-[10px] text-stone-400">{formatCurrency(g.total)}</span>
                    </div>
                    {g.items.map((inv) => (
                      <ListItem key={inv.candidateId} inv={inv} month={ws.month}
                        selected={ws.selected?.candidateId === inv.candidateId}
                        checked={ws.checked.has(inv.candidateId)}
                        onSelect={() => ws.setSelectedId(inv.candidateId)}
                        onCheck={() => ws.toggleCheck(inv.candidateId)} />
                    ))}
                  </div>
                )
              })
            )}
          </div>

          {ws.checkedList.length > 0 && (
            <div className="border-t border-stone-200 bg-white p-2.5">
              <button onClick={() => setConfirmSend({ targets: ws.checkedList, isAll: false })} disabled={!!batch}
                className="flex w-full items-center justify-center gap-1.5 rounded-md py-2 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                style={{ background: "#0D9488" }}>
                <Send size={13} /> Send {ws.checkedList.length} selected · {formatCurrency(checkedTotal)}
              </button>
            </div>
          )}
        </div>

        )}

        {/* Resize handle (list ↔ detail) — Ticket 1 */}
        {!listCollapsed && (
        <div onMouseDown={startListResize} onDoubleClick={() => { setListWidth(330); try { localStorage.setItem("cf-inv-listW", "330") } catch { /* noop */ } }}
          className="w-1.5 shrink-0 cursor-col-resize bg-stone-200 transition-colors hover:bg-teal-400"
          title="Drag to resize · Double-click to reset" />
        )}

        {/* Review column: the queue control sits directly above the card it
            applies to, aligned to it, rather than up in the page header where
            it read as a property of the whole screen. */}
        <div
          className={
            listCollapsed
              ? "flex min-w-0 flex-1 basis-0 flex-col gap-2.5"
              : "flex shrink-0 flex-col"
          }
          style={listCollapsed ? undefined : { width: detailWidth }}
        >
        {listCollapsed && ws.queuePositionLabel && (
          <div
            className="relative flex flex-none items-center gap-2.5 self-start overflow-hidden rounded-full border border-[#e7e7e2] bg-white px-3.5 py-1.5"
            style={{ boxShadow: "0 1px 2px rgba(16,24,40,.05)" }}
          >
            {/* Clicking the count opens the full list. The design drops the
                separate "N to send in the queue" pill, and this is the only
                remaining way back to the list from a two-pane review. */}
            <button
              type="button"
              onClick={() => setListCollapsed(false)}
              title="See the full list"
              className="flex-none whitespace-nowrap text-[12.5px] font-bold text-stone-800"
            >
              Reviewing{" "}
              <span className="inline-block w-[2ch] text-right tabular-nums">{ws.queuePos > 0 ? ws.queuePos : "-"}</span>
              {" of "}
              <span className="inline-block w-[2ch] text-right tabular-nums">{ws.queueTotal}</span>
              {" to send"}
            </button>
            {ws.queueGroup && (
              <>
                <span className="flex-none text-[#d2d8de]">·</span>
                {/* A fixed slot the width of the longest phrase. Without it the
                    pill resized as you stepped between a flat-rate and a
                    per-clean invoice, and the arrows moved under the cursor. */}
                <span className="relative flex-none whitespace-nowrap text-[12px] font-semibold text-[#15793f]">
                  <span className="invisible" aria-hidden="true">{longestQueueGroupPhrase()}</span>
                  <span className="absolute inset-y-0 left-0">{ws.queueGroup}</span>
                </span>
              </>
            )}
            <div className="flex flex-none items-center gap-1">
              <button
                onClick={() => ws.stepReview(-1)}
                aria-label="Previous invoice to review"
                title="Previous (Up arrow)"
                className="grid h-[22px] w-[22px] place-items-center rounded-full border border-[#e2e2df] text-stone-500 transition-colors hover:bg-stone-50 hover:text-stone-900"
              >
                <ChevronUp size={13} strokeWidth={2.4} />
              </button>
              <button
                onClick={() => ws.stepReview(1)}
                aria-label="Next invoice to review"
                title="Next (Down arrow)"
                className="grid h-[22px] w-[22px] place-items-center rounded-full text-white transition-opacity hover:opacity-90"
                style={{ background: "#15793f" }}
              >
                <ChevronDown size={13} strokeWidth={2.4} />
              </button>
            </div>
            {/* Progress along the bottom edge of the pill, as the design has it. */}
            <span
              className="absolute bottom-0 left-0 h-[2px] rounded-full transition-all"
              style={{ width: `${ws.queueProgress}%`, background: "#15793f" }}
            />
          </div>
        )}

        <div
          className={
            listCollapsed
              ? "flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white"
              : "flex h-full flex-col border-r border-stone-200 bg-white"
          }
          style={
            listCollapsed
              ? { boxShadow: "0 1px 3px rgba(16,24,40,.05), 0 12px 32px rgba(16,24,40,.07)" }
              : undefined
          }
        >
          {ws.selected ? (
            <DetailPanel
              inv={ws.selected}
              month={ws.month}
              onCompose={mode => setComposeFor({ inv: ws.selected!, mode })}
            />
          ) : (
            <div className="m-auto p-6 text-center text-sm text-stone-400">Select an invoice.</div>
          )}
        </div>
        </div>

        {/* Resize handle (detail ↔ preview) */}
        {!listCollapsed && (
          <div onMouseDown={startDetailResize} onDoubleClick={() => setDetailWidth(340)}
            className="w-1.5 shrink-0 cursor-col-resize bg-stone-200 transition-colors hover:bg-teal-400"
            title="Drag to resize · Double-click to reset" />
        )}

        {/* PDF preview · a distinct container beside the review card, sharing
            the width with it rather than taking the larger half. */}
        <div
          className={
            listCollapsed
              ? "flex min-w-0 flex-1 basis-0 flex-col overflow-hidden rounded-2xl bg-[#f0efea]"
              : "flex min-w-0 flex-1 flex-col bg-stone-100"
          }
        >
          {ws.selected ? <InvoicePreview inv={ws.selected} month={ws.month} /> : (
            <div className="m-auto text-sm text-stone-400">Select an invoice to preview.</div>
          )}
        </div>

      </div>

      {/* Off-calendar charges: fees, supplies, work with no scheduled clean. */}
      <NewInvoicePanel
        open={newInvoiceOpen}
        onClose={() => setNewInvoiceOpen(false)}
        onCreated={() => { setNewInvoiceOpen(false); ws.mutate() }}
      />

      {/* Compose window · every send path goes through it, so nothing leaves
          without the reviewer seeing the actual email. */}
      {composeFor && (
        <ComposeWindow
          key={`${composeFor.inv.candidateId}:${composeFor.mode}`}
          inv={composeFor.inv}
          month={ws.month}
          mode={composeFor.mode}
          onClose={() => setComposeFor(null)}
          onSent={() => {
            // Move to the next invoice still waiting, so the queue keeps its
            // momentum, then refresh what the ledger shows.
            const next = ws.invoices.find(
              i => i.uiStatus === "Not sent" && i.candidateId !== composeFor.inv.candidateId,
            )
            if (next) ws.setSelectedId(next.candidateId)
            ws.mutate()
          }}
        />
      )}

      {/* Bulk-send confirmation (portaled to escape the transformed page wrapper) */}
      {mounted && confirmSend && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4" onClick={() => setConfirmSend(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl">
            <h3 className="text-[15px] font-semibold text-stone-900">{confirmSend.isAll ? "Send all verified invoices?" : "Send selected invoices?"}</h3>
            <p className="mt-1 text-[13px] text-stone-600">
              {confirmSend.targets.length} invoice{confirmSend.targets.length === 1 ? "" : "s"} totaling{" "}
              <span className="font-semibold">{formatCurrency(confirmSend.targets.reduce((s, i) => s + i.total, 0))}</span> will be emailed to each client.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setConfirmSend(null)} className="rounded-md px-3 py-2 text-[13px] font-semibold text-stone-500 hover:text-stone-700">Cancel</button>
              <button onClick={confirmAndSend} className="rounded-md px-4 py-2 text-[13px] font-semibold text-white" style={{ background: "#059669" }}>
                Send {confirmSend.targets.length}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Batch progress */}
      {mounted && batch && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-xs rounded-xl bg-white p-5 text-center shadow-2xl">
            <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-emerald-600" />
            <p className="text-[14px] font-semibold text-stone-900">Sending {Math.min(batch.done + 1, batch.total)} of {batch.total}…</p>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-stone-100">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${batch.total ? (batch.done / batch.total) * 100 : 0}%` }} />
            </div>
          </div>
        </div>,
        document.body,
      )}

      <TemplatesModal
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        sample={ws.selected ? { client: ws.selected.clientName, total: ws.selected.total, month: ws.month } : null}
      />
    </div>
  )
}

function Box({ checked }: { checked: boolean }) {
  return (
    <span className="flex h-3.5 w-3.5 items-center justify-center rounded border" style={checked ? { background: "#0D9488", borderColor: "#0D9488" } : { borderColor: "#D6D3D1" }}>
      {checked && <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><path d="M2.5 6L5 8.5 9.5 3.5" /></svg>}
    </span>
  )
}

/** Row status pill, matching the ledger's vocabulary. */
const ROW_PILL: Record<string, { bg: string; color: string; label: string }> = {
  "Not sent": { bg: "#fdf6ea", color: "#8a5e12", label: "To send" },
  Sent: { bg: "#eff6ff", color: "#1d4ed8", label: "Sent" },
  Paid: { bg: "#ecfdf5", color: "#047857", label: "Paid" },
}

function ListItem({ inv, month, selected, checked, onSelect, onCheck }: {
  inv: WorkspaceInvoice
  month: string
  selected: boolean
  checked: boolean
  onSelect: () => void
  onCheck: () => void
}) {
  const reason = shortReason(inv)
  const notSent = inv.uiStatus === "Not sent"
  const overdue = !!inv.overdueDays && inv.overdueDays > 0
  const pill = overdue
    ? { bg: "#fdecec", color: "#c0342a", label: `${inv.overdueDays}d overdue` }
    : ROW_PILL[inv.uiStatus] ?? ROW_PILL["Not sent"]

  // Same due date the detail pane shows, so the two never disagree.
  const [y, m] = month.split("-").map(Number)
  const dueLabel = new Date(y, m - 1, 10).toLocaleDateString("en-US", { month: "short", day: "numeric" })

  return (
    <div className={`mb-0.5 flex items-center gap-2 rounded-md px-2 py-2 transition-colors ${selected ? "bg-stone-100 ring-1 ring-stone-300" : "hover:bg-stone-50"}`}>
      {notSent && (
        <button onClick={onCheck} className="flex-shrink-0" aria-label="Select invoice for bulk send"><Box checked={checked} /></button>
      )}
      <button onClick={onSelect} className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-stone-900">{inv.clientName}</span>
          <span
            className="flex-none rounded-full px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.04em]"
            style={{ background: pill.bg, color: pill.color }}
          >
            {pill.label}
          </span>
        </div>
        <div className="mt-0.5 flex items-baseline justify-between gap-2">
          <span className="truncate text-[11px] text-stone-400">Due {dueLabel}</span>
          <span className="flex-none font-mono text-[12px] font-semibold text-stone-700">{formatCurrency(inv.total)}</span>
        </div>
        {/* What still needs a decision on this one, e.g. an add-on to confirm. */}
        {!overdue && reason && (
          <div className="mt-px flex items-center gap-1 truncate text-[11px] text-amber-600">
            <span className="h-1 w-1 flex-none rounded-full bg-amber-500" />
            {reason}
          </div>
        )}
      </button>
    </div>
  )
}

function DetailPanel({ inv, month, onCompose }: {
  inv: WorkspaceInvoice
  month: string
  onCompose: (mode: ComposeMode) => void
}) {
  const { data: client, mutate: mutateClient } = useSWR(`/api/clients/${inv.clientId}`, fetcher)

  // Same SWR key as AdjustmentsPanel, so this shares one request and the CTA
  // unlocks the moment the last adjustment is approved.
  const { data: adjData } = useSWR<{ adjustments: Adjustment[] }>(
    `/api/invoices/adjustments?candidateId=${encodeURIComponent(inv.candidateId)}&period=${month}`,
    fetcher,
  )
  const adjustments = adjData?.adjustments ?? []
  // Josh chose the blocking confirmation (2026-08-25): an invoice carrying
  // changes cannot be sent until the reviewer signs off on the set.
  const [confirmed, setConfirmed] = useState(false)
  const blockedReason = confirmBlockedReason(adjustments, confirmed)
  // A new invoice is a new decision — never inherit the last one's tick.
  useEffect(() => { setConfirmed(false) }, [inv.candidateId])
  const [previewOpen, setPreviewOpen] = useState(false)
  const { data: emailSettings } = useSWR(previewOpen ? "/api/settings/email" : null, fetcher)
  const [savingDraft, setSavingDraft] = useState(false)
  const [savingTerms, setSavingTerms] = useState(false)

  // Terms live on the client, so this is the same write the billing schedule
  // sheet makes — one source of truth for how long they have to pay.
  const setTerms = async (terms: string) => {
    setSavingTerms(true)
    try {
      const res = await fetch("/api/settings/billing-schedule", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: inv.clientId, terms }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        showError(err?.error || "Could not change the payment terms")
        return
      }
      showSuccess(`Payment terms set to ${TERM_LABELS[terms] ?? terms}`)
      mutateClient()
    } catch {
      showError("Could not change the payment terms")
    } finally {
      setSavingTerms(false)
    }
  }

  // Creates the invoice record without emailing anything.
  const saveDraft = async () => {
    setSavingDraft(true)
    try {
      const id = await ensureInvoiceId(inv, month)
      if (id) showSuccess("Draft saved")
    } catch {
      showError("Failed to save draft")
    } finally {
      setSavingDraft(false)
    }
  }

  // Once an invoice exists the tracking states (sent / due / paid / clearing)
  // live on the row itself, not on the computed candidate.
  const { data: sentInvoice } = useSWR(
    inv.existingInvoiceId ? `/api/invoices/${inv.existingInvoiceId}` : null,
    fetcher,
  )
  const tracked = sentInvoice && (sentInvoice.status === "SENT" || sentInvoice.status === "PAID")
    ? sentInvoice
    : null

  // The cleans for the month being reviewed. Deliberately not taken from the
  // client profile: that route returns a rolling window around today, so a
  // month reviewed late silently came back empty.
  const { data: cleansData, mutate: refreshCleans } = useSWR<{ cleans: ScheduleCheckClean[] }>(
    `/api/clients/${inv.clientId}/cleans?month=${month}`,
    fetcher,
  )
  const cleans = useMemo(() => cleansData?.cleans ?? [], [cleansData])


  const dueDate = useMemo(() => {
    // Prefer the real due date once one exists; the month-based guess is only
    // for candidates that have not been invoiced yet.
    const short: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }
    const real = tracked?.dateDue ? new Date(tracked.dateDue) : null
    if (real && !isNaN(real.getTime())) return real.toLocaleDateString("en-US", short)
    const [y, m] = month.split("-").map(Number)
    // Derived from the client's terms · it used to be a fixed 10th of the
    // month, which matched none of the Net 7 / 15 / 30 options beside it.
    return resolveDueDate(client?.paymentTerms, new Date(y, m - 1, 1), new Date(y, m - 1, 10))
      .toLocaleDateString("en-US", short)
    // Terms included: changing them has to move the date shown beside them.
  }, [month, tracked, client?.paymentTerms])

  // Structured "what changed this month" rows — with the $ impact pulled from the
  // real line items (proration credit for cancellations, add-on totals).
  const changeRows = useMemo(() => {
    const exceptions = Array.isArray(inv.exceptions) ? inv.exceptions : []
    const lineItems = Array.isArray(inv.lineItems) ? inv.lineItems : []
    const counts: Record<string, number> = {}
    for (const e of exceptions) counts[e.type] = (counts[e.type] || 0) + 1
    const priceEx = exceptions.find((e) => e.type === "PRICE_CHANGE")
    const credit = lineItems
      .filter((li) => li.sourceType === "PRORATION")
      .reduce((s, li) => s + Math.abs(li.price * li.quantity), 0)
    const addOnTotal = lineItems
      .filter((li) => li.sourceType === "ADD_ON" || li.sourceType === "RECURRING_ADD_ON")
      .reduce((s, li) => s + li.price * li.quantity, 0)
    const rows: Array<{ label: string; value: string; flag: boolean }> = [
      { label: "Cancellations", value: counts.SKIPPED ? `${counts.SKIPPED} this month${credit ? ` · -${formatCurrency(credit)}` : ""}` : "None", flag: !!counts.SKIPPED },
      { label: "Rate vs last month", value: priceEx ? priceEx.message : "No change", flag: !!priceEx },
    ]
    if (counts.ONE_TIME_ADD_ON) rows.push({ label: "Add-ons", value: `${counts.ONE_TIME_ADD_ON} this month${addOnTotal ? ` · +${formatCurrency(addOnTotal)}` : ""}`, flag: true })
    // One-off jobs: list each clean's date + amount (a one-off job line item is a
    // JOB with no scheduleId — recurring per-clean items always carry one).
    const oneOffItems = lineItems.filter((li) => li.sourceType === "JOB" && !li.scheduleId)
    if (oneOffItems.length > 0) {
      const detail = oneOffItems
        .map((li) => {
          const datePart = li.description.split("—").pop()?.trim()
          return `${datePart ? `${datePart} · ` : ""}${formatCurrency(li.price * li.quantity)}`
        })
        .join(", ")
      rows.push({ label: oneOffItems.length === 1 ? "One-off job" : `One-off jobs (${oneOffItems.length})`, value: detail, flag: true })
    }
    if (counts.RESCHEDULED) rows.push({ label: "Rescheduled", value: `${counts.RESCHEDULED} clean${counts.RESCHEDULED > 1 ? "s" : ""}`, flag: true })
    if (counts.MISSING_EMAIL) rows.push({ label: "Email on file", value: "Missing — add before sending", flag: true })
    return rows
  }, [inv.exceptions, inv.lineItems])

  // Only the rows that represent an actual change this month (the "Changes" card +
  // the headline count are driven off these).
  const flaggedRows = changeRows.filter((r) => r.flag)
  // Already scoped to this month by the request, so this is just the count.
  const monthCleans = cleans
  // "Single location" / "3 locations" — the design puts this next to the name
  // so a combined invoice is obvious before you read the line items.
  const locationNames = useMemo(
    () => ((client?.locations || []) as Array<{ name?: string }>)
      .map(l => (l.name || "").trim())
      .filter(Boolean),
    [client?.locations],
  )
  const locationCount = (client?.locations || []).length
  const locationLabel = locationCount > 1 ? `${locationCount} locations` : "Single location"

  // What the cleaner is owed for this month's work, and how the sent invoice
  // went out — both only meaningful once it has been sent.
  const payout = useMemo(
    () => buildPayoutSummary({
      cleans,
      invoiceStatus: tracked?.status,
      overdue: !!inv.overdueDays && inv.overdueDays > 0,
    }),
    [cleans, tracked, inv.overdueDays],
  )
  const showPayout = shouldShowPayout(payout)

  const sentWhenLabel = useMemo(() => {
    const sent = tracked?.dateSent ? new Date(tracked.dateSent) : null
    if (!sent || isNaN(sent.getTime())) return "Not sent yet"
    const days = Math.floor((Date.now() - sent.getTime()) / 86_400_000)
    if (days <= 0) return "Sent today"
    return `Sent ${days} day${days === 1 ? "" : "s"} ago`
  }, [tracked])

  const termsLabel = client?.paymentTerms ? TERM_LABELS[client.paymentTerms] ?? null : null

  // Which term chip is lit. With no term on file it reads the gap between the
  // issue and due dates, so the control reflects the invoice instead of
  // sitting blank as though nothing had been chosen.
  const [termY, termM] = month.split("-").map(Number)
  const activeTerm = selectedTerm(
    client?.paymentTerms,
    new Date(termY, termM - 1, 1),
    tracked?.dateDue ? new Date(tracked.dateDue) : new Date(termY, termM - 1, 10),
  )


  // One answer to "how many cleans this month", shared with the schedule card.
  // This screen used to carry two: the card counted the live cleans and said
  // "9 cleans done" while the summary above it read the candidate's own
  // counters and said "0 cleans", because a sent invoice carries none.
  const cleanCounts = useMemo(() => countCleans(month, cleans), [month, cleans])
  const cleanCount = billableCleanCount(cleanCounts, inv)


  return (
    <div className="flex h-full flex-col">
      {/* Header — client, where the work is and when it is due on one line,
          with the total labelled and right-aligned, per the design. */}
      <div className="border-b border-stone-200 bg-white px-8 py-5">
        <div className="flex items-start gap-[13px]">
          <span
            className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full text-white"
            style={{ background: "#15793f" }}
          >
            <Building2 size={17} strokeWidth={1.7} />
          </span>

          <div className="min-w-0 flex-1">
            <div className="text-[22px] font-bold leading-[1.2] tracking-[-0.02em] text-stone-900">{inv.clientName}</div>
            <div className="mt-[3px] flex flex-wrap items-center gap-2 text-[15px] text-[#8b95a1]">
              <span className="inline-flex items-center gap-1">
                <MapPin size={13} />
                {locationLabel}
              </span>
              <span className="text-[#d2d8de]">·</span>
              <span className="inline-flex items-center gap-1">
                <CalendarDays size={13} />
                Due {dueDate}
              </span>
            </div>
          </div>

          <div className="flex-none text-right">
            <div className="text-[12px] font-bold uppercase tracking-[0.05em] text-[#9aa3af]">Invoice total</div>
            <div
              className="mt-px tabular-nums"
              style={{ fontSize: 20, fontWeight: 740, letterSpacing: "-0.025em", color: "#10131a" }}
            >
              {formatCurrency(inv.total)}
            </div>

          </div>
        </div>
      </div>

      {/* Scrollable detail (Ticket 2): schedule · changes · headline · calendar */}
      <ScrollWithMoreBelow className="h-full space-y-4 overflow-y-auto px-8 py-5" resetKey={inv.candidateId}>
        {/* Changes this month — shown only when there are changes */}
        {flaggedRows.length > 0 && (
          <div>
            <div className="text-[12px] font-semibold uppercase tracking-[0.06em] text-stone-400">Changes this month</div>
            <div className="mt-2 space-y-1.5 rounded-lg border border-amber-200 bg-amber-50/70 p-3">
              {flaggedRows.map((r) => (
                <div key={r.label} className="flex items-start justify-between gap-3 text-[15px]">
                  <span className="flex items-center gap-1.5 text-stone-600">
                    <AlertTriangle size={12} className="flex-shrink-0 text-amber-500" />
                    {r.label}
                  </span>
                  <span className="text-right font-medium text-stone-800">{r.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Straight to the calendar. The headline that used to sit here said
            the same thing as the schedule-check card below it, and the height
            it cost pushed the calendar under the fold. */}
        <div>
          {/* Per-clean only: a flat-rate client bills the same regardless of the
              visit count, so the day grid says nothing about their total. */}
          {inv.billingType !== "FLAT_RATE" ? (
            <ScheduleCheck
              month={month}
              cleans={cleans}
              clientId={inv.clientId}
              clientName={inv.clientName}
              onCorrected={refreshCleans}
            />
          ) : (
            /* Flat rate has no calendar to check, so the service summary is
               the review: what the monthly price covers. Deliberately NOT on
               per-clean, where it duplicated the schedule card. */
            <div className="rounded-[12px] border border-[#eef0f3] bg-white px-4 py-3.5">
              {locationNames.length > 1 && (
                <div className="mb-3 flex items-center gap-2 text-[12.5px]">
                  <span className="min-w-0 flex-1 truncate text-[#6b7480]">
                    One itemized invoice covers all {locationNames.length} locations
                  </span>
                  <Link
                    href={`/clients/${inv.clientId}`}
                    className="flex-none font-bold text-[#2F7A5E] hover:underline"
                  >
                    Change →
                  </Link>
                </div>
              )}

              <div className="mb-2 text-[16px] font-bold tracking-[-0.01em] text-stone-900">Service summary</div>

              <div className="flex items-center gap-[11px]">
                <span
                  className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg"
                  style={{ background: "#eaf5ee", color: "#15793f" }}
                >
                  <CalendarDays size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold text-[#374151]">Flat monthly service</div>
                  <div className="mt-px text-[12.5px] text-[#9aa3af]">Same price every month</div>
                </div>
                <span className="flex-none text-[15.5px] font-bold tabular-nums text-stone-900">
                  {formatCurrency(inv.total)}
                </span>
              </div>

              {locationNames.length > 0 && (
                <div className="mt-3 space-y-1.5 border-t border-[#f1f3f6] pt-2.5">
                  {locationNames.map(name => (
                    <div key={name} className="flex items-center gap-2 text-[15px]">
                      <span className="min-w-0 flex-1 truncate text-[#6b7480]">· {name}</span>
                      {/* No per-location price: the rate is a monthly one and
                          splitting it invites an argument about a number the
                          business never quoted. */}
                      <span className="flex-none text-[#c2c7cd]">—</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* After sending, this becomes a tracking screen: there is nothing left
            to review, so the preview and the adjustments give way to the
            Sent → Due → Paid timeline and its one primary action. */}
        {tracked ? (
          <>
            <SentTracking invoiceId={tracked.id} invoice={tracked} onEditResend={() => onCompose("resend")} />

            {/* The same month's work seen from the other side: once the client
                has paid, settling with the cleaner is the next decision. */}
            {showPayout && payout && (
              <div
                className="flex items-center gap-2.5 rounded-[9px] px-3 py-2.5"
                style={
                  payout.state === "locked"
                    ? { background: "#fafbfc", border: "1px solid #eef1f4" }
                    : { background: "#f1faf4", border: "1px solid #c7ebd3" }
                }
              >
                <span className="flex flex-none items-center" style={{ color: payout.state === "locked" ? "#94a3af" : "#16a34a" }}>
                  {payout.state === "locked" ? <Lock size={14} /> : <Check size={14} strokeWidth={2.6} />}
                </span>
                <span
                  className="flex-none text-[15px] font-bold"
                  style={{ color: payout.state === "locked" ? "#475569" : "#15803d" }}
                >
                  {payout.title}
                </span>
                <span className="min-w-0 truncate text-[12.5px] text-[#9aa3af]">· {payout.sub}</span>
                {payout.actionable ? (
                  <a
                    href="/payables"
                    className="ml-auto flex-none rounded-lg px-3 py-1.5 text-[15px] font-bold text-white"
                    style={{ background: "#16a34a" }}
                    title="Open Cleaners to settle this · paying happens there, not here"
                  >
                    Pay {formatCurrency(payout.amount)}
                  </a>
                ) : payout.state === "paid" ? (
                  <span className="ml-auto flex-none text-[12.5px] font-bold text-[#16a34a]">✓ Paid</span>
                ) : null}
              </div>
            )}

            {/* When it was sent, when it is due, and the terms it went out on. */}
            <div className="flex items-center justify-between gap-3 pt-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-[15.5px] font-bold text-[#374151]">{sentWhenLabel}</span>
                <span className="text-[#d2d8de]">·</span>
                <span className="truncate text-[15px] text-stone-500">Due {dueDate}</span>
              </div>
              {termsLabel && (
                <span className="flex flex-none items-center gap-1.5 text-[12.5px] font-bold text-[#aab2bd]">
                  <Lock size={12} /> {termsLabel}
                </span>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Credits, discounts and charges. Every row must be approved before
                this invoice can be sent. */}
            <AdjustmentsPanel
              candidateId={inv.candidateId}
              clientId={inv.clientId}
              period={month}
              baseTotal={inv.total}
              billingType={inv.billingType}
              cleanCount={cleanCount}
            />

            {/* What prints at the bottom of the invoice. */}
            <InvoiceFooterAndNote
              clientId={inv.clientId}
              invoiceId={inv.existingInvoiceId ?? null}
              initialNote={sentInvoice?.notes ?? null}
            />
          </>
        )}
      </ScrollWithMoreBelow>

      {/* Primary action. Pinned rather than in the scroller: this is the one
          thing the reviewer is here to do, and it used to sit below the fold. */}
      {!tracked && (
        <div className="flex-none border-t border-stone-200 bg-white px-8 py-4">
          {blockedReason && (
            <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[12.5px] font-semibold text-amber-800">
              {blockedReason}
            </div>
          )}

          {/* The sign-off. Only shown when something actually changed — asking
              on every routine invoice would train people to tick without
              reading, which costs the gate the value it exists for. */}
          {needsConfirmation(adjustments) && (
            <button
              type="button"
              onClick={() => setConfirmed(v => !v)}
              aria-pressed={confirmed}
              className="mb-2.5 flex w-full items-center gap-[11px] text-left"
            >
              <span
                className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[5px] transition-colors"
                style={
                  confirmed
                    ? { background: "#15793f", border: "1px solid #15793f" }
                    : { background: "#fff", border: "1.5px solid #cbd5e1" }
                }
              >
                {confirmed && (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff"
                    strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m5 12 5 5L20 7" />
                  </svg>
                )}
              </span>
              <span className="text-[15px] font-semibold text-[#5b6470]">
                {confirmationText(adjustments)}
              </span>
            </button>
          )}
          {/* Payment terms sit with the send action, because they decide the
              due date the client is about to be given. */}
          <div className="mb-2.5 flex items-center gap-3">
            <span className="flex-none text-[15px] font-bold text-[#111827]">Payment terms</span>
            <span className="min-w-0 flex-1 truncate text-[15px] text-[#9aa3af]">Due {dueDate}</span>
            <div className="flex flex-none gap-0.5 rounded-[9px] bg-[#f1f3f5] p-0.5">
              {TERMS.map(t => {
                const active = activeTerm === t
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTerms(t)}
                    disabled={savingTerms}
                    className="rounded-[6px] px-2.5 py-1.5 text-[15px] transition-colors disabled:opacity-60"
                    style={
                      active
                        ? { background: "#fff", color: "#111827", fontWeight: 700, boxShadow: "0 1px 2px rgba(16,24,40,.08)" }
                        : { color: "#8b95a1", fontWeight: 600 }
                    }
                  >
                    {TERM_LABELS[t]}
                  </button>
                )
              })}
              {/* Only when the invoice's due date fits none of the three. It
                  is not selectable · it reports the date the invoice already
                  carries, rather than leaving all three chips dark as though
                  nothing had been set. */}
              {activeTerm === CUSTOM_TERM && (
                <span
                  title="This invoice's due date does not match Net 7, 15 or 30. Pick one to change it."
                  className="cursor-default rounded-[6px] px-2.5 py-1.5 text-[15px]"
                  style={{ background: "#fff", color: "#111827", fontWeight: 700, boxShadow: "0 1px 2px rgba(16,24,40,.08)" }}
                >
                  Custom
                </span>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => onCompose("send")}
              disabled={!!blockedReason}
              title={blockedReason || undefined}
              className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg py-2.5 text-[15px] font-bold transition-opacity hover:opacity-95"
              style={
                blockedReason
                  ? { background: "#cfd9d3", color: "#7c8a82", cursor: "not-allowed" }
                  : { background: "#2F7A5E", color: "#fff", boxShadow: "0 2px 6px rgba(47,122,94,.26)" }
              }
            >
              <Send size={15} />
              {/* The design puts the blocker in the button itself, so the next
                  action is obvious without reading the notice above. */}
              {blockedReason ? blockedReason : "Review email & send"}
            </button>
            <button
              type="button"
              onClick={() => setPreviewOpen(true)}
              title="See the email and the invoice exactly as the client gets them"
              className="inline-flex flex-none items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-2.5 text-[15px] font-semibold text-stone-600 transition-colors hover:bg-stone-50"
            >
              <Eye size={15} /> Preview full invoice
            </button>
          </div>

          {/* One line, per the design. Saving a draft stays available as a
              link rather than a second status row · it is an action, and it
              read as another thing the app was telling you. */}
          <div className="mt-2 flex items-center justify-center gap-1.5 text-[12.5px] text-stone-400">
            <Lock size={11} /> Invoice will be emailed as a PDF attachment
            <span className="text-stone-300">·</span>
            <button
              onClick={saveDraft}
              disabled={savingDraft}
              className="font-semibold underline-offset-2 transition-colors hover:text-stone-700 hover:underline disabled:opacity-50"
            >
              {savingDraft ? "Saving…" : "Save as draft"}
            </button>
          </div>
        </div>
      )}

      {/* Last look before sending: the covering email and the invoice itself,
          both read-only. */}
      <PreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        from={emailSettings?.fromEmail || "invoicing@thecleanfreaks.co"}
        to={
          loadComposeDraft(inv.candidateId)?.to[0]
          || client?.invoicingEmail
          || client?.communicationEmail
          || ""
        }
        subject={
          loadComposeDraft(inv.candidateId)?.subject
          || `Invoice from The Clean Freaks · ${formatMonthLabel(month)}`
        }
        clientName={inv.clientName}
        payMethodLabel={
          client?.payMethod || client?.preferredPaymentMethod
            ? PAY_METHOD_LABELS[(client.payMethod || client.preferredPaymentMethod).toUpperCase()] ?? null
            : null
        }
        message={previewMessage(inv.candidateId, "")}
      >
        <InvoicePreview inv={inv} month={month} bare />
      </PreviewModal>
    </div>
  )
}

// The PDF the client actually receives — rendered on demand through the same server
// generator (ensureInvoiceId → generate-pdf), so the preview is exact. Until that's
// generated it shows a quick teal approximation so you can read it without creating it.
function InvoicePreview({ inv, month, bare = false }: {
  inv: WorkspaceInvoice
  month: string
  /** Drops the pane chrome so the document can sit inside the preview modal. */
  bare?: boolean
}) {
  const [pdfId, setPdfId] = useState<string | null>(inv.existingInvoiceId || null)
  const [generating, setGenerating] = useState(false)
  const [pdfOpen, setPdfOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const { data: client } = useSWR(`/api/clients/${inv.clientId}`, fetcher)
  // The same templates the editor card edits, so the preview shows what will
  // actually print rather than a fixed example.
  const { data: sections } = useSWR<{ invoiceFooterTemplates: InvoiceFooterTemplates }>(
    "/api/settings/billing-sections",
    fetcher,
  )
  useEffect(() => setMounted(true), [])

  // What the payment section says for THIS client. The preview used to hardcode
  // a Zelle box, so a cheque or portal client was shown instructions to pay
  // somewhere they do not pay us.
  const paymentBlock = useMemo(() => {
    // The RAW value, not `resolvePayMethod`: that collapses "TBD" to null, and
    // the block then cannot tell "nobody filled this in" (take the house
    // default) from "someone recorded that it is undecided" (do not guess).
    const payMethod = client?.payMethod ?? client?.preferredPaymentMethod ?? null
    return buildPaymentBlock({
      payMethod,
      // No client has a pay method recorded yet, so this keeps the business's
      // usual method printing until Josh sets them. A client's own method
      // always wins, so setting one to the portal takes effect immediately.
      fallbackMethod: DEFAULT_CLIENT_PAY_METHOD,
      paymentEmail: "admin@thecleanfreaks.co",
      legalName: "Shiloh Pro Cleaning Services",
      templates: sections?.invoiceFooterTemplates ?? null,
    })
  }, [client?.payMethod, client?.preferredPaymentMethod, sections])
  useEffect(() => { setPdfId(inv.existingInvoiceId || null); setPdfOpen(false) }, [inv.candidateId, inv.existingInvoiceId])

  // Open the exact PDF (what the client receives) in a popup. Generates it first
  // (creating the invoice) when it doesn't exist yet; the inline approximation stays.
  const openPdf = async () => {
    let id = pdfId
    if (!id) {
      setGenerating(true)
      try {
        id = await ensureInvoiceId(inv)
        if (id) setPdfId(id)
      } finally {
        setGenerating(false)
      }
    }
    if (id) {
      fetch(`/api/invoices/${id}/generate-pdf`, { method: "POST" }).catch(() => {})
      setPdfOpen(true)
    }
  }

  const [y, m] = month.split("-").map(Number)
  // Memoised: a fresh `[]` on every render would re-run the document build
  // below each time, since it is one of its dependencies.
  const clientLocations = useMemo(
    () => (client?.locations || []) as Array<{ name?: string; address?: string }>,
    [client?.locations],
  )
  const address = clientLocations[0]?.address || clientLocations[0]?.name || ""

  // The same model the PDF renders. This pane is titled "What your client
  // receives", which is only true while the two say the same thing.
  const doc = useMemo(() => buildInvoiceDocument({
    businessName: "The Clean Freaks",
    businessPhone: "(323) 746-0324",
    clientName: inv.clientName,
    clientAddress: address,
    invoiceNumber: inv.existingInvoiceNumber ?? null,
    issuedDate: new Date(y, m - 1, 1),
    dueDate: new Date(y, m - 1, 10),
    billingType: inv.billingType,
    lineItems: (Array.isArray(inv.lineItems) ? inv.lineItems : []).map((li, i) => ({
      id: String(i),
      description: li.description,
      amount: li.price * li.quantity,
      jobId: li.sourceType === "JOB" ? String(i) : null,
      addOnServiceId: li.sourceType === "ADD_ON" || li.sourceType === "RECURRING_ADD_ON" ? String(i) : null,
    })),
    total: inv.total,
    monthLabel: formatMonthLabel(month),
    locations: clientLocations.map(l => ({ name: l.name ?? "", address: l.address ?? null })),
  }), [inv, address, clientLocations, month, y, m])

  return (
    // Scroll (both axes) rather than crush the invoice: the card keeps a minimum
    // readable width so its columns never overlap when the panel is narrow.
    <div className={bare ? "" : "min-h-0 flex-1 overflow-auto p-6"}>
      <div className={bare ? "mx-auto w-full max-w-[456px]" : "mx-auto w-full min-w-[400px] max-w-[540px]"}>
        {/* Titled the way the design titles it: the point of this pane is that
            it is the client's view, not ours. */}
        <div className={`mb-2 flex items-center justify-between gap-3 ${bare ? "hidden" : ""}`}>
          <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold tracking-[0.02em] text-[#8b95a1]">
            <FileText size={13} /> What your client receives
          </span>
          <button onClick={openPdf} disabled={generating}
            className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-2.5 py-1 text-[11px] font-medium text-stone-600 transition-colors hover:bg-stone-50 disabled:opacity-60"
            title="Open the exact PDF the client receives">
            <FileText size={12} /> {generating ? "Preparing…" : pdfId ? "Open exact PDF" : "Exact PDF"}
          </button>
        </div>
        <div className={bare
          ? "overflow-hidden rounded-[14px] border border-[#e7ebef] bg-white p-8 shadow-[0_1px_2px_rgba(16,24,40,.05)]"
          : "rounded-md bg-white p-10 shadow-lg"}>
        {/* Header · wordmark left, the word INVOICE large and light on the
            right. No logo mark, no strapline, no status: the client is not
            sent a draft, so nothing here says one. */}
        <div className="flex items-start justify-between gap-6">
          <span className="text-[15px] font-extrabold uppercase tracking-[0.06em] text-stone-900">
            {doc.wordmark}
          </span>
          <span className="text-[26px] font-semibold uppercase leading-none tracking-[0.14em] text-stone-300">
            {doc.title}
          </span>
        </div>

        {/* Bill to on the left, the invoice's own facts stacked on the right. */}
        <div className="mt-7 flex items-start justify-between gap-8">
          <div className="min-w-0">
            <div className="text-[9.5px] font-semibold tracking-[0.08em] text-stone-400">BILL TO</div>
            <div className="mt-1 text-[13px] font-bold text-stone-900">{doc.billTo.name}</div>
            {doc.billTo.address && (
              <div className="mt-0.5 text-[11px] leading-relaxed text-stone-500">{doc.billTo.address}</div>
            )}
          </div>
          <div className="flex-none space-y-2 text-right">
            {doc.meta.map(pair => (
              <div key={pair.label}>
                <div className="text-[9px] font-semibold tracking-[0.08em] text-stone-400">{pair.label}</div>
                <div className="text-[11.5px] font-bold tabular-nums text-stone-900">{pair.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* The amount due, before the detail rather than after it. */}
        <div className="mt-7 border-t border-black/10 pt-4 text-right">
          <div className="text-[9.5px] font-semibold tracking-[0.08em] text-stone-400">{doc.totalDueLabel}</div>
          <div className="mt-0.5 text-[27px] font-bold leading-none tabular-nums text-stone-900">{doc.totalDue}</div>
        </div>

        <div className="mt-6">
          <div className="flex items-end gap-3 border-b border-black/10 pb-2 text-[9.5px] font-semibold tracking-[0.08em] text-stone-400">
            <span className="min-w-0 flex-1">{doc.columns.description}</span>
            <span className="w-[46px] flex-none text-right">{doc.columns.quantity}</span>
            <span className="w-[74px] flex-none text-right">{doc.columns.rate}</span>
            <span className="w-[86px] flex-none text-right">{doc.columns.amount}</span>
          </div>
          {doc.rows.map((row, i) => (
            <div key={i} className="flex items-start gap-3 border-b border-black/5 py-2.5 text-[12px]">
              <span className="min-w-0 flex-1 text-stone-800">{row.description}</span>
              <span className="w-[46px] flex-none text-right tabular-nums text-stone-600">{row.quantity ?? ""}</span>
              <span className="w-[74px] flex-none text-right tabular-nums text-stone-600">{row.rate ?? ""}</span>
              <span
                className="w-[86px] flex-none text-right tabular-nums"
                style={{ color: row.negative ? "#047857" : "#1C1917" }}
              >
                {row.amount ?? ""}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-baseline justify-between border-b border-black/10 pb-3">
          <span className="text-[13px] font-bold text-stone-900">{doc.totalLabel}</span>
          <span className="text-[15px] font-bold tabular-nums text-stone-900">{doc.total}</span>
        </div>

        {/* Payment instructions, as plain text and only for this client's own
            method. A portal client prints nothing here. */}
        {paymentBlock.instructions && (
          <div className="mt-5 text-[10.5px] leading-relaxed text-stone-500">
            {paymentBlock.instructions}
          </div>
        )}

        <div className="mt-5 flex items-center justify-between border-t border-black/10 pt-3 text-[10.5px] text-stone-400">
          <span>{doc.footer.left}</span>
          {doc.footer.right && <span className="tabular-nums">{doc.footer.right}</span>}
        </div>

        </div>
      </div>
      {mounted && pdfOpen && pdfId && createPortal(
        <div onClick={() => setPdfOpen(false)} className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-6">
          <div onClick={(e) => e.stopPropagation()} className="relative flex h-[92vh] w-[min(820px,94vw)] flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
            <button onClick={() => setPdfOpen(false)} aria-label="Close"
              className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-stone-100 text-[14px] text-stone-500 hover:bg-stone-200">&times;</button>
            <iframe src={`/api/invoices/${pdfId}/generate-pdf#toolbar=0&navpanes=0&view=FitH`} title="Invoice PDF" className="h-full w-full border-0" />
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
