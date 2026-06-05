"use client"

import { ChevronLeft, ChevronRight, Search, CheckCircle2, AlertTriangle, ExternalLink, FileText } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import {
  useWorkspace, formatMonthLabel, shiftMonth, shortReason,
  type WorkspaceInvoice, type WorkspaceTab,
} from "./use-workspace"
import { ComposerRail } from "./composer-rail"

const TABS: WorkspaceTab[] = ["All", "Not sent", "Sent", "Paid"]
const STATUS_DOT: Record<string, string> = { "Not sent": "#F59E0B", Sent: "#0EA5E9", Paid: "#10B981" }

export function InvoicingWorkspace() {
  const ws = useWorkspace()

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
      </div>

      {/* ── Three columns ── */}
      <div className="flex min-h-0 flex-1">
        {/* Left: invoice list */}
        <div className="flex w-[330px] shrink-0 flex-col overflow-y-auto border-r border-stone-200 bg-white">
          {ws.verifiedReady.length > 0 && (
            <div className="m-3 mb-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
              <div className="flex items-center justify-between">
                <div className="text-[12px] text-emerald-800">
                  <span className="font-semibold">{ws.verifiedReady.length} verified</span> ready to send
                </div>
                <span className="font-mono text-[12px] font-semibold text-emerald-800">
                  {formatCurrency(ws.verifiedReady.reduce((s, i) => s + i.total, 0))}
                </span>
              </div>
              <button disabled className="mt-2 w-full cursor-not-allowed rounded-md bg-emerald-600/60 py-1.5 text-[12px] font-semibold text-white" title="Batch send — coming with the composer">
                Send all verified
              </button>
            </div>
          )}

          {ws.isLoading ? (
            <div className="p-6 text-center text-sm text-stone-400">Loading…</div>
          ) : ws.groups.length === 0 ? (
            <div className="p-6 text-center text-sm text-stone-400">No invoices for {formatMonthLabel(ws.month)}.</div>
          ) : (
            ws.groups.map((g) => (
              <div key={g.status} className="px-2 pb-2">
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_DOT[g.status] }} />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">{g.status}</span>
                  <span className="text-[10px] text-stone-400">{g.items.length}</span>
                </div>
                {g.items.map((inv) => (
                  <ListItem key={inv.candidateId} inv={inv} selected={ws.selected?.candidateId === inv.candidateId} onSelect={() => ws.setSelectedId(inv.candidateId)} />
                ))}
              </div>
            ))
          )}
        </div>

        {/* Center: verification + preview */}
        <div className="flex min-w-0 flex-1 flex-col bg-stone-100">
          {ws.selected ? <CenterPanel inv={ws.selected} /> : (
            <div className="m-auto text-sm text-stone-400">Select an invoice to preview.</div>
          )}
        </div>

        {/* Right rail: composer (not sent) or receipt (sent/paid) */}
        <div className="w-[360px] shrink-0 border-l border-stone-200 bg-white">
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
    </div>
  )
}

function ListItem({ inv, selected, onSelect }: { inv: WorkspaceInvoice; selected: boolean; onSelect: () => void }) {
  const green = inv.verification.level === "green"
  const reason = shortReason(inv)
  return (
    <button onClick={onSelect}
      className={`mb-0.5 flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors ${selected ? "bg-stone-100 ring-1 ring-stone-300" : "hover:bg-stone-50"}`}>
      <span className="flex-shrink-0">
        {green ? <CheckCircle2 size={15} className="text-emerald-500" /> : <AlertTriangle size={15} className="text-amber-500" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-stone-900">{inv.clientName}</div>
        {reason && <div className="truncate text-[11px] text-amber-600">{reason}</div>}
      </div>
      <span className="flex-shrink-0 font-mono text-[12px] font-semibold text-stone-700">{formatCurrency(inv.total)}</span>
    </button>
  )
}

function CenterPanel({ inv }: { inv: WorkspaceInvoice }) {
  const green = inv.verification.level === "green"
  return (
    <div className="flex h-full flex-col">
      {/* Verification banner */}
      <div className="px-5 pt-4">
        <div className="flex items-start gap-2 rounded-lg px-3.5 py-2.5"
          style={green ? { background: "#ECFDF5", border: "1px solid #A7F3D0" } : { background: "#FFFBEB", border: "1px solid #FDE68A" }}>
          {green ? <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0 text-emerald-600" /> : <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-amber-600" />}
          <div className="min-w-0">
            <div className="text-[13px] font-semibold" style={{ color: green ? "#047857" : "#B45309" }}>{inv.verification.summary}</div>
            {inv.verification.detail && <div className="mt-0.5 text-[12px] text-stone-600">{inv.verification.detail}</div>}
          </div>
        </div>
      </div>

      {/* Preview */}
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
    </div>
  )
}

