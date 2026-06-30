"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { UserCog, Package, Loader2, Plus, ChevronLeft, ChevronRight, ChevronDown, Inbox } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import { usePayables, type Payable, type PayableAccount, type AccountStatus, type PaidEntry } from "./use-payables"
import { PaymentDetail } from "./payment-detail"
import { PersonModal } from "./person-modal"

const STATUS: Record<AccountStatus, { dot: string; label: string; bg: string; text: string }> = {
  safe: { dot: "#10B981", label: "Ready", bg: "#ECFDF5", text: "#047857" },
  waiting: { dot: "#F59E0B", label: "Waiting", bg: "#FFFBEB", text: "#B45309" },
  partial: { dot: "#0EA5E9", label: "Partial", bg: "#EFF6FF", text: "#1D4ED8" },
  "pay-today": { dot: "#DC2626", label: "Pay today", bg: "#FEF2F2", text: "#B91C1C" },
}

function formatMonthLabel(period: string): string {
  const [y, m] = period.split("-").map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })
}

function Avatar({ initials }: { initials: string }) {
  return (
    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-stone-200 text-[12px] font-bold text-stone-600">
      {initials}
    </span>
  )
}

export function PayablesWorkspace() {
  const ws = usePayables()
  const { tab, setTab, list, totals, selected, counts, isLoading, error } = ws
  const [addType, setAddType] = useState<"cleaner" | "vendor" | null>(null)
  const [editPayable, setEditPayable] = useState<Payable | null>(null)
  const [reviewCount, setReviewCount] = useState(0)

  useEffect(() => {
    fetch("/api/payments/inbox")
      .then((r) => (r.ok ? r.json() : { count: 0 }))
      .then((d) => setReviewCount(d.count || 0))
      .catch(() => {})
  }, [])

  return (
    <div className="min-h-screen bg-stone-50" style={{ fontFamily: "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&display=swap');`}</style>

      {/* TopBar */}
      <div className="border-b border-stone-200 bg-white">
        <div className="mx-auto w-full max-w-[1200px] px-4 sm:px-6 pt-5 pb-3">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-[20px] font-bold text-stone-900">Payables</h1>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-0.5">
                <button onClick={() => ws.shiftMonth(-1)} className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700"><ChevronLeft size={16} /></button>
                <span className="min-w-[116px] text-center text-[13px] font-semibold text-stone-700">{formatMonthLabel(ws.month)}</span>
                <button onClick={() => ws.shiftMonth(1)} disabled={ws.isCurrent}
                  className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30 disabled:hover:bg-transparent"><ChevronRight size={16} /></button>
              </div>
              <Link href="/payables/payments"
                className="relative inline-flex items-center gap-1.5 rounded-md border border-stone-300 px-3 py-1.5 text-[12px] font-semibold text-stone-700 hover:bg-stone-50">
                <Inbox size={13} /> Payments
                {reviewCount > 0 && (
                  <span className="ml-0.5 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">{reviewCount}</span>
                )}
              </Link>
              <button onClick={() => setAddType(tab === "cleaners" ? "cleaner" : "vendor")}
                className="inline-flex items-center gap-1.5 rounded-md bg-stone-900 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-stone-800">
                <Plus size={13} /> Add {tab === "cleaners" ? "cleaner" : "vendor"}
              </button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
            <Stat label="Total owed" value={totals.total} />
            {totals.payToday > 0 && <Stat label="Pay today" value={totals.payToday} color="#B91C1C" />}
            <Stat label="Ready to pay" value={totals.safe} color="#047857" />
            <Stat label="Waiting on client" value={totals.waiting} color="#B45309" />
          </div>
        </div>
        {/* Tabs */}
        <div className="mx-auto w-full max-w-[1200px] px-4 sm:px-6">
          <div className="flex items-center gap-1">
            <TabButton active={tab === "cleaners"} onClick={() => setTab("cleaners")} icon={<UserCog size={14} />} label="Cleaners" count={counts.cleaners} />
            <TabButton active={tab === "vendors"} onClick={() => setTab("vendors")} icon={<Package size={14} />} label="Vendors" count={counts.vendors} />
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="mx-auto w-full max-w-[1200px] px-4 sm:px-6 py-5">
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-stone-400"><Loader2 size={18} className="mr-2 animate-spin" /> Loading payables…</div>
        ) : error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">Failed to load payables.</div>
        ) : (
          <div className="space-y-6">
            {ws.isCurrent ? (
              list.length === 0 && ws.others.length === 0 ? (
                <div className="rounded-lg border border-stone-200 bg-white px-6 py-16 text-center">
                  <p className="text-[14px] font-semibold text-stone-700">No {tab === "cleaners" ? "cleaners" : "vendors"} yet</p>
                  <p className="mt-1 text-[12px] text-stone-400">Add one above — completed unpaid work will then show up here.</p>
                </div>
              ) : (
                <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
                  <div className="space-y-3">
                    {list.map((p) => (
                      <PayableCard key={p.id} payable={p} selected={selected?.id === p.id} onSelect={() => ws.setSelectedId(p.id)} />
                    ))}
                    {list.length === 0 && (
                      <p className="rounded-lg border border-stone-200 bg-white px-4 py-3 text-[13px] text-stone-500">Nothing owed to {tab === "cleaners" ? "cleaners" : "vendors"} right now.</p>
                    )}
                    {ws.others.length > 0 && (
                      <AllPeopleSection others={ws.others} tab={tab} selectedId={selected?.id ?? null} onSelect={(id) => ws.setSelectedId(id)} />
                    )}
                  </div>
                  <div className="lg:sticky lg:top-4 lg:self-start">
                    <PaymentDetail payable={selected} onPaid={() => ws.mutate()} onEdit={setEditPayable} />
                  </div>
                </div>
              )
            ) : (
              <div className="rounded-lg border border-stone-200 bg-white px-6 py-5 text-center text-[12px] text-stone-500">
                Viewing {formatMonthLabel(ws.month)}. Amounts owed are tracked against the current month — below is what was paid in {formatMonthLabel(ws.month)}.
              </div>
            )}
            <PaidSection entries={ws.paidForTab} period={ws.month} tab={tab} />
          </div>
        )}
      </div>

      {addType && <PersonModal type={addType} onClose={() => setAddType(null)} onSaved={() => ws.mutate()} />}
      {editPayable && (
        <PersonModal type={editPayable.type} mode="edit" editId={editPayable.id} onClose={() => setEditPayable(null)} onSaved={() => ws.mutate()} />
      )}
    </div>
  )
}

// Collapsed directory of everyone with nothing owed right now — so Payables can
// reach (view/edit/history) any cleaner or vendor, not just those we currently owe.
function AllPeopleSection({ others, tab, selectedId, onSelect }: { others: Payable[]; tab: "cleaners" | "vendors"; selectedId: string | null; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-stone-50">
        <span className="text-[12px] font-semibold text-stone-600">All {tab === "cleaners" ? "cleaners" : "vendors"} <span className="font-normal text-stone-400">· {others.length} with nothing owed</span></span>
        <ChevronDown size={15} className={`text-stone-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-stone-100">
          {others.map((p) => (
            <button key={p.id} onClick={() => onSelect(p.id)}
              className={`flex w-full items-center gap-3 border-b border-stone-50 px-4 py-2.5 text-left last:border-b-0 hover:bg-stone-50 ${selectedId === p.id ? "bg-stone-100" : ""}`}>
              <Avatar initials={p.initials} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-stone-800">{p.name}</div>
                <div className="truncate text-[11px] text-stone-400">{p.zelleEmail || "No Zelle email saved"}</div>
              </div>
              <span className="flex-shrink-0 text-[11px] text-stone-300">Nothing owed</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">{label}</div>
      <div className="font-mono text-[20px] font-bold" style={{ color: color || "#1C1917" }}>{formatCurrency(value)}</div>
    </div>
  )
}

function TabButton({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count: number }) {
  return (
    <button onClick={onClick} className="relative inline-flex items-center gap-1.5 px-3 py-2.5 text-[13px] font-medium transition-colors" style={{ color: active ? "#1C1917" : "#A8A29E" }}>
      {icon}
      {label}
      <span className="rounded-full bg-stone-100 px-1.5 text-[10px] font-semibold text-stone-500">{count}</span>
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-stone-900" style={{ opacity: active ? 1 : 0 }} />
    </button>
  )
}

function PayableCard({ payable, selected, onSelect }: { payable: Payable; selected: boolean; onSelect: () => void }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-white" style={{ borderColor: selected ? "#A8A29E" : "#E7E5E4" }}>
      <button onClick={onSelect} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-stone-50">
        <Avatar initials={payable.initials} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-stone-900">{payable.name}</div>
          <div className="truncate text-[11px] text-stone-400">
            {payable.zelleEmail || <span className="text-amber-600">No Zelle email saved</span>}
          </div>
        </div>
        <div className="flex-shrink-0 text-right">
          <div className="font-mono text-[14px] font-bold text-stone-900">{formatCurrency(payable.total)}</div>
          <div className="text-[10px] text-stone-400">
            {payable.waiting > 0 ? <span className="text-amber-600">{formatCurrency(payable.waiting)} waiting</span> : "all ready"}
          </div>
        </div>
      </button>
      <div className="border-t border-stone-100">
        {payable.accounts.map((acc) => <AccountRow key={acc.id} account={acc} />)}
      </div>
    </div>
  )
}

function AccountRow({ account }: { account: PayableAccount }) {
  const st = STATUS[account.status]
  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-stone-50 last:border-b-0">
      <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: st.dot }} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] text-stone-800">{account.clientName}</div>
        <div className="truncate text-[11px]" style={{ color: account.status === "safe" ? "#A8A29E" : st.text }}>{account.reason}</div>
      </div>
      <span className="flex-shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide" style={{ background: st.bg, color: st.text }}>{st.label}</span>
      <span className="w-[64px] flex-shrink-0 text-right font-mono text-[12.5px] font-semibold text-stone-800">{formatCurrency(account.owed)}</span>
    </div>
  )
}

function PaidSection({ entries, period, tab }: { entries: PaidEntry[]; period: string; tab: "cleaners" | "vendors" }) {
  const total = entries.reduce((s, e) => s + e.amount, 0)
  return (
    <section className="rounded-lg border border-stone-200 bg-white">
      <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">{tab === "cleaners" ? "Cleaners" : "Vendors"} paid · {formatMonthLabel(period)}</span>
        <span className="font-mono text-[13px] font-bold text-stone-700">{formatCurrency(total)}</span>
      </div>
      {entries.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12px] text-stone-400">No {tab === "cleaners" ? "cleaner" : "vendor"} payments recorded this month.</p>
      ) : (
        <div className="divide-y divide-stone-50">
          {entries.map((e) => (
            <div key={e.paymentId} className="flex items-center gap-3 px-4 py-2.5">
              <Avatar initials={e.initials} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-stone-800">{e.name}</div>
                <div className="truncate text-[11px] text-stone-400">
                  {new Date(e.datePaid).toLocaleDateString("en-US", { month: "short", day: "numeric" })}{e.notes ? ` · ${e.notes}` : ""}
                </div>
              </div>
              <span className="flex-shrink-0 font-mono text-[13px] font-semibold text-emerald-700">{formatCurrency(e.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

