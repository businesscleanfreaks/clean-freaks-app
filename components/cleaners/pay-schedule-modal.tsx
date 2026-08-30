"use client"

import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import useSWR from "swr"
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react"
import { fetcher } from "@/lib/fetcher"
import { showError } from "@/lib/toast"
import { avatarColor, initialsOf } from "@/lib/avatar-palette"

interface Subcontractor {
  id: string
  name: string
  isActive: boolean
  invoicesUs: boolean
  payByDay: number
}

interface Account {
  id: string
  clientName: string
  invoiceUnit: "PER_ACCOUNT" | "PER_CLEAN"
  jobs: { id: string }[]
}

interface PayeeData {
  id: string
  name: string
  accounts: Account[]
}

interface CleanersData {
  cleaners: PayeeData[]
  vendors: PayeeData[]
}

/** 1st, 2nd, 3rd, 4th … for the day a cleaner is paid by. */
export function ordinal(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1: return `${n}st`
    case 2: return `${n}nd`
    case 3: return `${n}rd`
    default: return `${n}th`
  }
}

const ONE_OFF_OPTS: [number, string][] = [
  [0, "Same day"],
  [2, "2 days"],
  [5, "5 days"],
  [7, "7 days"],
]

const segStyle = (on: boolean): React.CSSProperties => ({
  background: on ? "#fff" : "transparent",
  color: on ? "#1a1c1e" : "#9a9fa4",
  boxShadow: on ? "0 1px 3px rgba(16,24,40,.12)" : undefined,
})

/**
 * Pay schedule — when each cleaner and vendor gets paid, and whether they
 * invoice us.
 *
 * These settings decide what the table calls "ready", so they need somewhere to
 * be changed. The day grid stops at 28 on purpose: a pay-by day of the 30th
 * would go missing every February.
 */
export function PayScheduleModal({ open, onClose, period }: {
  open: boolean
  onClose: () => void
  period: string
}) {
  const { data: subs, mutate, isLoading } = useSWR<Subcontractor[]>(
    open ? "/api/subcontractors" : null,
    fetcher,
    { revalidateOnFocus: false },
  )
  // Job counts and accounts come from the same feed the table reads.
  const { data: work } = useSWR<CleanersData>(
    open ? `/api/cleaners/data?period=${period}` : null,
    fetcher,
    { revalidateOnFocus: false },
  )

  const [tab, setTab] = useState<"cleaners" | "vendors">("cleaners")
  const [dayOpenFor, setDayOpenFor] = useState<string | null>(null)
  // The picker is portalled to the body: inside the scrolling list it was
  // clipped, hiding days 22-28 for rows near the bottom.
  const [dayAt, setDayAt] = useState<{ top: number; right: number } | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [oneOffDays, setOneOffDays] = useState(5)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (dayOpenFor) setDayOpenFor(null)
      else onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, dayOpenFor, onClose])

  const cleaners = useMemo(() => (subs ?? []).filter(c => c.isActive), [subs])
  const vendors = work?.vendors ?? []

  const accountsFor = (id: string) =>
    work?.cleaners.find(c => c.id === id)?.accounts
    ?? work?.vendors.find(v => v.id === id)?.accounts
    ?? []

  const patch = async (id: string, body: Record<string, unknown>) => {
    setSaving(id)
    try {
      const res = await fetch(`/api/subcontractors/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        throw new Error(err?.error || "Could not save")
      }
      mutate()
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not save")
    } finally {
      setSaving(null)
    }
  }

  if (!open || typeof document === "undefined") return null

  const rows: { id: string; name: string; invoicesUs: boolean; payByDay: number; editable: boolean }[] =
    tab === "cleaners"
      ? cleaners.map(c => ({ ...c, editable: true }))
      // Vendors always invoice per job and are paid on the one-off rule, so
      // there is no per-vendor day to set — shown for completeness, not editing.
      : vendors.map(v => ({ id: v.id, name: v.name, invoicesUs: true, payByDay: oneOffDays, editable: false }))

  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[80] flex items-start justify-center px-4"
      style={{ background: "rgba(16,24,40,0.34)", paddingTop: "6vh", paddingBottom: "6vh" }}
      role="dialog"
      aria-modal="true"
      aria-label="Pay schedule"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="flex w-[820px] max-w-full flex-col rounded-[16px] bg-white"
        style={{ maxHeight: "84vh", boxShadow: "0 24px 64px rgba(16,24,40,.22)" }}
      >
        <div className="flex flex-none items-start gap-3 px-[26px] pb-3.5 pt-[22px]">
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-extrabold">Pay schedule</div>
            <div className="mt-1 text-[12.5px] leading-[1.5] text-[#7d8795]">
              When each job pays its cleaner or vendor. Change it here · this page sorts itself.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex-none px-1.5 py-0.5 text-[18px] leading-none text-[#98a2b3] hover:text-[#3f4347]"
          >
            ×
          </button>
        </div>

        {/* The default that every new one-off job inherits. */}
        <div className="mx-[26px] mb-3.5 flex flex-none items-center gap-3.5 rounded-[10px] border border-[#ececea] bg-[#fafaf8] px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-extrabold">One-offs &amp; residential</div>
            <div className="mt-0.5 text-[11.5px] font-semibold text-[#9a9fa4]">
              Default for every new one-off job · you can change it on a single job when you log it.
            </div>
          </div>
          <div className="flex flex-none gap-0 rounded-[9px] bg-[#f2f3f1] p-[3px]">
            {ONE_OFF_OPTS.map(([days, label]) => (
              <button
                key={days}
                type="button"
                onClick={() => setOneOffDays(days)}
                className="flex-none whitespace-nowrap rounded-[6px] px-3 py-1.5 text-[11.5px] font-bold"
                style={segStyle(oneOffDays === days)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-[26px] pb-5">
          <div className="flex items-center gap-3 pb-3 pt-0.5">
            <div className="flex rounded-[9px] bg-[#f2f3f1] p-[3px]">
              {(["cleaners", "vendors"] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setTab(t); setExpanded(null); setDayOpenFor(null) }}
                  className="flex-none whitespace-nowrap rounded-[6px] px-3.5 py-1.5 text-[12px] font-bold capitalize"
                  style={segStyle(tab === t)}
                >
                  {t} · {t === "cleaners" ? cleaners.length : vendors.length}
                </button>
              ))}
            </div>
          </div>

          {isLoading && (
            <div className="flex items-center justify-center py-16 text-[#98a2b3]">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}

          {rows.map(r => {
            const color = avatarColor(r.name)
            const accounts = accountsFor(r.id)
            const isOpen = expanded === r.id
            return (
              <div key={r.id}>
                <div
                  onClick={() => setExpanded(v => (v === r.id ? null : r.id))}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === "Enter") setExpanded(v => (v === r.id ? null : r.id)) }}
                  className="flex cursor-pointer items-center gap-[11px] border-t border-[#ececea] px-0.5 py-[13px]"
                >
                  <ChevronRight
                    size={14}
                    strokeWidth={2.6}
                    className="flex-none text-[#8a8f93] transition-transform"
                    style={{ transform: isOpen ? "rotate(90deg)" : "none" }}
                  />
                  <span
                    className="flex h-[28px] w-[28px] flex-none items-center justify-center rounded-[8px] text-[10.5px] font-extrabold"
                    style={{ background: color.bg, color: color.fg }}
                  >
                    {initialsOf(r.name)}
                  </span>
                  <span className="text-[14px] font-extrabold">{r.name}</span>
                  <span className="text-[12px] font-semibold text-[#9a9fa4]">
                    {accounts.length} job{accounts.length === 1 ? "" : "s"}
                  </span>

                  <span
                    onClick={e => e.stopPropagation()}
                    className="ml-auto flex flex-none items-center gap-2"
                  >
                    <span
                      className="text-[11px] font-semibold text-[#9a9fa4]"
                      title="We pay this cleaner by this day of the month, no matter what · earlier if the client already paid"
                    >
                      Pay by the
                    </span>
                    <span className="relative inline-flex">
                      <button
                        type="button"
                        disabled={!r.editable}
                        onClick={e => {
                          if (dayOpenFor === r.id) { setDayOpenFor(null); return }
                          const b = (e.currentTarget as HTMLElement).getBoundingClientRect()
                          const PICKER_H = 200
                          const below = window.innerHeight - b.bottom
                          setDayAt({
                            top: below < PICKER_H ? Math.max(8, b.top - PICKER_H - 6) : b.bottom + 6,
                            right: Math.max(8, window.innerWidth - b.right),
                          })
                          setDayOpenFor(r.id)
                        }}
                        className="inline-flex items-center gap-1.5 rounded-[7px] border border-[#e2e2df] bg-white px-2.5 py-[5px] text-[12px] font-extrabold text-[#1a1c1e] hover:bg-[#f6f6f3] disabled:opacity-40"
                      >
                        <span className="tabular-nums">{ordinal(r.payByDay)}</span>
                        <ChevronDown size={10} strokeWidth={2.8} className="text-[#8a8f93]" />
                      </button>

                      {dayOpenFor === r.id && dayAt && createPortal(
                        <>
                          <div className="fixed inset-0 z-[89]" onClick={() => setDayOpenFor(null)} />
                          <div
                            className="fixed z-[90] w-[238px] rounded-[12px] border border-[#e2e2df] bg-white p-2.5"
                            style={{
                              top: dayAt.top,
                              right: dayAt.right,
                              boxShadow: "0 4px 10px rgba(16,24,40,.06), 0 16px 40px rgba(16,24,40,.14)",
                            }}
                          >
                            <div className="mb-2 text-[10.5px] font-extrabold uppercase tracking-[0.05em] text-[#9aa0a4]">
                              Day of the month we pay by
                            </div>
                            <div className="grid grid-cols-7 gap-[3px]">
                              {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                                <button
                                  key={d}
                                  type="button"
                                  onClick={() => { patch(r.id, { payByDay: d }); setDayOpenFor(null) }}
                                  className="rounded-[6px] py-1.5 text-[11.5px] font-bold tabular-nums"
                                  style={
                                    d === r.payByDay
                                      ? { background: "#15793f", color: "#fff" }
                                      : { color: "#6b6f73" }
                                  }
                                >
                                  {d}
                                </button>
                              ))}
                            </div>
                          </div>
                        </>,
                        document.body,
                      )}
                    </span>
                  </span>

                  <button
                    type="button"
                    disabled={!r.editable || saving === r.id}
                    onClick={e => { e.stopPropagation(); patch(r.id, { invoicesUs: !r.invoicesUs }) }}
                    title="Off means this cleaner doesn't send invoices · their jobs never wait on one"
                    className="ml-4 flex flex-none items-center gap-2 disabled:opacity-40"
                  >
                    <span className="whitespace-nowrap text-[11px] font-semibold text-[#9a9fa4]">
                      Invoices us?
                    </span>
                    <span
                      className="relative h-[20px] w-[34px] flex-none rounded-full transition-colors"
                      style={{ background: r.invoicesUs ? "#15793f" : "#e2e2df" }}
                    >
                      <span
                        className="absolute left-[2px] top-[2px] h-4 w-4 rounded-full bg-white"
                        style={{
                          boxShadow: "0 1px 2px rgba(0,0,0,.25)",
                          transform: `translateX(${r.invoicesUs ? 14 : 0}px)`,
                          transition: "transform .18s cubic-bezier(.2,.7,.3,1)",
                        }}
                      />
                    </span>
                  </button>
                </div>

                {isOpen && (
                  <>
                    <div className="flex items-center gap-3.5 py-2 pl-[41px] pr-0.5 text-[10px] font-extrabold uppercase tracking-[0.07em] text-[#c2c5c8]">
                      <div className="flex-1">Job</div>
                      <div className="w-[288px] flex-none">Invoiced</div>
                    </div>
                    {accounts.map(a => (
                      <div
                        key={a.id}
                        className="flex items-center gap-3.5 border-b border-[#f6f6f3] py-2.5 pl-[41px] pr-0.5"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-bold">{a.clientName}</div>
                          <div className="mt-px text-[11px] text-[#9a9fa4]">
                            {a.jobs.length} clean{a.jobs.length === 1 ? "" : "s"} this month
                          </div>
                        </div>
                        <div className="w-[288px] flex-none text-[11.5px] font-semibold text-[#6b6f73]">
                          {a.invoiceUnit === "PER_CLEAN"
                            ? "Invoiced per clean"
                            : "One invoice a month"}
                        </div>
                      </div>
                    ))}
                    {accounts.length === 0 && (
                      <div className="py-3 pl-[41px] text-[12px] text-[#9a9fa4]">
                        No work this month.
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}

          {!isLoading && rows.length === 0 && (
            <div className="py-16 text-center text-[13px] text-[#8a8f93]">
              No active {tab}.
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
