"use client"

import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import useSWR from "swr"
import { ChevronLeft, ChevronRight, Search, CheckCircle2, AlertTriangle, ExternalLink, FileText, Loader2, Settings, Send } from "lucide-react"
import { fetcher } from "@/lib/fetcher"
import { formatCurrency } from "@/lib/utils"
import { showSuccess, showError } from "@/lib/toast"
import { MiniCalendar } from "./mini-calendar"
import { TemplatesModal } from "./templates-modal"
import {
  useWorkspace, formatMonthLabel, shiftMonth, shortReason,
  type WorkspaceInvoice, type WorkspaceTab,
} from "./use-workspace"
import { ComposerRail } from "./composer-rail"
import { runBatchSend, ensureInvoiceId } from "./invoice-send"

const TABS: WorkspaceTab[] = ["All", "Not sent", "Sent", "Overdue", "Paid"]
const STATUS_DOT: Record<string, string> = { "Not sent": "#F59E0B", Sent: "#0EA5E9", Paid: "#10B981" }
const STATUS_BADGE: Record<string, React.CSSProperties> = {
  "Not sent": { background: "#FFFBEB", borderColor: "#FDE68A", color: "#B45309" },
  Sent: { background: "#EFF6FF", borderColor: "#BFDBFE", color: "#1D4ED8" },
  Paid: { background: "#ECFDF5", borderColor: "#A7F3D0", color: "#047857" },
}

export function InvoicingWorkspace() {
  const ws = useWorkspace()
  const [confirmSend, setConfirmSend] = useState<{ targets: WorkspaceInvoice[]; isAll: boolean } | null>(null)
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null)
  const [mounted, setMounted] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [railWidth, setRailWidth] = useState(360)
  const [detailWidth, setDetailWidth] = useState(340)
  const [listWidth, setListWidth] = useState(330)
  useEffect(() => setMounted(true), [])
  // Restore saved column widths — list width persists across sessions (Ticket 1).
  useEffect(() => {
    try {
      const l = Number(localStorage.getItem("cf-inv-listW")); if (l >= 240 && l <= 480) setListWidth(l)
      const d = Number(localStorage.getItem("cf-inv-detailW")); if (d >= 280 && d <= 560) setDetailWidth(d)
      const r = Number(localStorage.getItem("cf-inv-railW")); if (r >= 340 && r <= 600) setRailWidth(r)
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

  // Drag-to-resize the composer rail (rightmost column → width from the right edge).
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    let finalW = railWidth
    const onMove = (ev: MouseEvent) => { finalW = Math.min(600, Math.max(340, window.innerWidth - ev.clientX)); setRailWidth(finalW) }
    const onUp = () => {
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      try { localStorage.setItem("cf-inv-railW", String(finalW)) } catch { /* noop */ }
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
  const attentionCount = ws.verifiedReady.length > 0
    ? ws.invoices.filter((i) => i.uiStatus === "Not sent" && i.verification.level === "yellow").length
    : 0

  return (
    <div className="flex flex-col bg-stone-50" style={{ height: "100dvh" }}>
      {/* ── Top bar: title · month nav · status totals ── */}
      <header className="flex items-center justify-between gap-6 border-b border-stone-200 bg-white px-6 py-3">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold tracking-tight text-stone-900">Invoices</h1>
          <div className="flex items-center gap-1 rounded-md bg-stone-100 px-1 py-0.5">
            <button onClick={() => ws.setMonth(shiftMonth(ws.month, -1))} className="rounded p-1 text-stone-600 transition-colors hover:bg-white" aria-label="Previous month"><ChevronLeft size={15} /></button>
            <span className="px-2 text-sm font-medium tabular-nums text-stone-700">{formatMonthLabel(ws.month)}</span>
            <button onClick={() => ws.setMonth(shiftMonth(ws.month, 1))} className="rounded p-1 text-stone-600 transition-colors hover:bg-white" aria-label="Next month"><ChevronRight size={15} /></button>
          </div>
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
        <Link href="/invoices/classic" className="text-[11px] text-stone-400 hover:text-stone-600" title="The previous invoices view">Classic view</Link>
      </div>

      {/* ── Three columns ── */}
      <div className="flex min-h-0 flex-1">
        {/* Left: invoice list */}
        <div className="flex shrink-0 flex-col border-r border-stone-200 bg-white" style={{ width: listWidth }}>
          {ws.verifiedReady.length > 0 && (
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
                      <ListItem key={inv.candidateId} inv={inv}
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

        {/* Resize handle (list ↔ detail) — Ticket 1 */}
        <div onMouseDown={startListResize} onDoubleClick={() => { setListWidth(330); try { localStorage.setItem("cf-inv-listW", "330") } catch { /* noop */ } }}
          className="w-1.5 shrink-0 cursor-col-resize bg-stone-200 transition-colors hover:bg-teal-400"
          title="Drag to resize · Double-click to reset" />

        {/* Detail column: schedule · changes · calendar */}
        <div className="flex shrink-0 flex-col border-r border-stone-200 bg-white" style={{ width: detailWidth }}>
          {ws.selected ? <DetailPanel inv={ws.selected} month={ws.month} /> : (
            <div className="m-auto p-6 text-center text-sm text-stone-400">Select an invoice.</div>
          )}
        </div>

        {/* Resize handle (detail ↔ preview) */}
        <div onMouseDown={startDetailResize} onDoubleClick={() => setDetailWidth(340)}
          className="w-1.5 shrink-0 cursor-col-resize bg-stone-200 transition-colors hover:bg-teal-400"
          title="Drag to resize · Double-click to reset" />

        {/* PDF preview column */}
        <div className="flex min-w-0 flex-1 flex-col bg-stone-100">
          {ws.selected ? <InvoicePreview inv={ws.selected} month={ws.month} /> : (
            <div className="m-auto text-sm text-stone-400">Select an invoice to preview.</div>
          )}
        </div>

        {/* Resize handle (preview ↔ composer) */}
        <div onMouseDown={startResize} onDoubleClick={() => setRailWidth(360)}
          className="w-1.5 shrink-0 cursor-col-resize bg-stone-200 transition-colors hover:bg-teal-400"
          title="Drag to resize · Double-click to reset" />

        {/* Right rail: composer (not sent) or receipt (sent/paid) */}
        <div className="shrink-0 bg-white" style={{ width: railWidth }}>
          {ws.selected ? (
            <ComposerRail
              key={ws.selected.candidateId}
              inv={ws.selected}
              month={ws.month}
              onChanged={() => {
                // Auto-advance to the next not-sent invoice for momentum, then refresh.
                const next = ws.invoices.find(
                  (i) => i.uiStatus === "Not sent" && i.candidateId !== ws.selected?.candidateId,
                )
                if (next) ws.setSelectedId(next.candidateId)
                ws.mutate()
              }}
            />
          ) : null}
        </div>
      </div>

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

function ListItem({ inv, selected, checked, onSelect, onCheck }: { inv: WorkspaceInvoice; selected: boolean; checked: boolean; onSelect: () => void; onCheck: () => void }) {
  const green = inv.verification.level === "green"
  const reason = shortReason(inv)
  const notSent = inv.uiStatus === "Not sent"
  const overdue = !!inv.overdueDays && inv.overdueDays > 0
  return (
    <div className={`mb-0.5 flex items-center gap-2 rounded-md px-2 py-2 transition-colors ${selected ? "bg-stone-100 ring-1 ring-stone-300" : "hover:bg-stone-50"}`}>
      {notSent && (
        <button onClick={onCheck} className="flex-shrink-0" aria-label="Select invoice for bulk send"><Box checked={checked} /></button>
      )}
      <button onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span className="flex-shrink-0">
          {overdue ? <AlertTriangle size={14} className="text-rose-500" /> : green ? <CheckCircle2 size={14} className="text-emerald-500" /> : <AlertTriangle size={14} className="text-amber-500" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-stone-900">{inv.clientName}</div>
          {overdue ? (
            <div className="truncate text-[11px] font-semibold text-rose-600">{inv.overdueDays}d overdue</div>
          ) : reason ? (
            <div className="truncate text-[11px] text-amber-600">{reason}</div>
          ) : null}
        </div>
        <div className="flex-shrink-0 text-right">
          <div className="font-mono text-[12px] font-semibold text-stone-700">{formatCurrency(inv.total)}</div>
          <div className={`text-[9px] uppercase tracking-wide ${overdue ? "font-bold text-rose-600" : "text-stone-400"}`}>{overdue ? "Overdue" : inv.uiStatus}</div>
        </div>
      </button>
    </div>
  )
}

function DetailPanel({ inv, month }: { inv: WorkspaceInvoice; month: string }) {
  const { data: client } = useSWR(`/api/clients/${inv.clientId}`, fetcher)

  const cleans = useMemo(() => {
    const jobs = (client?.locations || []).flatMap((l: { jobs?: Array<{ date: string; status: string }> }) => l.jobs || [])
    return jobs.map((j: { date: string; status: string }) => ({ date: j.date, status: j.status }))
  }, [client])

  const cleaner = useMemo(() => {
    for (const l of client?.locations || []) {
      const s = (l.schedules || []).find((sc: { isActive?: boolean; subcontractor?: { name?: string } }) => sc.isActive && sc.subcontractor?.name)
      if (s?.subcontractor?.name) return s.subcontractor.name as string
    }
    return null
  }, [client])

  const dueDate = useMemo(() => {
    const [y, m] = month.split("-").map(Number)
    return new Date(y, m - 1, 10).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  }, [month])
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
  const monthCleans = cleans.filter((c: { date: string }) => (c.date || "").startsWith(month))
  const billingModel = inv.billingType === "FLAT_RATE" ? "Flat monthly" : inv.billingType === "ONE_TIME" ? "One-time" : "Per clean"

  return (
    <div className="flex h-full flex-col">
      {/* Header (Ticket 5): full name → due → amount on its own line + status inline */}
      <div className="border-b border-stone-200 bg-white px-5 py-4">
        <div className="text-[17px] font-semibold leading-snug text-stone-900">{inv.clientName}</div>
        <div className="mt-1.5 text-[12px] text-stone-400">Due {dueDate}</div>
        <div className="mt-3.5 flex items-center gap-3">
          <span className="font-mono text-[26px] font-bold leading-none text-stone-900">{formatCurrency(inv.total)}</span>
          <span className="rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={badge}>{inv.uiStatus}</span>
        </div>
      </div>

      {/* Scrollable detail (Ticket 2): schedule · changes · headline · calendar */}
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {/* Schedule */}
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">Schedule</div>
          <dl className="mt-2 space-y-1.5">
            <div className="flex items-center justify-between gap-3 text-[12.5px]">
              <dt className="text-stone-500">Frequency</dt>
              <dd className="text-right font-medium text-stone-800">{inv.scheduleSummary || "—"}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 text-[12.5px]">
              <dt className="text-stone-500">Billing</dt>
              <dd className="text-right font-medium text-stone-800">{billingModel}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 text-[12.5px]">
              <dt className="text-stone-500">Cleaner</dt>
              <dd className="text-right font-medium text-stone-800">{cleaner || "Unassigned"}</dd>
            </div>
          </dl>
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
          <div className="rounded-lg border border-stone-200 bg-white p-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-semibold text-stone-600">{formatMonthLabel(month)}</span>
              <span className="text-[11px] text-stone-400">{monthCleans.length} clean{monthCleans.length === 1 ? "" : "s"}</span>
            </div>
            <MiniCalendar month={month} cleans={cleans} />
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-stone-400">
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: "#86EFAC" }} />Completed</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: "#93C5FD" }} />Scheduled</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: "#FCA5A5" }} />Missed</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// The PDF the client actually receives — rendered on demand through the same server
// generator (ensureInvoiceId → generate-pdf), so the preview is exact. Until that's
// generated it shows a quick teal approximation so you can read it without creating it.
function InvoicePreview({ inv, month }: { inv: WorkspaceInvoice; month: string }) {
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
    <div className="min-h-0 flex-1 overflow-auto p-6">
      <div className="mx-auto w-full min-w-[400px] max-w-[540px]">
        {/* Demoted secondary action — the exact client-facing PDF (Ticket 3) */}
        <div className="mb-2 flex justify-end">
          <button onClick={openPdf} disabled={generating}
            className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-2.5 py-1 text-[11px] font-medium text-stone-600 transition-colors hover:bg-stone-50 disabled:opacity-60"
            title="Open the exact PDF the client receives">
            <FileText size={12} /> {generating ? "Preparing…" : pdfId ? "Open exact PDF" : "Exact PDF"}
          </button>
        </div>
        <div className="rounded-md bg-white p-10 shadow-lg">
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

