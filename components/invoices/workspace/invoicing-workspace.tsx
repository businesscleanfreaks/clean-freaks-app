"use client"

import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import useSWR from "swr"
import { ChevronLeft, ChevronRight, ChevronDown, Search, CheckCircle2, AlertTriangle, ExternalLink, FileText, Loader2, Settings, Send } from "lucide-react"
import { fetcher } from "@/lib/fetcher"
import { formatCurrency } from "@/lib/utils"
import { showSuccess, showError } from "@/lib/toast"
import { MiniCalendar } from "./mini-calendar"
import { TemplatesModal } from "./templates-modal"
import {
  useWorkspace, formatMonthLabel, shiftMonth, shortReason, buildVerdict, VERDICT_TONE,
  type WorkspaceInvoice, type WorkspaceTab,
} from "./use-workspace"
import { ComposerRail } from "./composer-rail"
import { runBatchSend } from "./invoice-send"

const TABS: WorkspaceTab[] = ["All", "Not sent", "Sent", "Paid"]
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
  useEffect(() => setMounted(true), [])

  // Drag-to-resize the composer rail (rightmost column → width from the right edge).
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const onMove = (ev: MouseEvent) => setRailWidth(Math.min(600, Math.max(340, window.innerWidth - ev.clientX)))
    const onUp = () => {
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
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
    const onMove = (ev: MouseEvent) => setDetailWidth(Math.min(560, Math.max(280, startW + (ev.clientX - startX))))
    const onUp = () => {
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
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
    <div className="flex h-full flex-col bg-stone-50" style={{ minHeight: "calc(100vh - 0px)" }}>
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
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${ws.tab === t ? "bg-white text-stone-900 shadow-sm" : "text-stone-600 hover:text-stone-800"}`}>
              {t}
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
        <div className="flex w-[330px] shrink-0 flex-col border-r border-stone-200 bg-white">
          {ws.verifiedReady.length > 0 && (
            <div className="border-b border-stone-100 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[12px] text-stone-600">
                  <span className="font-semibold text-stone-800">{ws.verifiedReady.length} verified</span> · {formatCurrency(verifiedTotal)}
                </div>
                <button onClick={() => setConfirmSend({ targets: ws.verifiedReady, isAll: true })} disabled={!!batch}
                  className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60">
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

        {/* Detail column: verdict · schedule · calendar · changes */}
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
          {ws.selected ? <PdfPreview inv={ws.selected} /> : (
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
  return (
    <div className={`mb-0.5 flex items-center gap-2 rounded-md px-2 py-2 transition-colors ${selected ? "bg-stone-100 ring-1 ring-stone-300" : "hover:bg-stone-50"}`}>
      {notSent && (
        <button onClick={onCheck} className="flex-shrink-0" aria-label="Select invoice for bulk send"><Box checked={checked} /></button>
      )}
      <button onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span className="flex-shrink-0">
          {green ? <CheckCircle2 size={14} className="text-emerald-500" /> : <AlertTriangle size={14} className="text-amber-500" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-stone-900">{inv.clientName}</div>
          {reason && <div className="truncate text-[11px] text-amber-600">{reason}</div>}
        </div>
        <div className="flex-shrink-0 text-right">
          <div className="font-mono text-[12px] font-semibold text-stone-700">{formatCurrency(inv.total)}</div>
          <div className="text-[9px] uppercase tracking-wide text-stone-400">{inv.uiStatus}</div>
        </div>
      </button>
    </div>
  )
}

function DetailPanel({ inv, month }: { inv: WorkspaceInvoice; month: string }) {
  const verdict = buildVerdict(inv)
  const tone = VERDICT_TONE[verdict.tone]
  const [detailsOpen, setDetailsOpen] = useState(true)
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
    const counts: Record<string, number> = {}
    for (const e of inv.exceptions) counts[e.type] = (counts[e.type] || 0) + 1
    const priceEx = inv.exceptions.find((e) => e.type === "PRICE_CHANGE")
    const credit = inv.lineItems
      .filter((li) => li.sourceType === "PRORATION")
      .reduce((s, li) => s + Math.abs(li.price * li.quantity), 0)
    const addOnTotal = inv.lineItems
      .filter((li) => li.sourceType === "ADD_ON" || li.sourceType === "RECURRING_ADD_ON")
      .reduce((s, li) => s + li.price * li.quantity, 0)
    const rows: Array<{ label: string; value: string; flag: boolean }> = [
      { label: "Cancellations", value: counts.SKIPPED ? `${counts.SKIPPED} this month${credit ? ` · -${formatCurrency(credit)}` : ""}` : "None", flag: !!counts.SKIPPED },
      { label: "Rate vs last month", value: priceEx ? priceEx.message : "No change", flag: !!priceEx },
    ]
    if (counts.ONE_TIME_ADD_ON) rows.push({ label: "Add-ons", value: `${counts.ONE_TIME_ADD_ON} this month${addOnTotal ? ` · +${formatCurrency(addOnTotal)}` : ""}`, flag: true })
    if (counts.ONE_OFF_JOB) rows.push({ label: "One-off jobs", value: `${counts.ONE_OFF_JOB} this month`, flag: true })
    if (counts.RESCHEDULED) rows.push({ label: "Rescheduled", value: `${counts.RESCHEDULED} clean${counts.RESCHEDULED > 1 ? "s" : ""}`, flag: true })
    if (counts.MISSING_EMAIL) rows.push({ label: "Email on file", value: "Missing — add before sending", flag: true })
    return rows
  }, [inv.exceptions, inv.lineItems])

  return (
    <div className="flex h-full flex-col">
      {/* Header: client · due · status · amount */}
      <div className="flex items-center justify-between gap-3 border-b border-stone-200 bg-white px-5 py-3">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold text-stone-900">{inv.clientName}</div>
          <div className="text-[12px] text-stone-400">Due {dueDate}</div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-3">
          <span className="rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={badge}>{inv.uiStatus}</span>
          <span className="font-mono text-[18px] font-bold text-stone-900">{formatCurrency(inv.total)}</span>
        </div>
      </div>

      {/* Scrollable detail: verdict · schedule · calendar · changes */}
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
      {/* Verdict — plain-English "what's the story this month" + the this-month detail */}
      <div className="px-5 pt-4">
        <div className="rounded-lg px-3.5 py-3" style={{ background: tone.bg, border: `1px solid ${tone.border}` }}>
          <div className="flex items-start gap-2.5">
            <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full" style={{ background: tone.dot }} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium leading-snug" style={{ color: tone.text }}>{verdict.text}</div>
              <div className="mt-1 truncate text-[12px] text-stone-500">{inv.scheduleSummary}{cleaner ? ` · ${cleaner}` : ""}</div>
            </div>
            <button onClick={() => setDetailsOpen((o) => !o)}
              className="inline-flex flex-shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold hover:bg-black/5"
              style={{ color: tone.text }}>
              This month <ChevronDown size={13} className={`transition-transform ${detailsOpen ? "rotate-180" : ""}`} />
            </button>
          </div>

          {detailsOpen && (
            <div className="mt-3 space-y-3 border-t pt-3" style={{ borderColor: tone.border }}>
              {/* What changed this month */}
              <div className="space-y-1.5">
                {changeRows.map((r) => (
                  <div key={r.label} className="flex items-start justify-between gap-3 text-[12px]">
                    <span className="flex items-center gap-1.5 text-stone-500">
                      {r.flag ? <AlertTriangle size={12} className="flex-shrink-0 text-amber-500" /> : <CheckCircle2 size={12} className="flex-shrink-0 text-emerald-500" />}
                      {r.label}
                    </span>
                    <span className={`text-right ${r.flag ? "font-medium text-stone-800" : "text-stone-400"}`}>{r.value}</span>
                  </div>
                ))}
              </div>

              {/* This month's cleans calendar */}
              <div className="rounded-lg border border-white/70 bg-white/70 p-2.5">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-stone-600">{formatMonthLabel(month)}</span>
                  <span className="text-[11px] text-stone-400">{cleans.length} clean{cleans.length === 1 ? "" : "s"}</span>
                </div>
                <MiniCalendar month={month} cleans={cleans} />
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-stone-400">
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: "#86EFAC" }} />Completed</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: "#93C5FD" }} />Scheduled</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: "#FCA5A5" }} />Missed</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      </div>
    </div>
  )
}

function PdfPreview({ inv }: { inv: WorkspaceInvoice }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-5 py-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">Preview</span>
        {inv.existingInvoiceId && (
          <a href={`/api/invoices/${inv.existingInvoiceId}/generate-pdf`} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-700 hover:text-teal-800">
            <ExternalLink size={12} /> View actual PDF
          </a>
        )}
      </div>
      {inv.existingInvoiceId ? (
        <iframe src={`/api/invoices/${inv.existingInvoiceId}/generate-pdf#toolbar=0&navpanes=0&view=FitH`} title="Invoice preview"
          className="min-h-0 flex-1 rounded-md border-0 bg-white shadow-sm" />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center rounded-md border border-dashed border-stone-300 bg-white text-center">
          <FileText size={28} className="mb-3 text-stone-300" />
          <p className="text-sm font-medium text-stone-600">Not created yet</p>
          <p className="mt-1 max-w-xs text-xs text-stone-400">The PDF preview generates once this invoice is created or sent.</p>
        </div>
      )}
    </div>
  )
}

