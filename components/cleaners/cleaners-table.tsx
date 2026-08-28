"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import { ChevronRight, Loader2, Search, X } from "lucide-react"
import { fetcher } from "@/lib/fetcher"
import { formatCurrency } from "@/lib/utils"
import { showError, showUndoToast } from "@/lib/toast"
import type { JobPayState } from "@/lib/cleaner-payables"
import { BatchPayBar, type PaySelection } from "./batch-pay-bar"
import { CleanersSummary, type PaymentRow } from "./cleaners-summary"

interface JobRow {
  id: string
  date: string
  amount: number
  paid: boolean
  cancelled: boolean
  invoiced: boolean
  state: JobPayState
}

interface AccountRow {
  id: string
  clientId: string
  clientName: string
  locationName: string
  propertyType: string | null
  invoiceUnit: "PER_ACCOUNT" | "PER_CLEAN"
  clientHasPaid: boolean
  invoiceTally: { expected: number; received: number; complete: boolean }
  jobs: JobRow[]
}

interface CleanerRow {
  id: string
  name: string
  kind?: "cleaner" | "vendor"
  /** Vendors only: "Pressure washing" etc., shown in the sub-label. */
  specialty?: string | null
  invoicesUs: boolean
  payByDay: number
  accounts: AccountRow[]
  invoiceTally: { expected: number; received: number; complete: boolean; notApplicable: boolean }
  clientPaidTally: { paid: number; total: number }
  readyNow: number
  stillOwed: number
  unpaidJobs: number
}

interface CleanersData {
  period: string
  cleaners: CleanerRow[]
  vendors: CleanerRow[]
  totals: { readyNow: number; stillOwed: number; unpaidJobs: number; paidSoFar: number }
  payments: PaymentRow[]
}

const HEAD = "text-[10px] font-extrabold uppercase tracking-[0.07em] text-[#98a2b3]"

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join("").toUpperCase()

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })

/**
 * The Cleaners table: one row per cleaner, their accounts underneath.
 *
 * The two "N of N" columns are the point of the page — has the client paid us,
 * and has the cleaner invoiced us — because a job cannot be paid until the
 * second is in, and large ones wait on the first.
 */
export function CleanersTable({ period, onOpenProfile }: {
  period: string
  onOpenProfile?: (cleanerId: string) => void
}) {
  const { data, isLoading, mutate } = useSWR<CleanersData>(
    `/api/cleaners/data?period=${period}`,
    fetcher,
    { revalidateOnFocus: false },
  )

  const [open, setOpen] = useState<Set<string>>(new Set())
  const [openAccounts, setOpenAccounts] = useState<Set<string>>(new Set())
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [sortBy, setSortBy] = useState<"jobs" | "name">("jobs")
  const [query, setQuery] = useState("")

  const toggleAccount = (id: string) =>
    setOpenAccounts(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggle = (id: string) =>
    setOpen(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const rows = useMemo(() => {
    const all = data?.cleaners ?? []
    const q = query.trim().toLowerCase()
    const list = q
      ? all.filter(
          c =>
            c.name.toLowerCase().includes(q) ||
            c.accounts.some(a => a.clientName.toLowerCase().includes(q)),
        )
      : all
    return [...list].sort((a, b) =>
      sortBy === "name"
        ? a.name.localeCompare(b.name)
        : b.unpaidJobs - a.unpaidJobs || a.name.localeCompare(b.name),
    )
  }, [data, sortBy, query])

  const vendorRows = useMemo(() => {
    const all = data?.vendors ?? []
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter(
      v =>
        v.name.toLowerCase().includes(q) ||
        v.accounts.some(a => a.clientName.toLowerCase().includes(q)),
    )
  }, [data, query])

  /**
   * Tick or untick an account's invoice. A per-account account is marked as a
   * whole; a per-clean one carries the job id.
   */
  const setInvoiced = async (
    cleaner: CleanerRow,
    account: AccountRow,
    jobId: string | null,
    on: boolean,
  ) => {
    const qs = new URLSearchParams({ locationId: account.id, period })
    if (jobId) qs.set("jobId", jobId)
    if (cleaner.kind === "vendor") qs.set("payee", "vendor")
    const postUrl = cleaner.kind === "vendor"
      ? `/api/cleaners/${cleaner.id}/invoice-receipts?payee=vendor`
      : `/api/cleaners/${cleaner.id}/invoice-receipts`
    try {
      const res = on
        ? await fetch(postUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ locationId: account.id, period, jobId }),
          })
        : await fetch(`/api/cleaners/${cleaner.id}/invoice-receipts?${qs}`, { method: "DELETE" })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        throw new Error(err?.error || "Could not update the invoice")
      }
      showUndoToast(
        on ? `Invoice marked in · ${account.clientName}` : `Invoice unmarked · ${account.clientName}`,
        async () => {
          await setInvoiced(cleaner, account, jobId, !on)
        },
      )
      mutate()
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not update the invoice")
    }
  }

  const selection: PaySelection[] = useMemo(() => {
    return [...rows, ...vendorRows]
      .filter(c => checked.has(c.id) && c.readyNow > 0)
      .map(c => ({
        cleanerId: c.id,
        cleanerName: c.name,
        jobIds: c.accounts.flatMap(a => a.jobs.filter(j => j.state === "ready").map(j => j.id)),
        amount: c.readyNow,
        isVendor: c.kind === "vendor",
      }))
      .filter(p => p.jobIds.length > 0)
  }, [rows, vendorRows, checked])

  const toggleChecked = (id: string) =>
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const renderPayee = (c: CleanerRow) => {
        const isOpen = open.has(c.id)
        const inv = c.invoiceTally
        return (
          <div key={c.id}>
            <div
              onClick={() => toggle(c.id)}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === "Enter") toggle(c.id) }}
              className="flex cursor-pointer items-center gap-3 border-b border-[#f0f0ed] px-5 py-[13px] transition-colors hover:bg-[#f1f5f0]"
            >
              <Box
                checked={checked.has(c.id)}
                disabled={c.readyNow <= 0}
                onClick={() => toggleChecked(c.id)}
                label={`Select ${c.name}`}
                stop
              />
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <ChevronRight
                  size={13}
                  className="flex-none text-[#8a8f93] transition-transform"
                  style={{ transform: isOpen ? "rotate(90deg)" : "none" }}
                />
                <span
                  className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] text-[11px] font-extrabold"
                  style={{ background: "#eef6f1", color: "#0b7a4e" }}
                >
                  {initials(c.name)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                  <span className="truncate text-[14px] font-extrabold">{c.name}</span>
                  <span className="whitespace-nowrap text-[11px] font-semibold text-[#9a9fa4]">
                    {c.specialty ? `${c.specialty} · ` : ""}
                    {c.unpaidJobs > 0 ? `${c.unpaidJobs} unpaid` : "all paid ✓"}
                  </span>
                </span>
              </div>

              <span
                className="w-[86px] flex-none text-[12px] font-bold tabular-nums"
                style={{ color: c.clientPaidTally.paid === c.clientPaidTally.total && c.clientPaidTally.total > 0 ? "#1f9d57" : "#9a9fa4" }}
              >
                {c.clientPaidTally.paid} of {c.clientPaidTally.total}
              </span>

              <div className="w-[104px] flex-none text-[12px] font-bold">
                {inv.notApplicable ? (
                  <span className="text-[#c2c5c8]">doesn&rsquo;t invoice</span>
                ) : (
                  <span style={{ color: inv.complete ? "#0b7a4e" : "#9a9fa4" }}>
                    {inv.received} of {inv.expected}
                  </span>
                )}
              </div>

              <span className="w-[70px] flex-none text-[11.5px] font-semibold text-[#9a9fa4]">
                {c.readyNow > 0 ? "ready" : `by the ${c.payByDay}`}
              </span>

              <span
                className="w-[92px] flex-none text-right text-[14px] font-extrabold tabular-nums"
                style={{ color: c.readyNow > 0 ? "#0b7a4e" : "#c2c5c8" }}
              >
                {c.readyNow > 0 ? formatCurrency(c.readyNow) : "–"}
              </span>
              <span className="w-[84px] flex-none text-right text-[13px] font-semibold tabular-nums text-[#9a9fa4]">
                {formatCurrency(c.stillOwed)}
              </span>
            </div>

            {isOpen &&
              [...c.accounts]
                .sort((a, b) => a.clientName.localeCompare(b.clientName))
                .map(a => {
                  const unpaid = a.jobs.filter(j => !j.paid)
                  const amount = unpaid.reduce((s, j) => s + j.amount, 0)
                  const perClean = a.invoiceUnit === "PER_CLEAN"
                  const ticked = a.invoiceTally.received > 0 && a.invoiceTally.complete
                  return (
                    <div key={a.id}>
                    <div className="flex items-center gap-3 border-b border-[#f6f6f3] bg-[#fdfdfb] py-[9px] pl-[66px] pr-5">
                      <div className="min-w-0 flex-1 truncate text-[12.5px] font-bold">
                        {a.clientName}{" "}
                        <span className="text-[10.5px] font-semibold text-[#b6bbc0]">
                          {perClean
                            ? `${a.jobs.length} cleans · invoiced per clean`
                            : `${a.jobs.length} cleans · one invoice`}
                        </span>
                      </div>

                      <span
                        className="w-[86px] flex-none text-[11.5px] font-bold"
                        style={{ color: a.clientHasPaid ? "#1f9d57" : "#9a9fa4" }}
                      >
                        {a.clientHasPaid ? "✓ paid" : "not yet"}
                      </span>

                      <div className="w-[104px] flex-none">
                        {!c.invoicesUs ? (
                          <span className="text-[11px] font-semibold text-[#c2c5c8]">
                            n/a · doesn&rsquo;t invoice
                          </span>
                        ) : perClean ? (
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); toggleAccount(a.id) }}
                            title="Open to tick each clean off one by one"
                            className="text-[11.5px] font-bold tabular-nums underline decoration-dotted underline-offset-[3px]"
                            style={{ color: a.invoiceTally.complete ? "#0b7a4e" : "#9a9fa4" }}
                          >
                            {a.invoiceTally.received} of {a.invoiceTally.expected}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); setInvoiced(c, a, null, !ticked) }}
                            className="inline-flex items-center gap-2 py-0.5 text-[11.5px] font-bold"
                            style={{ color: ticked ? "#0b7a4e" : "#9a9fa4" }}
                          >
                            <span
                              className="flex h-[15px] w-[15px] flex-none items-center justify-center rounded-[4px] text-[10px] font-black text-white"
                              style={
                                ticked
                                  ? { background: "#0b7a4e", border: "1.5px solid #0b7a4e" }
                                  : { background: "#fff", border: "1.5px solid #c9cdd1" }
                              }
                            >
                              {ticked ? "✓" : ""}
                            </span>
                            {ticked ? "yes" : "not yet"}
                          </button>
                        )}
                      </div>

                      <span className="w-[70px] flex-none text-[11px] font-semibold text-[#9a9fa4]">
                        {unpaid[0] ? shortDate(unpaid[0].date) : "–"}
                      </span>

                      <div className="flex w-[92px] flex-none justify-end">
                        <StateCell jobs={unpaid} payByDay={c.payByDay} />
                      </div>

                      <span
                        className="w-[84px] flex-none text-right text-[12.5px] font-bold tabular-nums"
                        style={{ color: unpaid.length === 0 ? "#b6bbc0" : "#3f4347" }}
                      >
                        {formatCurrency(amount)}
                      </span>
                    </div>

                    {perClean && c.invoicesUs && openAccounts.has(a.id) &&
                      a.jobs.map(j => (
                        <div
                          key={j.id}
                          className="flex items-center gap-3 border-b border-[#f6f6f3] bg-[#fbfbf8] py-2 pl-[96px] pr-5"
                        >
                          <div className="min-w-0 flex-1 text-[11.5px] font-semibold text-[#6b6f73]">
                            {shortDate(j.date)}
                            {j.cancelled && (
                              <span className="ml-1.5 text-[10.5px] text-[#b45309]">cancelled · gas fee</span>
                            )}
                          </div>
                          <span className="w-[86px] flex-none" />
                          <div className="w-[104px] flex-none">
                            <button
                              type="button"
                              onClick={e => { e.stopPropagation(); setInvoiced(c, a, j.id, !j.invoiced) }}
                              disabled={j.paid}
                              className="inline-flex items-center gap-2 py-0.5 text-[11.5px] font-bold disabled:opacity-40"
                              style={{ color: j.invoiced ? "#0b7a4e" : "#9a9fa4" }}
                            >
                              <span
                                className="flex h-[15px] w-[15px] flex-none items-center justify-center rounded-[4px] text-[10px] font-black text-white"
                                style={
                                  j.invoiced
                                    ? { background: "#0b7a4e", border: "1.5px solid #0b7a4e" }
                                    : { background: "#fff", border: "1.5px solid #c9cdd1" }
                                }
                              >
                                {j.invoiced ? "✓" : ""}
                              </span>
                              {j.invoiced ? "yes" : "not yet"}
                            </button>
                          </div>
                          <span className="w-[70px] flex-none" />
                          <span className="w-[92px] flex-none text-right text-[11px] font-bold"
                            style={{ color: j.paid ? "#1f9d57" : j.state === "ready" ? "#0b7a4e" : "#9a9fa4" }}>
                            {j.paid ? "✓ paid" : j.state === "ready" ? "ready" : j.state === "needs-invoice" ? "needs invoice" : "on hold"}
                          </span>
                          <span
                            className="w-[84px] flex-none text-right text-[11.5px] font-bold tabular-nums"
                            style={{ color: j.paid ? "#b6bbc0" : "#3f4347" }}
                          >
                            {formatCurrency(j.amount)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )
                })}
          </div>
        )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-[#98a2b3]">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  return (
    <>
    {data && (
      <CleanersSummary
        totals={data.totals}
        cleanerCount={data.cleaners.length}
        payments={data.payments ?? []}
      />
    )}

    {/* Straight to a profile without hunting the table for the row. */}
    {rows.length > 0 && (
      <div className="mt-[18px] flex flex-wrap items-center gap-2">
        <span className="mr-0.5 text-[11px] font-extrabold uppercase tracking-[0.05em] text-[#9aa0a4]">
          Profiles
        </span>
        {(data?.cleaners ?? []).map(c => (
          <button
            key={c.id}
            type="button"
            onClick={() => onOpenProfile?.(c.id)}
            title="Open profile"
            className="inline-flex items-center gap-[7px] rounded-full border border-[#e2e2df] bg-white py-[5px] pl-1.5 pr-3 transition-all hover:-translate-y-px hover:border-[#c9d6cd] hover:bg-[#f1f5f0]"
          >
            <span
              className="grid h-[22px] w-[22px] place-items-center rounded-full text-[9.5px] font-extrabold"
              style={{ background: "#eef6f1", color: "#0b7a4e" }}
            >
              {initials(c.name)}
            </span>
            <span className="whitespace-nowrap text-[12px] font-bold text-[#3f4347]">
              {c.name.split(/\s+/)[0]}
            </span>
          </button>
        ))}
      </div>
    )}

    <div className="mt-3.5 flex items-center gap-3">
      <div className="relative w-[340px] max-w-full flex-none">
        <Search
          size={14}
          strokeWidth={2.2}
          className="pointer-events-none absolute left-[11px] top-1/2 -translate-y-1/2 text-[#9a9fa4]"
        />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search a client or cleaner"
          aria-label="Search a client or cleaner"
          className="w-full rounded-[8px] border border-[#e2e2df] bg-white py-[9px] pl-[34px] pr-8 text-[13px] font-semibold text-[#0d0d0e] outline-none focus:border-[#0b7a4e]"
        />
        {query.trim() && (
          <button
            type="button"
            onClick={() => setQuery("")}
            title="Clear search"
            aria-label="Clear search"
            className="absolute right-1 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center text-[#9a9fa4] hover:text-[#3f4347]"
          >
            <X size={14} />
          </button>
        )}
      </div>
      {query.trim() && (
        <span className="text-[12px] font-semibold text-[#8a8f93]">
          {rows.length} cleaner{rows.length === 1 ? "" : "s"} ·{" "}
          {rows.reduce((n, c) => n + c.accounts.length, 0)} matching accounts
        </span>
      )}
    </div>

    <div
      className="mt-3 overflow-clip rounded-[12px] border border-[#ececea] bg-white"
      style={{ boxShadow: "0 1px 2px rgba(0,0,0,.04), 0 6px 18px rgba(0,0,0,.05)" }}
    >
      <div
        className={`sticky top-0 z-[5] flex items-center gap-3 border-b border-[#ececea] bg-[#fafaf8] px-5 py-[11px] ${HEAD}`}
      >
        <Box
          checked={selection.length > 0 && selection.length === [...rows, ...vendorRows].filter(r => r.readyNow > 0).length}
          onClick={() => {
            const payable = [...rows, ...vendorRows].filter(r => r.readyNow > 0).map(r => r.id)
            setChecked(prev => (prev.size >= payable.length ? new Set() : new Set(payable)))
          }}
          label="Select every cleaner with money ready"
        />
        <button
          type="button"
          onClick={() => setSortBy(s => (s === "jobs" ? "name" : "jobs"))}
          className={`flex min-w-0 flex-1 select-none items-center gap-1 ${HEAD}`}
          title="Sort"
        >
          Cleaner
          <span className="font-semibold normal-case tracking-normal text-[#b6bbc0]">
            {sortBy === "jobs" ? "· by jobs" : "· A–Z"}
          </span>
        </button>
        <div className="w-[86px] flex-none">Client paid us?</div>
        <div
          className="w-[104px] flex-none"
          title="Cleaners send an invoice for each account · open a row to check them off one by one"
        >
          Did they send us an invoice?
        </div>
        <div className="w-[70px] flex-none">Due</div>
        <div className="w-[92px] flex-none text-right text-[#0b7a4e]">Ready now</div>
        <div className="w-[84px] flex-none text-right">Still owed</div>
      </div>

      {rows.length === 0 && vendorRows.length === 0 && (
        <div className="px-5 py-16 text-center text-[13px] text-[#8a8f93]">
          {query.trim()
            ? `Nothing matches “${query.trim()}” · check the spelling or try the cleaner’s name.`
            : "Nothing owed for this month."}
        </div>
      )}

      {rows.map(renderPayee)}

      {vendorRows.length > 0 && (
        <>
          <div className="flex items-baseline gap-2.5 border-b border-[#ececea] bg-[#fafaf8] px-5 pb-2 pt-2.5">
            <span className="text-[10px] font-extrabold uppercase tracking-[0.07em] text-[#98a2b3]">
              Vendor subcontractors
            </span>
            <span className="text-[11px] font-semibold text-[#c2c5c8]">
              Pressure washing, window washing &amp; other specialty work
            </span>
          </div>
          {vendorRows.map(renderPayee)}
        </>
      )}

      {data && (rows.length > 0 || vendorRows.length > 0) && (
        <div className="flex items-center gap-3 bg-[#fafaf8] px-5 py-3 text-[12px] font-bold">
          <div className="min-w-0 flex-1 text-[#6b6f73]">
            Total · {rows.length} cleaner{rows.length === 1 ? "" : "s"}
            {vendorRows.length > 0 && ` · ${vendorRows.length} vendor${vendorRows.length === 1 ? "" : "s"}`}
            {" · "}{data.totals.unpaidJobs} unpaid jobs
          </div>
          <span className="w-[86px] flex-none" />
          <span className="w-[104px] flex-none" />
          <span className="w-[70px] flex-none" />
          <span className="w-[92px] flex-none text-right text-[14px] font-extrabold tabular-nums text-[#0b7a4e]">
            {formatCurrency(data.totals.readyNow)}
          </span>
          <span className="w-[84px] flex-none text-right tabular-nums text-[#9a9fa4]">
            {formatCurrency(data.totals.stillOwed)}
          </span>
        </div>
      )}
    </div>

    <BatchPayBar
      selection={selection}
      onClear={() => setChecked(new Set())}
      onDone={() => mutate()}
    />
    </>
  )
}

/**
 * The row checkbox. Disabled when a cleaner has nothing ready, because
 * selecting them would put an unpayable line into the review.
 */
function Box({ checked, onClick, label, disabled, stop }: {
  checked: boolean
  onClick: () => void
  label: string
  disabled?: boolean
  /** Stops the click reaching the row, which would expand it instead. */
  stop?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={checked}
      disabled={disabled}
      onClick={e => { if (stop) e.stopPropagation(); onClick() }}
      className="flex h-[17px] w-[17px] flex-none items-center justify-center rounded-[5px] disabled:cursor-not-allowed disabled:opacity-30"
      style={
        checked
          ? { background: "#0b7a4e", border: "1.5px solid #0b7a4e" }
          : { background: "#fff", border: "1.5px solid #c9cdd1" }
      }
    >
      {checked && (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff"
          strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="m5 12 5 5L20 7" />
        </svg>
      )}
    </button>
  )
}

/**
 * What the account is waiting on, taken from its worst job — the thing that
 * has to change before any of it can be paid.
 */
function StateCell({ jobs, payByDay }: { jobs: JobRow[]; payByDay: number }) {
  if (jobs.length === 0) {
    return <span className="text-[11px] font-bold text-[#1f9d57]">&#10003; paid</span>
  }
  if (jobs.some(j => j.state === "needs-invoice")) {
    return <span className="text-[11px] font-bold text-[#b45309]">needs invoice</span>
  }
  if (jobs.every(j => j.state === "ready")) {
    return (
      <span
        className="text-[11px] font-extrabold"
        style={{
          color: "#0b7a4e",
          background: "#e9f7ef",
          border: "1px solid #bfe4cd",
          padding: "4px 10px",
          borderRadius: 999,
        }}
      >
        ready
      </span>
    )
  }
  return <span className="text-[11px] font-bold text-[#9a9fa4]">pay by the {payByDay}</span>
}
