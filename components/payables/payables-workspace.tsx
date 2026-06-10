"use client"

import { useState } from "react"
import { UserCog, Package, Loader2, Plus } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import { usePayables, type Payable, type PayableAccount, type AccountStatus } from "./use-payables"
import { PaymentDetail } from "./payment-detail"
import { PersonModal } from "./person-modal"

const STATUS: Record<AccountStatus, { dot: string; label: string; bg: string; text: string }> = {
  safe: { dot: "#10B981", label: "Ready", bg: "#ECFDF5", text: "#047857" },
  waiting: { dot: "#F59E0B", label: "Waiting", bg: "#FFFBEB", text: "#B45309" },
  partial: { dot: "#0EA5E9", label: "Partial", bg: "#EFF6FF", text: "#1D4ED8" },
}

function monthLabel(): string {
  return new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })
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

  return (
    <div className="min-h-screen bg-stone-50" style={{ fontFamily: "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&display=swap');`}</style>

      {/* TopBar */}
      <div className="border-b border-stone-200 bg-white">
        <div className="mx-auto w-full max-w-[1200px] px-4 sm:px-6 pt-5 pb-3">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-[20px] font-bold text-stone-900">Payables</h1>
            <div className="flex items-center gap-3">
              <span className="hidden text-[12px] font-semibold uppercase tracking-wide text-stone-400 sm:inline">This month · {monthLabel()}</span>
              <button onClick={() => setAddType(tab === "cleaners" ? "cleaner" : "vendor")}
                className="inline-flex items-center gap-1.5 rounded-md bg-stone-900 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-stone-800">
                <Plus size={13} /> Add {tab === "cleaners" ? "cleaner" : "vendor"}
              </button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
            <Stat label="Total owed" value={totals.total} />
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
        ) : list.length === 0 ? (
          <div className="rounded-lg border border-stone-200 bg-white px-6 py-16 text-center">
            <p className="text-[14px] font-semibold text-stone-700">Nothing owed to {tab === "cleaners" ? "cleaners" : "vendors"} right now</p>
            <p className="mt-1 text-[12px] text-stone-400">Completed work that hasn&apos;t been paid will show up here.</p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
            <div className="space-y-3">
              {list.map((p) => (
                <PayableCard key={p.id} payable={p} selected={selected?.id === p.id} onSelect={() => ws.setSelectedId(p.id)} />
              ))}
            </div>
            <div className="lg:sticky lg:top-4 lg:self-start">
              <PaymentDetail payable={selected} onPaid={() => ws.mutate()} />
            </div>
          </div>
        )}
      </div>

      {addType && <PersonModal type={addType} onClose={() => setAddType(null)} onSaved={() => ws.mutate()} />}
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

