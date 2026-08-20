"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { ChevronLeft, ChevronRight, Plus, Loader2, SlidersHorizontal, Play, Check, Zap, Search } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import { showSuccess, showError } from "@/lib/toast"
import { MatchPaymentsPanel } from "./match-payments-panel"
import { BillingScheduleSheet } from "./billing-schedule-sheet"
import { RowOverflowMenu, buildRowMenu } from "./row-overflow-menu"
import { MonthPicker } from "./month-picker"
import { NewInvoicePanel } from "./new-invoice-panel"
import {
  LEDGER_TABS,
  filterByTab,
  type LedgerRow,
  type LedgerStatus,
  type LedgerTab,
  type LedgerStats,
} from "@/lib/invoice-ledger"

interface LedgerResponse {
  period: string
  rows: LedgerRow[]
  counts: Record<LedgerTab, number>
  stats: LedgerStats
}

const fetcher = (url: string) => fetch(url).then(r => { if (!r.ok) throw new Error("Failed"); return r.json() })

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const FULL_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

const periodOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
const shiftPeriod = (p: string, delta: number) => {
  const [y, m] = p.split("-").map(Number)
  return periodOf(new Date(y, m - 1 + delta, 1))
}
const periodLabel = (p: string) => {
  const [y, m] = p.split("-").map(Number)
  return `${FULL_MONTHS[m - 1]} ${y}`
}
const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"

// Status pill styling + the instant tooltip copy the design calls for.
const STATUS_META: Record<LedgerStatus, { bg: string; color: string; tip: string }> = {
  "To send": { bg: "#fdf6ea", color: "#8a5e12", tip: "Drafted and waiting for your review." },
  Scheduled: { bg: "#eaf5ee", color: "#15793f", tip: "Will send automatically on the scheduled date. You can cancel it." },
  "Sent: Unpaid": { bg: "#eef2f7", color: "#475467", tip: "Sent to the client, waiting on payment." },
  "Payment late": { bg: "#fdecec", color: "#c0342a", tip: "Past its due date. Time to follow up." },
  "Sent: Paid": { bg: "#eaf5ee", color: "#15803d", tip: "Paid in full and reconciled." },
}

const KIND_STYLE: Record<string, { bg: string; color: string }> = {
  "Flat rate": { bg: "#eef2f7", color: "#475467" },
  "Per clean": { bg: "#f3effb", color: "#6b46c1" },
  "One-off": { bg: "#fdf6ea", color: "#8a5e12" },
}

/** Instant dark tooltip — the design explicitly rejects slow native `title`. */
function Tip({ text, children }: { text: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false)
  return (
    <span className="relative inline-flex" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <span className="pointer-events-none absolute bottom-[calc(100%+7px)] left-1/2 z-30 w-max max-w-[230px] -translate-x-1/2 rounded-lg bg-[#101828] px-2.5 py-1.5 text-[11.5px] font-semibold leading-snug text-white shadow-lg">
          {text}
          <span className="absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-x-4 border-t-4 border-x-transparent border-t-[#101828]" />
        </span>
      )}
    </span>
  )
}

function StatCard({ children }: { children: React.ReactNode }) {
  return <div className="rounded-[13px] border border-[#e4e7ec] bg-white px-[18px] py-4">{children}</div>
}

const statLabel = "text-[10.5px] font-extrabold uppercase tracking-[0.05em] text-[#7d8795]"

export function InvoicesOverview() {
  const router = useRouter()
  const [period, setPeriod] = useState(() => periodOf(new Date()))
  const [tab, setTab] = useState<LedgerTab>("All")
  const [matchOpen, setMatchOpen] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)

  const { data, isLoading, mutate } = useSWR<LedgerResponse>(
    `/api/invoices/overview?period=${period}`,
    fetcher,
    { revalidateOnFocus: false },
  )

  // Unmatched Zelle payments drive the banner above the tabs.
  const { data: inbox, mutate: mutateInbox } = useSWR<{ count: number }>(
    "/api/payments/inbox",
    fetcher,
    { revalidateOnFocus: false },
  )
  const toMatch = inbox?.count ?? 0

  const [query, setQuery] = useState("")
  const [newInvoiceOpen, setNewInvoiceOpen] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)

  /** Mark every selected invoice paid. Reports partial failure rather than
   *  claiming success for rows that did not take. */
  const bulkMarkPaid = async () => {
    const ids = [...checked]
    setBulkBusy(true)
    try {
      const results = await Promise.all(
        ids.map(id =>
          fetch(`/api/invoices/${id}/mark-paid`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paymentMethod: "MANUAL", paymentNotes: "Marked paid from the ledger" }),
          }).then(r => r.ok).catch(() => false),
        ),
      )
      const ok = results.filter(Boolean).length
      if (ok === ids.length) showSuccess(`${ok} marked paid`)
      else if (ok === 0) showError("Could not mark those paid")
      else showError(`${ok} of ${ids.length} marked paid · the rest failed`)
      setChecked(new Set())
      mutate()
    } finally {
      setBulkBusy(false)
    }
  }
  const rows = useMemo(() => {
    const all = data?.rows ?? []
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter(r =>
      r.clientName.toLowerCase().includes(q) || r.invoiceNumber.toLowerCase().includes(q),
    )
  }, [data, query])
  const visible = useMemo(() => filterByTab(rows, tab), [rows, tab])
  const stats = data?.stats
  const counts = data?.counts
  const toSendCount = counts?.["To send"] ?? 0

  // One implementation for the row button and the overflow menu.
  const toggleClearing = async (row: LedgerRow) => {
    try {
      const res = await fetch(`/api/invoices/${row.id}/clearing`, {
        method: row.clearing ? "DELETE" : "POST",
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        throw new Error(err?.error || "Could not update clearing")
      }
      showSuccess(row.clearing ? "No longer clearing" : "Marked as clearing")
      mutate()
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not update clearing")
    }
  }
  // Row selection. The design shows checkboxes on every row; the only bulk
  // action offered is REVIEW, never send — sending always goes through the
  // workspace one invoice at a time.
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const toggleRow = (id: string) =>
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  const visibleIds = rows.map(r => r.id)
  const allChecked = visibleIds.length > 0 && visibleIds.every(id => checked.has(id))
  const toggleAll = () =>
    setChecked(prev => (allChecked ? new Set() : new Set([...prev, ...visibleIds])))

  // Selection is per view; a row that scrolls out of the filter should not stay
  // silently selected.
  useEffect(() => { setChecked(new Set()) }, [tab, period, query])

  // Share of this month's billing that has actually been collected.
  const collectedPct = stats?.billed
    ? Math.min(100, Math.round(((stats.collected ?? 0) / stats.billed) * 100))
    : 0

  return (
    <div className="mx-auto w-full max-w-[1180px] px-6 py-6 md:px-8">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="m-0 text-[26px] font-extrabold leading-none tracking-[-0.025em] text-[#101828]">Invoices</h1>
        <div className="ml-1 inline-flex items-center gap-0.5 rounded-[10px] border border-[#e4e7ec] bg-white p-[3px]">
          <button
            type="button"
            onClick={() => setPeriod(p => shiftPeriod(p, -1))}
            aria-label="Previous month"
            className="flex h-7 w-7 items-center justify-center rounded-md text-[#667085] transition-colors hover:bg-[#f2f4f7] hover:text-[#101828]"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          {/* Click the month to jump straight to another one rather than
              stepping the arrows a year at a time. */}
          <MonthPicker month={period} onChange={setPeriod} />
          <button
            type="button"
            onClick={() => setPeriod(p => shiftPeriod(p, 1))}
            aria-label="Next month"
            className="flex h-7 w-7 items-center justify-center rounded-md text-[#667085] transition-colors hover:bg-[#f2f4f7] hover:text-[#101828]"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Hidden rather than disabled when the queue is empty — the design
              does not keep a dead button on screen. */}
          {toSendCount > 0 && (
            <button
              type="button"
              onClick={() => router.push("/invoices/workspace")}
              className="inline-flex items-center gap-1.5 rounded-[9px] bg-[#0f5a36] px-3.5 py-[9px] text-[12.5px] font-bold text-white shadow-[0_2px_6px_rgba(15,90,54,.26)] transition-colors hover:bg-[#0d4c2e]"
            >
              <Play className="h-3 w-3 fill-current" />
              Start reviewing · {toSendCount}
            </button>
          )}
          <button
            type="button"
            onClick={() => setScheduleOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-[9px] border border-[#e4e7ec] bg-white px-3.5 py-[9px] text-[12.5px] font-bold text-[#475467] transition-colors hover:bg-[#f7f8fa]"
          >
            <SlidersHorizontal className="h-[15px] w-[15px]" />
            Billing schedule
          </button>
          <button
            type="button"
            onClick={() => setNewInvoiceOpen(true)}
            title="For charges that don't come from a scheduled clean · fees, supplies, or work done off-calendar."
            className="inline-flex items-center gap-1.5 rounded-[9px] border border-[#e4e7ec] bg-white px-3.5 py-[9px] text-[12.5px] font-bold text-[#475467] transition-colors hover:bg-[#f7f8fa]"
          >
            <Plus className="h-[15px] w-[15px]" />
            New invoice
          </button>
        </div>
      </div>

      {/* Metrics strip — one card with dividers, as the design has it, so the
          three numbers read as one summary rather than three widgets. */}
      <div className="mt-[14px] flex flex-col items-stretch rounded-[13px] border border-[#eaecef] bg-white py-3 sm:flex-row">
        <div className="min-w-0 flex-[1.2] px-[18px]">
          <div className={statLabel}>Collected this month</div>
          <div className="mt-[3px] flex items-baseline gap-1.5 whitespace-nowrap">
            <span className="text-[19px] font-extrabold tabular-nums tracking-[-0.02em] text-[#15793f]">
              {formatCurrency(stats?.collected ?? 0)}
            </span>
            <span className="text-[12px] text-[#98a2b3]">of</span>
            <span className="text-[19px] font-extrabold tabular-nums tracking-[-0.02em] text-[#101828]">
              {formatCurrency(stats?.billed ?? 0)}
            </span>
            <span className="text-[12px] text-[#98a2b3]">billed</span>
          </div>
          {/* How much of what was billed has actually come in. */}
          <div className="mt-[7px] h-1 overflow-hidden rounded-sm bg-[#eef1f4]">
            <div className="h-full rounded-sm bg-[#15793f]" style={{ width: `${collectedPct}%` }} />
          </div>
        </div>

        <div className="w-px flex-none bg-[#f0f2f4]" />

        <div className="min-w-0 flex-[0.97] px-[18px] pt-3 sm:pt-0">
          <div className={statLabel}>Outstanding · unpaid</div>
          <div className="mt-[3px] flex items-baseline gap-[7px]">
            <span className="text-[19px] font-extrabold tabular-nums tracking-[-0.02em] text-[#101828]">
              {formatCurrency(stats?.outstanding ?? 0)}
            </span>
            <span className="whitespace-nowrap text-[11.5px] text-[#98a2b3]">
              {stats?.unpaidCount ?? 0} unpaid invoice{(stats?.unpaidCount ?? 0) === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        <div className="w-px flex-none bg-[#f0f2f4]" />

        <button
          type="button"
          onClick={() => setTab("Payment late")}
          className="min-w-0 flex-[0.9] rounded-[9px] px-[18px] pt-3 text-left transition-colors hover:bg-[#fdf3f2] sm:pt-0"
          title="See late payments"
        >
          <div className={statLabel}>Late payments</div>
          {stats?.worstOffender ? (
            <>
              <div className="mt-[3px] flex items-baseline gap-[7px]">
                <span className="text-[19px] font-extrabold tabular-nums tracking-[-0.02em] text-[#c0342a]">
                  {formatCurrency(stats?.lateTotal ?? 0)}
                </span>
                <span className="whitespace-nowrap text-[11.5px] text-[#98a2b3]">
                  {stats.lateClientCount} client{stats.lateClientCount === 1 ? "" : "s"}
                </span>
              </div>
              <div className="mt-[5px] truncate text-[11.5px] font-bold text-[#c0342a]">
                {stats.worstOffender.clientName} · {stats.worstOffender.daysLate}d
              </div>
            </>
          ) : (
            // Nothing late is good news, so the design says so rather than
            // printing a $0.00 that reads like a broken number.
            <div className="mt-[5px] flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-[#22a35a]" strokeWidth={2.8} />
              <span className="text-[14px] font-extrabold text-[#15803d]">All current</span>
            </div>
          )}
        </button>
      </div>

      {/* Zelle banner. Always shown: "all matched" is information too, and a
          banner that only appears when something is wrong trains people to
          stop looking for it. */}
      <button
        type="button"
        onClick={() => setMatchOpen(true)}
        className="mt-[10px] flex w-full items-center gap-2.5 rounded-[11px] border border-[#e2d9f3] bg-white px-3.5 py-[7px] text-left transition-colors hover:border-[#cbb9ea]"
      >
        <span className="flex h-6 w-6 flex-none items-center justify-center rounded-[7px] bg-[#f3effb] text-[#6b46c1]">
          <Zap className="h-[13px] w-[13px]" />
        </span>
        <span className="min-w-0 flex-1 text-[13px] font-extrabold tracking-[-0.01em] text-[#101828]">
          {toMatch > 0
            ? `${toMatch} Zelle payment${toMatch === 1 ? "" : "s"} to match`
            : "All Zelle payments matched"}
        </span>
        <span className="flex flex-none items-center gap-1 text-[12px] font-bold text-[#6b46c1]">
          Review &amp; match
          <ChevronRight className="h-3 w-3" />
        </span>
      </button>

      {/* Tabs — name and count only, never money. */}
      <div className="mt-[18px] flex flex-wrap items-center gap-1 border-b border-[#e4e7ec]">
        {LEDGER_TABS.map(t => {
          const active = tab === t
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] font-bold transition-colors ${
                active ? "border-[#15793f] text-[#101828]" : "border-transparent text-[#7d8795] hover:text-[#475467]"
              }`}
            >
              {t}
              <span className={`tabular-nums ${active ? "text-[#15793f]" : "text-[#98a2b3]"}`}>
                {counts?.[t] ?? 0}
              </span>
            </button>
          )
        })}

        {/* Find a client without paging through the month. */}
        <div className="relative ml-auto mb-1.5 w-[230px] flex-none">
          <Search className="pointer-events-none absolute left-[11px] top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-[#7d8795]" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search clients…"
            aria-label="Search clients"
            className="w-full rounded-[10px] border border-[#e4e7ec] bg-white py-[9px] pl-8 pr-3 text-[13px] outline-none focus:border-[#15793f]"
          />
        </div>
      </div>

      {/* Table */}
      <div className="mt-[14px] overflow-hidden rounded-[13px] border border-[#e4e7ec] bg-white">
        <div className="grid grid-cols-[18px_minmax(200px,1fr)_104px_110px_136px_120px_132px] items-center gap-3 border-b border-[#eef0f3] bg-[#fbfcfd] px-5 py-2.5 text-[10.5px] font-extrabold uppercase tracking-[0.05em] text-[#7d8795]">
          <button type="button" onClick={toggleAll} aria-label="Select all invoices" className="flex">
            <CheckBox checked={allChecked} />
          </button>
          <span>Client ↑</span>
          <span>Type</span>
          <span className="text-right">Amount</span>
          <span>Status</span>
          <span>Payment due</span>
          <span className="text-right">Action</span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-[#98a2b3]">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : visible.length === 0 ? (
          <div className="px-5 py-14 text-center text-[13px] text-[#7d8795]">
            {tab === "All" ? `No invoices in ${periodLabel(period)}.` : `Nothing in ${tab.toLowerCase()}.`}
          </div>
        ) : (
          visible.map(row => {
            const meta = STATUS_META[row.ledgerStatus]
            const kind = KIND_STYLE[row.kind] ?? KIND_STYLE["Per clean"]
            return (
              <div
                key={row.id}
                role="button"
                tabIndex={0}
                onClick={() => router.push(`/invoices/${row.id}`)}
                onKeyDown={e => { if (e.key === "Enter") router.push(`/invoices/${row.id}`) }}
                className="irow grid cursor-pointer grid-cols-[18px_minmax(200px,1fr)_104px_110px_136px_120px_132px] items-center gap-3 border-b border-[#f4f5f7] px-5 py-3 transition-colors last:border-b-0"
                // Inline rather than an arbitrary Tailwind class: the value is
                // one the JIT has no other reason to emit.
                style={{ background: checked.has(row.id) ? "#f3f9f5" : "#fff" }}
              >
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); toggleRow(row.id) }}
                  aria-label={`Select ${row.clientName}`}
                  className="flex"
                >
                  <CheckBox checked={checked.has(row.id)} />
                </button>

                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-bold tracking-[-0.01em] text-[#101828]">{row.clientName}</div>
                  <div className="mt-px truncate text-[11.5px] text-[#7d8795]">
                    {row.subtext ?? row.invoiceNumber}
                  </div>
                </div>

                <span
                  className="w-max rounded-full px-2 py-0.5 text-[10.5px] font-bold"
                  style={{ background: kind.bg, color: kind.color }}
                >
                  {row.kind}
                </span>

                <span className="text-right text-[13.5px] font-bold tabular-nums text-[#101828]">
                  {formatCurrency(row.totalAmount)}
                </span>

                <Tip
                  text={
                    row.clearing
                      ? "Payment is on its way. ACH and checks take about 5 to 7 days to land."
                      : meta.tip
                  }
                >
                  <span
                    className="w-max cursor-default rounded-full px-2.5 py-0.5 text-[10.5px] font-bold"
                    style={
                      row.clearing
                        ? { background: "#fdf6ea", color: "#8a5e12" }
                        : { background: meta.bg, color: meta.color }
                    }
                  >
                    {row.statusLabel}
                  </span>
                </Tip>

                <span className="text-[12px] tabular-nums text-[#475467]">
                  {row.ledgerStatus === "Sent: Paid" ? `Paid ${shortDate(row.datePaid)}` : shortDate(row.dateDue)}
                </span>

                <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                  <RowAction
                    row={row}
                    onOpen={() => router.push(`/invoices/${row.id}`)}
                    onToggleClearing={() => toggleClearing(row)}
                  />

                  <RowOverflowMenu
                    items={buildRowMenu(row, {
                      onViewHistory: () =>
                        row.clientId
                          ? router.push(`/clients/${row.clientId}?tab=billing&hist=1`)
                          : showError("This invoice has no client on file."),
                      onMarkPaid: () => router.push(`/invoices/${row.id}`),
                      onUndoPaid: () => router.push(`/invoices/${row.id}`),
                      onToggleClearing: () => toggleClearing(row),
                      onCancelSchedule: () => router.push(`/invoices/${row.id}`),
                    })}
                  />
                </div>
              </div>
            )
          })
        )}
      </div>

      <MatchPaymentsPanel
        open={matchOpen}
        onClose={() => setMatchOpen(false)}
        onMatched={() => { mutate(); mutateInbox() }}
      />

      <BillingScheduleSheet open={scheduleOpen} onClose={() => setScheduleOpen(false)} />

      <NewInvoicePanel
        open={newInvoiceOpen}
        onClose={() => setNewInvoiceOpen(false)}
        onCreated={() => mutate()}
      />

      {/* Bulk bar. Marking paid is the only bulk action the design offers —
          there is deliberately no bulk send, because every invoice is reviewed
          one at a time. */}
      {checked.size > 0 && (
        <div
          className="fixed bottom-6 left-1/2 z-[55] flex -translate-x-1/2 items-center gap-3.5 rounded-[13px] py-2.5 pl-[18px] pr-3 text-white shadow-[0_12px_34px_rgba(16,24,40,0.3)]"
          style={{ background: "#101828" }}
        >
          <span className="text-[13px] font-bold">{checked.size} selected</span>
          <span className="h-5 w-px" style={{ background: "#33405a" }} />
          <button
            type="button"
            onClick={bulkMarkPaid}
            disabled={bulkBusy}
            className="rounded-[9px] bg-white px-3.5 py-2 text-[12.5px] font-bold text-[#101828] transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {bulkBusy ? "Marking…" : "Mark paid"}
          </button>
          <button
            type="button"
            onClick={() => setChecked(new Set())}
            className="px-2 py-2 text-[12.5px] font-bold text-[#7d8795] transition-colors hover:text-white"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  )
}

/** The design's 18px checkbox: square, rounded 5, green when on. */
function CheckBox({ checked }: { checked: boolean }) {
  return (
    <span
      className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[5px]"
      style={{
        border: `1.6px solid ${checked ? "#15793f" : "#cbd2da"}`,
        background: checked ? "#15793f" : "#fff",
      }}
    >
      {checked && <Check className="h-[11px] w-[11px] text-white" strokeWidth={3.2} />}
    </span>
  )
}

/**
 * One action per status. Never a one-click "Send" — the row's primary action is
 * always review, so urgency is a small red badge rather than a red send button.
 */
function RowAction({ row, onOpen, onToggleClearing }: {
  row: LedgerRow
  onOpen: () => void
  onToggleClearing: () => void
}) {
  if (row.ledgerStatus === "To send") {
    return (
      <span className="relative inline-flex items-center">
        {row.urgent && (
          <Tip text="Send today">
            <span className="absolute -left-5 flex h-[18px] w-[18px] cursor-default items-center justify-center rounded-full bg-[#fdecec] text-[11px] font-extrabold text-[#dc2626]">
              !
            </span>
          </Tip>
        )}
        <button
          type="button"
          onClick={onOpen}
          className="rounded-[8px] bg-[#fdf6ea] px-3 py-1.5 text-[12px] font-bold text-[#8a5e12] transition-colors hover:bg-[#f8ecd6]"
        >
          Review
        </button>
      </span>
    )
  }
  if (row.ledgerStatus === "Scheduled") {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="rounded-[8px] bg-[#eaf5ee] px-3 py-1.5 text-[12px] font-bold text-[#15793f] transition-colors hover:bg-[#dcefe3]"
      >
        Scheduled
      </button>
    )
  }
  if (row.ledgerStatus === "Sent: Paid") {
    return <span className="px-1 text-[12px] font-bold text-[#15803d]">Paid</span>
  }
  // Sent: Unpaid and Payment late both offer the quiet mark-paid route, plus a
  // way to flag (or un-flag) an ACH/check payment that is still in flight.
  return (
    <div className="flex items-center justify-end gap-1">
      <Tip text={row.clearing ? "Not actually clearing" : "Payment sent but not landed yet (ACH or check)"}>
        <button
          type="button"
          onClick={onToggleClearing}
          className="rounded-[8px] px-2 py-1.5 text-[12px] font-bold text-[#8a5e12] transition-colors hover:bg-[#fdf6ea]"
        >
          {row.clearing ? "Undo" : "Clearing"}
        </button>
      </Tip>
      <button
        type="button"
        onClick={onOpen}
        className="rounded-[8px] border border-[#e4e7ec] bg-white px-3 py-1.5 text-[12px] font-bold text-[#475467] transition-colors hover:bg-[#f7f8fa]"
      >
        Mark paid
      </button>
    </div>
  )
}
