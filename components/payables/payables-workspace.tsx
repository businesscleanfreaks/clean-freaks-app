"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import {
  Building2,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Home,
  Inbox,
  Loader2,
  Package,
  Plus,
  Users,
} from "lucide-react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { formatCurrency } from "@/lib/utils"
import { showApiError, showError, showSuccess } from "@/lib/toast"
import { usePayables, type PaidEntry, type Payable, type PayableAccount, type PayablesTab } from "./use-payables"
import { InvoiceIntakePanel, PaymentDetail } from "./payment-detail"
import { PersonModal } from "./person-modal"

type WorkView = "outstanding" | "paid"
type WorkFilter = "all" | "ready" | "waiting" | "invoice"

const AVATAR_COLORS = ["#3976d3", "#0f8a81", "#e36b2c", "#7a5bc7", "#b45484", "#3b8b61"]

function formatMonthLabel(period: string): string {
  const [year, month] = period.split("-").map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })
}

function avatarColor(name: string): string {
  const value = Array.from(name).reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return AVATAR_COLORS[value % AVATAR_COLORS.length]
}

function isInvoiceBlocked(account: PayableAccount): boolean {
  return account.safeOwed > 0 && (account.payeeInvoiceStatus === "missing" || account.payeeInvoiceStatus === "mismatch")
}

function amountForFilter(account: PayableAccount, filter: WorkFilter): number {
  if (filter === "ready") return !isInvoiceBlocked(account) ? account.safeOwed : 0
  if (filter === "waiting") return account.waitingOwed
  if (filter === "invoice") return isInvoiceBlocked(account) ? account.safeOwed : 0
  return account.owed
}

function accountsForFilter(payable: Payable, filter: WorkFilter): PayableAccount[] {
  return payable.accounts.filter((account) => amountForFilter(account, filter) > 0)
}

function monthPaymentFor(entries: PaidEntry[], name: string): number {
  return entries.filter((entry) => entry.name === name).reduce((sum, entry) => sum + entry.amount, 0)
}

function accountDisplayName(name: string): string {
  const separator = " — "
  const separatorIndex = name.indexOf(separator)
  if (separatorIndex === -1) return name

  const clientName = name.slice(0, separatorIndex).trim()
  const locationName = name.slice(separatorIndex + separator.length).trim()
  return clientName.localeCompare(locationName, undefined, { sensitivity: "accent" }) === 0
    ? clientName
    : name
}

export function PayablesWorkspace() {
  const workspace = usePayables()
  const { tab, setTab, list, totals, isLoading, error } = workspace
  const [view, setView] = useState<WorkView>("outstanding")
  const [filter, setFilter] = useState<WorkFilter>("all")
  const [addType, setAddType] = useState<"cleaner" | "vendor" | null>(null)
  const [editPayable, setEditPayable] = useState<Payable | null>(null)
  const [paymentTarget, setPaymentTarget] = useState<{ payable: Payable; accountId: string | null } | null>(null)
  const [invoiceTarget, setInvoiceTarget] = useState<{ payable: Payable; account: PayableAccount } | null>(null)
  const [reviewCount, setReviewCount] = useState(0)
  const [markingClientPaid, setMarkingClientPaid] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/payments/inbox")
      .then((response) => (response.ok ? response.json() : { count: 0 }))
      .then((data) => setReviewCount(data.count || 0))
      .catch(() => {})
  }, [])

  useEffect(() => {
    setFilter("all")
    setView(workspace.isCurrent ? "outstanding" : "paid")
  }, [tab, workspace.month, workspace.isCurrent])

  const paidTotal = workspace.paidForTab.reduce((sum, entry) => sum + entry.amount, 0)
  const monthTotal = totals.total + paidTotal
  const progress = monthTotal > 0 ? Math.min(100, (paidTotal / monthTotal) * 100) : 0
  const allAccounts = list.flatMap((payable) => payable.accounts)
  const readyAmount = allAccounts.reduce((sum, account) => sum + (!isInvoiceBlocked(account) ? account.safeOwed : 0), 0)
  const waitingAmount = allAccounts.reduce((sum, account) => sum + account.waitingOwed, 0)
  const invoiceAmount = allAccounts.reduce((sum, account) => sum + (isInvoiceBlocked(account) ? account.safeOwed : 0), 0)
  const outstandingItemCount = new Set(allAccounts.flatMap((account) => account.allItemIds)).size
  const filteredPayables = useMemo(
    () => list.filter((payable) => accountsForFilter(payable, filter).length > 0),
    [filter, list],
  )
  const payeeLabel = tab === "cleaners" ? "cleaners" : "vendors"
  const singularPayee = tab === "cleaners" ? "cleaner" : "vendor"

  const changeTab = (next: PayablesTab) => {
    setTab(next)
    workspace.setSelectedId(null)
  }

  const markClientInvoicesPaid = async (payable: Payable, account: PayableAccount) => {
    if (account.clientInvoiceIds.length === 0) return
    if (!window.confirm(`Mark the linked client invoice${account.clientInvoiceIds.length === 1 ? "" : "s"} for ${account.clientName} as paid?`)) return

    setMarkingClientPaid(account.id)
    try {
      for (const invoiceId of account.clientInvoiceIds) {
        const response = await fetch(`/api/invoices/${invoiceId}/mark-paid`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paymentMethod: "MANUAL",
            paymentNotes: `Marked paid from Payables for ${payable.name}`,
          }),
        })
        if (!response.ok) {
          await showApiError(response, "Failed to mark the client invoice paid")
          return
        }
      }
      showSuccess(`${account.clientName} marked paid - ${payable.name}'s payout was recalculated`)
      await workspace.mutate()
    } catch {
      showError("Failed to mark the client invoice paid")
    } finally {
      setMarkingClientPaid(null)
    }
  }

  return (
    <div className="min-h-full overflow-y-auto bg-[var(--cf-canvas)] pb-24 text-[var(--cf-ink)] md:pb-8">
      <div className="mx-auto w-full max-w-[1120px] px-4 py-5 sm:px-7 sm:py-7 lg:px-9">
        <header className="flex flex-col gap-4 border-b border-[#2d2a25] pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-[30px] font-extrabold leading-none">Payables</h1>
            <p className="mt-2 text-[14px] font-medium text-[var(--cf-ink-secondary)]">
              What you owe {payeeLabel} in {formatMonthLabel(workspace.month)}
            </p>
            <div className="mt-4 inline-flex rounded-lg border border-[var(--cf-rule)] bg-white p-1 shadow-[var(--cf-panel-shadow)]">
              <PayeeSwitch active={tab === "cleaners"} icon={<Users size={14} />} label="Cleaners" onClick={() => changeTab("cleaners")} />
              <PayeeSwitch active={tab === "vendors"} icon={<Package size={14} />} label="Vendors" onClick={() => changeTab("vendors")} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <div className="inline-flex h-11 items-center overflow-hidden rounded-lg border border-[var(--cf-rule)] bg-white shadow-[var(--cf-panel-shadow)]">
              <button onClick={() => workspace.shiftMonth(-1)} className="grid h-full w-10 place-items-center border-r border-[var(--cf-rule-soft)] text-stone-500 hover:bg-[var(--cf-surface-hover)]" aria-label="Previous month">
                <ChevronLeft size={17} />
              </button>
              <span className="min-w-[124px] px-3 text-center text-[13px] font-bold">{formatMonthLabel(workspace.month)}</span>
              <button onClick={() => workspace.shiftMonth(1)} disabled={workspace.isCurrent} className="grid h-full w-10 place-items-center border-l border-[var(--cf-rule-soft)] text-stone-500 hover:bg-[var(--cf-surface-hover)] disabled:opacity-30" aria-label="Next month">
                <ChevronRight size={17} />
              </button>
            </div>
            <Link href="/payables/payments" className="relative grid h-11 w-11 place-items-center rounded-lg border border-[var(--cf-rule)] bg-white text-stone-600 shadow-[var(--cf-panel-shadow)] hover:bg-[var(--cf-surface-hover)]" title="Payments to review">
              <Inbox size={17} />
              {reviewCount > 0 && <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-[#c4420c] px-1.5 py-0.5 text-center text-[10px] font-extrabold text-white">{reviewCount}</span>}
            </Link>
            <button onClick={() => setAddType(tab === "cleaners" ? "cleaner" : "vendor")} className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-[var(--cf-green)] px-3.5 text-[12px] font-bold text-white hover:bg-[var(--cf-green-hover)]">
              <Plus size={15} /> Add {singularPayee}
            </button>
          </div>
        </header>

        {isLoading ? (
          <div className="flex min-h-[420px] items-center justify-center gap-2 text-[13px] font-medium text-stone-500">
            <Loader2 size={18} className="animate-spin" /> Loading payables...
          </div>
        ) : error ? (
          <div className="mt-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] font-medium text-rose-700">Failed to load payables.</div>
        ) : (
          <>
            <section className="mt-5 grid gap-4 sm:grid-cols-2">
              <SummaryCard
                label={`Left to pay ${payeeLabel}`}
                value={totals.total}
                tone="green"
                progress={progress}
                description={`${formatCurrency(paidTotal)} paid so far this month`}
              />
              <SummaryCard
                label={`Total owed to ${payeeLabel} this month`}
                value={monthTotal}
                description={`${outstandingItemCount} unpaid item${outstandingItemCount === 1 ? "" : "s"} · ${list.length} ${payeeLabel}`}
              />
            </section>

            {workspace.isCurrent && (
              <div className="mt-4 flex flex-wrap gap-2">
                <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label="All" amount={totals.total} />
                <FilterChip active={filter === "ready"} onClick={() => setFilter("ready")} label="Ready to pay now" amount={readyAmount} dot="#0b7a4e" />
                <FilterChip active={filter === "waiting"} onClick={() => setFilter("waiting")} label="Waiting on timing/client" amount={waitingAmount} dot="#c28a20" />
                <FilterChip active={filter === "invoice"} onClick={() => setFilter("invoice")} label={`Needs invoice from ${singularPayee}`} amount={invoiceAmount} dot="#a9afb3" />
              </div>
            )}

            <div className="mt-6 flex items-center gap-6 border-b border-[var(--cf-rule)]">
              <ViewTab active={view === "outstanding"} onClick={() => setView("outstanding")} label={`By ${singularPayee}`} count={filteredPayables.length} disabled={!workspace.isCurrent} />
              <ViewTab active={view === "paid"} onClick={() => setView("paid")} label="Paid" count={workspace.paidForTab.length} />
            </div>

            {view === "outstanding" && workspace.isCurrent ? (
              <section className="mt-4 space-y-3">
                {filteredPayables.map((payable) => (
                  <PayeeLedger
                    key={payable.id}
                    payable={payable}
                    accounts={accountsForFilter(payable, filter)}
                    filter={filter}
                    paidThisMonth={monthPaymentFor(workspace.paidForTab, payable.name)}
                    markingClientPaid={markingClientPaid}
                    onOpenPayment={(accountId) => setPaymentTarget({ payable, accountId })}
                    onOpenInvoice={(account) => setInvoiceTarget({ payable, account })}
                    onMarkClientPaid={(account) => markClientInvoicesPaid(payable, account)}
                  />
                ))}
                {filteredPayables.length === 0 && (
                  <EmptyState filter={filter} payeeLabel={payeeLabel} />
                )}
                {workspace.others.length > 0 && (
                  <DirectorySection
                    payees={workspace.others}
                    label={payeeLabel}
                    onOpen={(payable) => setPaymentTarget({ payable, accountId: null })}
                  />
                )}
              </section>
            ) : (
              <PaidLedger entries={workspace.paidForTab} period={workspace.month} payeeLabel={payeeLabel} />
            )}
          </>
        )}
      </div>

      <Dialog open={Boolean(paymentTarget)} onOpenChange={(open) => !open && setPaymentTarget(null)}>
        <DialogContent className="max-h-[92vh] max-w-[calc(100vw-24px)] overflow-x-hidden overflow-y-auto border-0 bg-transparent p-0 shadow-none sm:max-w-[470px]" overlayClassName="bg-[#171a18]/55 backdrop-blur-[2px]">
          <DialogTitle className="sr-only">Pay {paymentTarget?.payable.name || singularPayee}</DialogTitle>
          <PaymentDetail
            payable={paymentTarget?.payable || null}
            period={workspace.month}
            initialAccountId={paymentTarget?.accountId}
            onPaid={() => {
              void workspace.mutate()
              setPaymentTarget(null)
            }}
            onInvoiceChanged={() => void workspace.mutate()}
            onEdit={(payable) => {
              setPaymentTarget(null)
              setEditPayable(payable)
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(invoiceTarget)} onOpenChange={(open) => !open && setInvoiceTarget(null)}>
        <DialogContent className="max-h-[92vh] max-w-[calc(100vw-24px)] overflow-x-hidden overflow-y-auto border border-[var(--cf-rule)] bg-white p-0 shadow-2xl sm:max-w-[500px]" overlayClassName="bg-[#171a18]/55 backdrop-blur-[2px]">
          <DialogTitle className="sr-only">Add invoice for {invoiceTarget?.payable.name || singularPayee}</DialogTitle>
          {invoiceTarget && (
            <InvoiceIntakePanel
              payeeType={invoiceTarget.payable.type}
              payeeId={invoiceTarget.payable.id}
              payeeName={invoiceTarget.payable.name}
              period={workspace.month}
              presentation="dialog"
              expectedAmount={invoiceTarget.payable.total}
              itemCount={new Set(invoiceTarget.payable.accounts.flatMap((account) => account.allItemIds)).size}
              onChanged={() => void workspace.mutate()}
              onClose={() => setInvoiceTarget(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {addType && <PersonModal type={addType} onClose={() => setAddType(null)} onSaved={() => workspace.mutate()} />}
      {editPayable && <PersonModal type={editPayable.type} mode="edit" editId={editPayable.id} onClose={() => setEditPayable(null)} onSaved={() => workspace.mutate()} />}
    </div>
  )
}

function PayeeSwitch({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12px] font-bold ${active ? "bg-[#07101f] text-white" : "text-stone-500 hover:bg-stone-50 hover:text-stone-800"}`}>
      {icon}{label}
    </button>
  )
}

function SummaryCard({ label, value, description, tone, progress }: { label: string; value: number; description: string; tone?: "green"; progress?: number }) {
  return (
    <div className="rounded-lg border border-[var(--cf-rule)] bg-white px-5 py-5 shadow-[var(--cf-panel-shadow)] sm:px-6">
      <div className="text-[10px] font-extrabold uppercase tracking-[0.07em] text-stone-500">{label}</div>
      <div className={`mt-1 text-[38px] font-extrabold leading-none tabular-nums sm:text-[44px] ${tone === "green" ? "text-[var(--cf-green)]" : "text-[#07101f]"}`}>{formatCurrency(value)}</div>
      {typeof progress === "number" && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#edf0ec]">
          <div className="h-full rounded-full bg-[var(--cf-green)] transition-[width]" style={{ width: `${progress}%` }} />
        </div>
      )}
      <div className="mt-2 text-[12px] font-medium text-stone-500">{description}</div>
    </div>
  )
}

function FilterChip({ active, onClick, label, amount, dot }: { active: boolean; onClick: () => void; label: string; amount: number; dot?: string }) {
  return (
    <button onClick={onClick} className={`inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 text-[12px] font-bold transition-colors ${active ? "border-[#b9b4aa] bg-[#07101f] text-white" : "border-[var(--cf-rule)] bg-white text-stone-600 hover:border-[var(--cf-rule-strong)]"}`}>
      {dot && <span className="h-2 w-2 rounded-full" style={{ background: dot }} />}
      <span>{label}</span>
      <span className="tabular-nums">{formatCurrency(amount)}</span>
    </button>
  )
}

function ViewTab({ active, onClick, label, count, disabled }: { active: boolean; onClick: () => void; label: string; count: number; disabled?: boolean }) {
  return (
    <button disabled={disabled} onClick={onClick} className={`relative pb-3 text-[13px] font-bold disabled:cursor-not-allowed disabled:opacity-40 ${active ? "text-[#111]" : "text-stone-500 hover:text-stone-800"}`}>
      {label} <span className="ml-1 text-stone-400">{count}</span>
      {active && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-[#111]" />}
    </button>
  )
}

function PayeeLedger({
  payable,
  accounts,
  filter,
  paidThisMonth,
  markingClientPaid,
  onOpenPayment,
  onOpenInvoice,
  onMarkClientPaid,
}: {
  payable: Payable
  accounts: PayableAccount[]
  filter: WorkFilter
  paidThisMonth: number
  markingClientPaid: string | null
  onOpenPayment: (accountId: string | null) => void
  onOpenInvoice: (account: PayableAccount) => void
  onMarkClientPaid: (account: PayableAccount) => void
}) {
  const totalForMonth = payable.total + paidThisMonth
  const paidPct = totalForMonth > 0 ? Math.min(100, (paidThisMonth / totalForMonth) * 100) : 0

  return (
    <article className="overflow-hidden rounded-lg border border-[var(--cf-rule)] bg-white shadow-[var(--cf-panel-shadow)]">
      <div className="flex items-center gap-3 px-4 py-4 sm:px-5">
        <button onClick={() => onOpenPayment(null)} className="flex min-w-0 flex-1 items-center gap-3 text-left group">
          <span className="grid h-10 w-10 flex-none place-items-center rounded-lg text-[12px] font-extrabold text-white" style={{ background: avatarColor(payable.name) }}>{payable.initials}</span>
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-extrabold group-hover:text-[var(--cf-green)]">{payable.name}</span>
            <span className="mt-0.5 block truncate text-[11px] font-medium text-stone-500">
              {payable.accounts.length} item{payable.accounts.length === 1 ? "" : "s"} to pay · {payable.zelleEmail ? "Pay by Zelle" : "Payment details needed"}
            </span>
          </span>
        </button>
        <div className="w-[120px] flex-none text-right sm:w-[150px]">
          <div className="text-[15px] font-extrabold tabular-nums">{formatCurrency(paidThisMonth)} / {formatCurrency(totalForMonth)}</div>
          <div className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.06em] text-stone-500">Paid of total</div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-[#edf0ec]"><div className="h-full rounded-full bg-[var(--cf-green)]" style={{ width: `${paidPct}%` }} /></div>
        </div>
      </div>
      <div className="border-t border-[var(--cf-rule-soft)]">
        {accounts.map((account) => (
          <PayableRow
            key={account.id}
            payable={payable}
            account={account}
            filter={filter}
            isMarkingClientPaid={markingClientPaid === account.id}
            onOpenPayment={() => onOpenPayment(account.id)}
            onOpenInvoice={() => onOpenInvoice(account)}
            onMarkClientPaid={() => onMarkClientPaid(account)}
          />
        ))}
      </div>
    </article>
  )
}

function PayableRow({ payable, account, filter, isMarkingClientPaid, onOpenPayment, onOpenInvoice, onMarkClientPaid }: { payable: Payable; account: PayableAccount; filter: WorkFilter; isMarkingClientPaid: boolean; onOpenPayment: () => void; onOpenInvoice: () => void; onMarkClientPaid: () => void }) {
  const showInvoice = filter === "invoice" || (filter === "all" && isInvoiceBlocked(account))
  const showWaiting = filter === "waiting" || (filter === "all" && account.safeOwed === 0 && account.waitingOwed > 0)
  const amount = amountForFilter(account, filter)
  const isResidential = account.propertyType === "RESIDENTIAL" || account.reason.toLowerCase().includes("residential")
  const statusLabel = showInvoice
    ? account.payeeInvoiceStatus === "mismatch" ? "Invoice needs review" : `Needs invoice from ${payable.type}`
    : showWaiting
      ? account.canMarkClientPaid ? "Waiting on client" : "Waiting to become payable"
      : account.status === "pay-today" ? "Pay today" : account.status === "partial" ? "Partially ready" : "Ready to pay"
  const statusColor = showInvoice ? "#697078" : showWaiting ? "#a66e09" : account.status === "pay-today" ? "#b42318" : "#0b7a4e"

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-t border-[#f2efe8] px-4 py-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_92px_132px] sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <span className={`grid h-9 w-9 flex-none place-items-center rounded-lg ${isResidential ? "bg-[#ecf6f0] text-[#0b7a4e]" : "bg-[#eef4f6] text-[#187c83]"}`}>
          {isResidential ? <Home size={16} /> : <Building2 size={16} />}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-bold sm:text-[14px]">{accountDisplayName(account.clientName)}</div>
          <div className="mt-0.5 truncate text-[11px] sm:text-[12px]">
            <span className="font-bold" style={{ color: statusColor }}>{statusLabel}</span>
            <span className="text-stone-500"> · {account.reason}</span>
          </div>
        </div>
      </div>
      <span className="text-right text-[14px] font-extrabold tabular-nums sm:text-[14.5px]">{formatCurrency(amount)}</span>
      <div className="col-span-2 flex justify-end sm:col-span-1">
        {showWaiting && account.canMarkClientPaid ? (
          <button disabled={isMarkingClientPaid} onClick={onMarkClientPaid} className="inline-flex h-8 items-center justify-center rounded-md border border-[#d9c79e] bg-[#fffaf0] px-3 text-[11px] font-bold text-[#8a5d08] hover:bg-[#fff4da] disabled:opacity-50">
            {isMarkingClientPaid ? "Updating..." : "Mark client paid"}
          </button>
        ) : showWaiting ? (
          <Link href="/invoices" className="inline-flex h-8 items-center justify-center rounded-md border border-[var(--cf-rule)] px-3 text-[11px] font-bold text-stone-600 hover:bg-stone-50">Review timing</Link>
        ) : showInvoice ? (
          <button onClick={onOpenInvoice} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--cf-rule)] px-3 text-[11px] font-bold text-stone-700 hover:bg-stone-50"><FileText size={13} /> {account.payeeInvoiceStatus === "mismatch" ? "Review" : "Add invoice"}</button>
        ) : (
          <button onClick={onOpenPayment} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--cf-green)] px-3 text-[11px] font-bold text-white hover:bg-[var(--cf-green-hover)]"><Check size={13} /> Mark paid</button>
        )}
      </div>
    </div>
  )
}

function PaidLedger({ entries, period, payeeLabel }: { entries: PaidEntry[]; period: string; payeeLabel: string }) {
  const total = entries.reduce((sum, entry) => sum + entry.amount, 0)
  return (
    <section className="mt-4 overflow-hidden rounded-lg border border-[var(--cf-rule)] bg-white shadow-[var(--cf-panel-shadow)]">
      <div className="flex items-center justify-between border-b border-[var(--cf-rule-soft)] px-4 py-3 sm:px-5">
        <div className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-stone-500">{payeeLabel} paid · {formatMonthLabel(period)}</div>
        <div className="text-[14px] font-extrabold tabular-nums text-[var(--cf-green)]">{formatCurrency(total)}</div>
      </div>
      {entries.length === 0 ? (
        <div className="px-5 py-14 text-center text-[13px] font-medium text-stone-500">No payments recorded in {formatMonthLabel(period)}.</div>
      ) : entries.map((entry) => (
        <div key={entry.paymentId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-[#f2efe8] px-4 py-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_100px_90px] sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-9 w-9 flex-none place-items-center rounded-lg text-[11px] font-extrabold text-white" style={{ background: avatarColor(entry.name) }}>{entry.initials}</span>
            <div className="min-w-0">
              <div className="truncate text-[14px] font-bold">{entry.name}</div>
              <div className="truncate text-[11px] text-stone-500">{new Date(entry.datePaid).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}{entry.notes ? ` · ${entry.notes}` : ""}</div>
            </div>
          </div>
          <span className="text-right text-[14px] font-extrabold tabular-nums text-[var(--cf-green)]">{formatCurrency(entry.amount)}</span>
          <span className="col-span-2 inline-flex items-center justify-end gap-1 text-[11px] font-bold text-stone-500 sm:col-span-1"><Check size={14} className="text-emerald-600" /> Paid</span>
        </div>
      ))}
    </section>
  )
}

function EmptyState({ filter, payeeLabel }: { filter: WorkFilter; payeeLabel: string }) {
  const copy = filter === "ready" ? "Nothing is ready to pay right now." : filter === "waiting" ? "Nothing is waiting on a client or payout date." : filter === "invoice" ? "Every payable item has its invoice covered." : `Nothing is owed to ${payeeLabel} right now.`
  return (
    <div className="rounded-lg border border-[var(--cf-rule)] bg-white px-6 py-14 text-center shadow-[var(--cf-panel-shadow)]">
      <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-[var(--cf-green-soft)] text-[var(--cf-green)]"><Check size={21} /></span>
      <div className="mt-3 text-[15px] font-extrabold">You are caught up</div>
      <div className="mt-1 text-[12px] font-medium text-stone-500">{copy}</div>
    </div>
  )
}

function DirectorySection({ payees, label, onOpen }: { payees: Payable[]; label: string; onOpen: (payable: Payable) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--cf-rule)] bg-white shadow-[var(--cf-panel-shadow)]">
      <button onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between px-4 py-3 text-left text-[12px] font-bold text-stone-600 hover:bg-[var(--cf-surface-hover)] sm:px-5">
        <span>All {label} <span className="font-medium text-stone-400">· {payees.length} with nothing owed</span></span>
        <ChevronDown size={15} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="grid border-t border-[var(--cf-rule-soft)] sm:grid-cols-2">
          {payees.map((payee) => (
            <button key={payee.id} onClick={() => onOpen(payee)} className="flex items-center gap-3 border-b border-[#f2efe8] px-4 py-3 text-left hover:bg-stone-50 sm:border-r sm:px-5">
              <span className="grid h-9 w-9 flex-none place-items-center rounded-lg text-[11px] font-extrabold text-white" style={{ background: avatarColor(payee.name) }}>{payee.initials}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-bold">{payee.name}</span><span className="block truncate text-[11px] text-stone-400">Nothing owed</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
