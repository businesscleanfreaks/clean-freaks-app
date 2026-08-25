"use client"

import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import useSWR from "swr"
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Search, CheckCircle2, AlertTriangle, ExternalLink, FileText, Loader2, Settings, Send, CalendarDays, Building2, MapPin, Lock, Check, PanelLeftClose, Eye } from "lucide-react"
import { fetcher } from "@/lib/fetcher"
import { formatCurrency } from "@/lib/utils"
import { showSuccess, showError } from "@/lib/toast"
import { ScheduleCheck, type ScheduleCheckClean } from "./schedule-check"
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
import { buildServiceSummary } from "@/lib/invoice-service-summary"
import { buildPayoutSummary, shouldShowPayout } from "@/lib/invoice-payout"
import { TERMS, TERM_LABELS } from "@/lib/billing-schedule"
import type { ComposeMode } from "@/lib/invoice-compose"

const TABS: WorkspaceTab[] = ["All", "Not sent", "Sent", "Overdue", "Paid"]
const STATUS_DOT: Record<string, string> = { "Not sent": "#F59E0B", Sent: "#0EA5E9", Paid: "#10B981" }
const STATUS_BADGE: Record<string, React.CSSProperties> = {
  "Not sent": { background: "#FFFBEB", borderColor: "#FDE68A", color: "#B45309" },
  Sent: { background: "#EFF6FF", borderColor: "#BFDBFE", color: "#1D4ED8" },
  Paid: { background: "#ECFDF5", borderColor: "#A7F3D0", color: "#047857" },
}

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
      {/* ── Top bar: title · month nav · status totals ── */}
      <header className="flex items-center justify-between gap-6 border-b border-stone-200 bg-white px-6 py-3">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold tracking-tight text-stone-900">Invoices</h1>

          {/* Opens the list. The only way back to the queue when the two-pane
              layout is showing, so it stays available whatever the invoice. */}
          {listCollapsed && ws.queueTotal > 0 && (
            <button
              onClick={() => setListCollapsed(false)}
              title="See the full list"
              className="whitespace-nowrap rounded-full border border-stone-200 bg-white px-3 py-1 text-[12.5px] font-semibold text-[#8b95a1] transition-colors hover:text-stone-700"
            >
              {ws.queueTotal} to send in the queue
            </button>
          )}

          {/* Review queue position. Fixed-width label so the arrows never shift. */}
          {ws.queuePositionLabel && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 rounded-md border border-stone-200 bg-white px-2.5 py-1">
                {/* Only the digits sit in fixed-width slots — that is what
                    keeps the arrows still as you walk the queue. Truncating
                    the whole sentence (as this used to) just clipped it. */}
                <span className="flex-none whitespace-nowrap text-[12.5px] font-semibold text-stone-700">
                  Reviewing{" "}
                  <span className="inline-block w-[2ch] text-right tabular-nums">{ws.queuePos > 0 ? ws.queuePos : "-"}</span>
                  {" of "}
                  <span className="inline-block w-[2ch] text-right tabular-nums">{ws.queueTotal}</span>
                  {" to send"}
                </span>
                {ws.queueGroup && (
                  <span className="hidden flex-none whitespace-nowrap text-[12px] text-stone-400 xl:inline">
                    · {ws.queueGroup}
                  </span>
                )}
                <div className="h-1 w-16 flex-none overflow-hidden rounded-full bg-stone-100">
                  <div className="h-full rounded-full bg-[#15793f] transition-all" style={{ width: `${ws.queueProgress}%` }} />
                </div>
                <div className="flex flex-none items-center gap-0.5">
                  <button
                    onClick={() => ws.stepReview(-1)}
                    aria-label="Previous invoice to review"
                    title="Previous (Up arrow)"
                    className="rounded p-0.5 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    onClick={() => ws.stepReview(1)}
                    aria-label="Next invoice to review"
                    title="Next (Down arrow)"
                    className="rounded p-0.5 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-5 text-sm tabular-nums">
          {([["Not sent", ws.totals.notSent], ["Sent", ws.totals.sent], ["Paid", ws.totals.paid]] as const).map(([label, amt]) => (
            <div key={label} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: STATUS_DOT[label] }} />
              <span className="text-stone-600">{label}</span>
              <span className="font-semibold text-stone-900">{formatCurrency(amt)}</span>
            </div>
          ))}
        </div>
      </header>

      {/* ── Filter bar: tabs + search ── */}
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

      {/* ── Three columns ── */}
      <div className="flex min-h-0 flex-1">
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

        {/* Detail column. With the list hidden this shares the width with the
            client's view rather than staying at its three-column size — the
            review is the point of the two-pane layout, not a sidebar. */}
        <div
          className={`flex flex-col border-r border-stone-200 bg-white ${listCollapsed ? "min-w-0 flex-1" : "shrink-0"}`}
          style={listCollapsed ? { maxWidth: 720 } : { width: detailWidth }}
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

        {/* Resize handle (detail ↔ preview) */}
        {!listCollapsed && (
          <div onMouseDown={startDetailResize} onDoubleClick={() => setDetailWidth(340)}
            className="w-1.5 shrink-0 cursor-col-resize bg-stone-200 transition-colors hover:bg-teal-400"
            title="Drag to resize · Double-click to reset" />
        )}

        {/* PDF preview column */}
        <div className="flex min-w-0 flex-1 flex-col bg-stone-100">
          {ws.selected ? <InvoicePreview inv={ws.selected} month={ws.month} /> : (
            <div className="m-auto text-sm text-stone-400">Select an invoice to preview.</div>
          )}
        </div>

      </div>

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

  const cleaner = useMemo(() => {
    for (const l of client?.locations || []) {
      const s = (l.schedules || []).find((sc: { isActive?: boolean; subcontractor?: { name?: string } }) => sc.isActive && sc.subcontractor?.name)
      if (s?.subcontractor?.name) return s.subcontractor.name as string
    }
    return null
  }, [client])

  const dueDate = useMemo(() => {
    // Prefer the real due date once one exists; the month-based guess is only
    // for candidates that have not been invoiced yet.
    const real = tracked?.dateDue ? new Date(tracked.dateDue) : null
    if (real && !isNaN(real.getTime())) {
      return real.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    }
    const [y, m] = month.split("-").map(Number)
    return new Date(y, m - 1, 10).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  }, [month, tracked])
  const badge = STATUS_BADGE[inv.uiStatus] || STATUS_BADGE["Not sent"]

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

  const billingModel = inv.billingType === "FLAT_RATE" ? "Flat monthly" : inv.billingType === "ONE_TIME" ? "One-time" : "Per clean"

  // Cancelled cleans are counted so the summary can explain a light total
  // ("4 of 5 scheduled cleans found in August").
  const cancelledThisMonth = (Array.isArray(inv.exceptions) ? inv.exceptions : []).filter(
    e => e.type === "SKIPPED",
  ).length
  const serviceSummary = buildServiceSummary({
    billingType: inv.billingType,
    cleanCount: inv.completedCount || inv.jobCount || 0,
    cancelledCount: cancelledThisMonth,
    monthLabel: formatMonthLabel(month).split(" ")[0],
    scheduleSummary: inv.scheduleSummary,
    firstLineDescription: (inv.lineItems || [])[0]?.description,
  })


  return (
    <div className="flex h-full flex-col">
      {/* Header — client, where the work is and when it is due on one line,
          with the total labelled and right-aligned, per the design. */}
      <div className="border-b border-stone-200 bg-white px-5 py-4">
        <div className="flex items-start gap-[13px]">
          <span
            className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full text-white"
            style={{ background: "#15793f" }}
          >
            <Building2 size={17} strokeWidth={1.7} />
          </span>

          <div className="min-w-0 flex-1">
            <div className="text-[18px] font-bold leading-[1.2] tracking-[-0.02em] text-stone-900">{inv.clientName}</div>
            <div className="mt-[3px] flex flex-wrap items-center gap-2 text-[12px] text-[#8b95a1]">
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
            <div className="text-[10.5px] font-bold uppercase tracking-[0.05em] text-[#9aa3af]">Invoice total</div>
            <div
              className="mt-px tabular-nums"
              style={{ fontSize: 20, fontWeight: 740, letterSpacing: "-0.025em", color: "#10131a" }}
            >
              {formatCurrency(inv.total)}
            </div>
            <span
              className="mt-1 inline-block rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
              style={badge}
            >
              {inv.uiStatus}
            </span>
          </div>
        </div>
      </div>

      {/* Scrollable detail (Ticket 2): schedule · changes · headline · calendar */}
      <ScrollWithMoreBelow className="h-full space-y-5 overflow-y-auto px-5 py-4" resetKey={inv.candidateId}>
        {/* Service summary — what this invoice is actually for, in plain
            English. Replaces a key-value block that printed schedule enums
            ("EVERY_4_WEEKS") straight at the reviewer. */}
        <div style={{ border: "1px solid #eef0f3", borderRadius: 14, padding: "12px 15px" }}>
          <div className="mb-3 text-[15.5px] font-bold tracking-[-0.01em] text-stone-900">Service summary</div>
          <div className="flex items-center gap-[11px]">
            <span
              className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg"
              style={{ background: "#eaf5ee", color: "#15793f" }}
            >
              <CalendarDays size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-[#374151]">{serviceSummary.title}</div>
              <div className="mt-px text-[11.5px] text-[#9aa3af]">{serviceSummary.sub}</div>
            </div>
            <span className="flex-none text-[13.5px] font-bold tabular-nums text-stone-900">
              {formatCurrency(inv.total)}
            </span>
          </div>

          <div className="mt-3 flex items-center gap-1.5 border-t border-[#f1f3f6] pt-[11px] text-[11.5px] text-[#9aa3af]">
            <span>{billingModel}</span>
            <span className="text-stone-300">·</span>
            <span className="truncate">{cleaner || "No cleaner assigned"}</span>
          </div>
        </div>

        {/* Changes this month — shown only when there are changes */}
        {flaggedRows.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">Changes this month</div>
            <div className="mt-2 space-y-1.5 rounded-lg border border-amber-200 bg-amber-50/70 p-3">
              {flaggedRows.map((r) => (
                <div key={r.label} className="flex items-start justify-between gap-3 text-[12px]">
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

        {/* One quiet headline above the calendar, then the calendar */}
        <div>
          <div className="mb-2 text-[12px] text-stone-500">
            <span className="font-semibold text-stone-700">{monthCleans.length} clean{monthCleans.length === 1 ? "" : "s"}</span> this month · {flaggedRows.length === 0 ? "no changes" : `${flaggedRows.length} change${flaggedRows.length === 1 ? "" : "s"}`}
          </div>
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
            <p className="rounded-lg border border-stone-200 bg-white p-2.5 text-[11.5px] text-stone-500">
              Flat monthly rate · the total does not change with the visit count.
            </p>
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
                  className="flex-none text-[12px] font-bold"
                  style={{ color: payout.state === "locked" ? "#475569" : "#15803d" }}
                >
                  {payout.title}
                </span>
                <span className="min-w-0 truncate text-[11.5px] text-[#9aa3af]">· {payout.sub}</span>
                {payout.actionable ? (
                  <a
                    href="/payables"
                    className="ml-auto flex-none rounded-lg px-3 py-1.5 text-[12px] font-bold text-white"
                    style={{ background: "#16a34a" }}
                    title="Open Payables to settle this · paying happens there, not here"
                  >
                    Pay {formatCurrency(payout.amount)}
                  </a>
                ) : payout.state === "paid" ? (
                  <span className="ml-auto flex-none text-[11.5px] font-bold text-[#16a34a]">✓ Paid</span>
                ) : null}
              </div>
            )}

            {/* When it was sent, when it is due, and the terms it went out on. */}
            <div className="flex items-center justify-between gap-3 pt-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-[13.5px] font-bold text-[#374151]">{sentWhenLabel}</span>
                <span className="text-[#d2d8de]">·</span>
                <span className="truncate text-[12.5px] text-stone-500">Due {dueDate}</span>
              </div>
              {termsLabel && (
                <span className="flex flex-none items-center gap-1.5 text-[11.5px] font-bold text-[#aab2bd]">
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
              cleanCount={inv.completedCount || inv.jobCount || 0}
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
        <div className="flex-none border-t border-stone-200 bg-white px-5 py-3">
          {blockedReason && (
            <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11.5px] font-semibold text-amber-800">
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
              <span className="text-[12.5px] font-semibold text-[#5b6470]">
                {confirmationText(adjustments)}
              </span>
            </button>
          )}
          {/* Payment terms sit with the send action, because they decide the
              due date the client is about to be given. */}
          <div className="mb-2.5 flex items-center gap-3">
            <span className="flex-none text-[13px] font-bold text-[#111827]">Payment terms</span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-[#9aa3af]">Due {dueDate}</span>
            <div className="flex flex-none gap-0.5 rounded-[9px] bg-[#f1f3f5] p-0.5">
              {TERMS.map(t => {
                const active = (client?.paymentTerms ?? null) === t
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTerms(t)}
                    disabled={savingTerms}
                    className="rounded-[6px] px-2.5 py-1.5 text-[12px] transition-colors disabled:opacity-60"
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
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => onCompose("send")}
              disabled={!!blockedReason}
              title={blockedReason || undefined}
              className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg py-2.5 text-[13px] font-bold transition-opacity hover:opacity-95"
              style={
                blockedReason
                  ? { background: "#cfd9d3", color: "#7c8a82", cursor: "not-allowed" }
                  : { background: "#0f5a36", color: "#fff", boxShadow: "0 2px 6px rgba(15,90,54,.26)" }
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
              className="inline-flex flex-none items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-2.5 text-[13px] font-semibold text-stone-600 transition-colors hover:bg-stone-50"
            >
              <Eye size={15} /> Preview full invoice
            </button>
          </div>

          <div className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-stone-400">
            <Lock size={11} /> Invoice will be emailed as a PDF attachment
          </div>

          <button
            onClick={saveDraft}
            disabled={savingDraft}
            className="mt-1.5 w-full text-[11.5px] font-semibold text-stone-400 transition-colors hover:text-stone-700 disabled:opacity-50"
          >
            {savingDraft ? "Saving…" : "Save as draft · nothing is emailed"}
          </button>
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
  useEffect(() => setMounted(true), [])
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
  const issued = new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  const dueDate = new Date(y, m - 1, 10).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  const invNumber = inv.existingInvoiceNumber || "Draft"
  const loc = (client?.locations || [])[0] as { address?: string; name?: string } | undefined
  const address = loc?.address || loc?.name || ""
  const lineItems = Array.isArray(inv.lineItems) ? inv.lineItems : []
  const items = lineItems.length > 0
    ? lineItems
    : [{ description: `Cleaning services · ${formatMonthLabel(month)}`, quantity: 1, price: inv.total, sourceType: "FLAT_RATE", locationName: undefined }]

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
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md text-[13px] font-bold text-white" style={{ background: "#0D9488" }}>C</div>
              <span className="text-[17px] font-bold tracking-tight text-stone-900">Clean Freaks</span>
            </div>
            <div className="mt-2 text-[10.5px] leading-relaxed text-stone-400">Commercial cleaning · Los Angeles<br />admin@thecleanfreaks.co</div>
          </div>
          <div className="text-right">
            <div className="text-[13px] font-semibold text-stone-700">Invoice</div>
            <div className="mt-1.5 text-[10.5px] leading-relaxed tabular-nums text-stone-400">{invNumber}<br />Issued {issued} · Due {dueDate}</div>
          </div>
        </div>

        <div className="mt-7">
          <div className="text-[10px] font-semibold tracking-wide text-stone-400">BILL TO</div>
          <div className="mt-1 text-[13px] font-semibold text-stone-900">{inv.clientName}</div>
          {address && <div className="mt-0.5 text-[11px] text-stone-500">{address}</div>}
        </div>

        <div className="mt-6">
          <div className="flex justify-between border-b border-black/10 pb-2 text-[10px] font-semibold tracking-wide text-stone-400">
            <span>DESCRIPTION</span><span>AMOUNT</span>
          </div>
          {items.map((li, i) => {
            const amt = li.quantity * li.price
            return (
              <div key={i} className="flex justify-between gap-3 border-b border-black/5 py-2.5">
                <div className="min-w-0">
                  <div className="text-[12.5px] text-stone-800">{li.description}</div>
                  {li.locationName && <div className="mt-0.5 text-[11px] text-stone-400">{li.locationName}</div>}
                </div>
                <div className="flex-shrink-0 text-[12.5px] tabular-nums" style={{ color: amt < 0 ? "#047857" : "#1C1917" }}>{formatCurrency(amt)}</div>
              </div>
            )
          })}
        </div>

        <div className="mt-5 flex items-baseline justify-between">
          <span className="text-[13px] font-semibold text-stone-700">Total due</span>
          <span className="text-[20px] font-bold tabular-nums text-stone-900">{formatCurrency(inv.total)}</span>
        </div>

        <div className="mt-5 rounded-lg border p-3 text-[10.5px] leading-relaxed text-stone-600" style={{ background: "#F0FDFA", borderColor: "#99F6E4" }}>
          Please send payment via Zelle to <span className="font-semibold text-stone-900">admin@thecleanfreaks.co</span>{" "}
          <span className="rounded px-1 font-semibold" style={{ background: "#FEF3C7", color: "#92400E" }}>&ldquo;co&rdquo; not &ldquo;com&rdquo;</span>.
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
