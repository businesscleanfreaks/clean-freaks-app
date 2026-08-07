"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { ChevronLeft, ChevronRight, ChevronDown, Plus, Check, Loader2 } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import type { InvoiceOverviewMetrics, OverviewInvoice } from "@/lib/invoice-overview"

interface OverviewResponse {
  period: string
  metrics: InvoiceOverviewMetrics
  invoices: OverviewInvoice[]
  monthsWithInvoices: number[]
}

const fetcher = (url: string) => fetch(url).then(r => { if (!r.ok) throw new Error("Failed"); return r.json() })

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const periodOf = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
const shiftPeriod = (period: string, delta: number) => {
  const [y, m] = period.split("-").map(Number)
  return periodOf(new Date(y, m - 1 + delta, 1))
}
const periodLabel = (period: string) => {
  const [y, m] = period.split("-").map(Number)
  return `${MONTHS[m - 1]} ${y}`
}

const STATUS_STYLES: Record<string, { bg: string; color: string }> = {
  PAID: { bg: "#DCFCE7", color: "#15803D" },
  SENT: { bg: "#DBEAFE", color: "#1D4ED8" },
  DRAFT: { bg: "#FEF3C7", color: "#92400E" },
  VOID: { bg: "#F1F5F9", color: "#64748B" },
}

function MetricCard({ children }: { children: React.ReactNode }) {
  return <div className="rounded-[13px] border border-[#eaecef] bg-white px-[17px] py-[15px]">{children}</div>
}

function CardLabel({ dot, children }: { dot?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      {dot && <span className="h-2 w-2 flex-none rounded-full" style={{ background: dot }} />}
      <span className="text-[10.5px] font-extrabold uppercase tracking-[0.05em] text-[#7d8795]">{children}</span>
    </div>
  )
}

export function InvoicesOverview() {
  const router = useRouter()
  const [period, setPeriod] = useState(() => periodOf(new Date()))
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerYear, setPickerYear] = useState(() => new Date().getFullYear())

  const { data, isLoading } = useSWR<OverviewResponse>(
    `/api/invoices/overview?period=${period}`,
    fetcher,
    { revalidateOnFocus: false },
  )

  const metrics = data?.metrics
  const invoices = useMemo(() => data?.invoices ?? [], [data])
  const monthsWithInvoices = data?.monthsWithInvoices ?? []
  const pickerYearMatchesPeriod = pickerYear === Number(period.split("-")[0])

  return (
    <div className="mx-auto w-full max-w-[1010px] px-6 py-6 md:px-8">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-[26px] font-extrabold leading-none tracking-[-0.025em]">Invoices</h1>

          <div className="relative mt-[9px] w-max">
            <div className="inline-flex items-center gap-0.5 rounded-[11px] border border-[#e4e7ec] bg-white p-[3px] shadow-[0_1px_2px_rgba(16,24,40,.04)]">
              <button
                type="button"
                onClick={() => setPeriod(p => shiftPeriod(p, -1))}
                aria-label="Previous month"
                className="flex h-[30px] w-[30px] items-center justify-center rounded-lg text-[#667085] hover:bg-[#f2f4f7] hover:text-[#101828]"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => { setPickerYear(Number(period.split("-")[0])); setPickerOpen(o => !o) }}
                className="inline-flex h-[30px] min-w-[132px] items-center justify-center gap-2 rounded-lg px-3 text-[13.5px] font-bold tabular-nums tracking-[-.01em] text-[#101828] hover:bg-[#f2f4f7]"
              >
                {periodLabel(period)}
                <ChevronDown className="h-3 w-3 text-[#7d8795]" />
              </button>
              <button
                type="button"
                onClick={() => setPeriod(p => shiftPeriod(p, 1))}
                aria-label="Next month"
                className="flex h-[30px] w-[30px] items-center justify-center rounded-lg text-[#667085] hover:bg-[#f2f4f7] hover:text-[#101828]"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            {pickerOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setPickerOpen(false)} />
                <div className="absolute left-0 top-[44px] z-50 w-[302px] rounded-[15px] border border-[#e6e8ec] bg-white p-[15px] shadow-[0_14px_44px_rgba(16,24,40,.17)]">
                  <div className="mb-[13px] flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setPickerYear(y => y - 1)}
                      aria-label="Previous year"
                      className="flex h-7 w-7 items-center justify-center rounded-md text-[#667085] hover:bg-[#f2f4f7]"
                    >
                      <ChevronLeft className="h-[15px] w-[15px]" />
                    </button>
                    <span className="text-[14px] font-extrabold tabular-nums text-[#101828]">{pickerYear}</span>
                    <button
                      type="button"
                      onClick={() => setPickerYear(y => y + 1)}
                      aria-label="Next year"
                      className="flex h-7 w-7 items-center justify-center rounded-md text-[#667085] hover:bg-[#f2f4f7]"
                    >
                      <ChevronRight className="h-[15px] w-[15px]" />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-[5px]">
                    {MONTHS.map((label, index) => {
                      const value = `${pickerYear}-${String(index + 1).padStart(2, "0")}`
                      const active = value === period
                      const has = pickerYearMatchesPeriod && monthsWithInvoices.includes(index + 1)
                      return (
                        <button
                          key={label}
                          type="button"
                          onClick={() => { setPeriod(value); setPickerOpen(false) }}
                          className={`relative rounded-lg py-2 text-[12.5px] font-bold transition-colors ${
                            active ? "bg-[#15793f] text-white" : "text-[#344054] hover:bg-[#f2f4f7]"
                          }`}
                        >
                          {label}
                          {has && !active && (
                            <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-[#15793f]" />
                          )}
                        </button>
                      )
                    })}
                  </div>
                  <div className="mt-[14px] flex flex-wrap gap-1.5 border-t border-[#f0f1f3] pt-[13px]">
                    <button
                      type="button"
                      onClick={() => { setPeriod(periodOf(new Date())); setPickerOpen(false) }}
                      className="rounded-full border border-[#e4e7ec] px-3 py-1 text-[11.5px] font-bold text-[#475467] hover:bg-[#f2f4f7]"
                    >
                      This month
                    </button>
                    <button
                      type="button"
                      onClick={() => { setPeriod(shiftPeriod(periodOf(new Date()), -1)); setPickerOpen(false) }}
                      className="rounded-full border border-[#e4e7ec] px-3 py-1 text-[11.5px] font-bold text-[#475467] hover:bg-[#f2f4f7]"
                    >
                      Last month
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => router.push("/invoices/workspace")}
          title="Open the invoicing workspace to review candidates and create invoices."
          className="flex flex-none items-center gap-1.5 rounded-[9px] border border-[#dfe3e8] bg-white px-3.5 py-[9px] text-[12.5px] font-bold text-[#475467] hover:bg-[#f7f8fa]"
        >
          <Plus className="h-[15px] w-[15px]" />
          New invoice
        </button>
      </div>

      {/* Metrics */}
      <div className="mt-[18px] grid grid-cols-1 gap-[14px] sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard>
          <CardLabel dot="#15793f">Collected</CardLabel>
          <div className="mt-[5px] text-[25px] font-extrabold tabular-nums tracking-[-0.02em] text-[#15793f]">
            {formatCurrency(metrics?.collected ?? 0)}
          </div>
          <div className="mt-0.5 text-[11.5px] text-[#7d8795]">of {formatCurrency(metrics?.expected ?? 0)} billed</div>
          <div className="mt-2.5 flex items-center gap-2">
            <div className="h-[5px] flex-1 overflow-hidden rounded-full bg-[#eef0f2]">
              <div className="h-full rounded-full bg-[#15793f]" style={{ width: `${metrics?.collectedPct ?? 0}%` }} />
            </div>
            <span className="whitespace-nowrap text-[11px] font-bold tabular-nums text-[#15793f]">{metrics?.collectedPct ?? 0}%</span>
          </div>
        </MetricCard>

        <MetricCard>
          <CardLabel dot="#dc2626">Overdue · follow up</CardLabel>
          {!metrics || metrics.overdue.length === 0 ? (
            <>
              <div className="mt-[9px] flex items-center gap-1.5">
                <Check className="h-4 w-4 text-[#22a35a]" strokeWidth={2.6} />
                <span className="text-[15px] font-extrabold tracking-[-0.01em] text-[#15803d]">All current</span>
              </div>
              <div className="mt-1 text-[11.5px] text-[#7d8795]">nobody to chase</div>
            </>
          ) : (
            <div className="mt-[7px] flex flex-col gap-0.5">
              {metrics.overdue.slice(0, 2).map(entry => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => router.push(`/invoices/${entry.id}`)}
                  className="-mx-1.5 rounded-md px-1.5 py-1 text-left hover:bg-[#fdecec]"
                >
                  <div className="truncate text-[13px] font-bold leading-tight tracking-[-0.01em] text-[#101828]">{entry.clientName}</div>
                  <div className="mt-px flex items-baseline gap-2">
                    <span className="text-[11px] font-extrabold tabular-nums text-[#dc2626]">{entry.daysOverdue}d overdue</span>
                    <span className="text-[12px] font-bold tabular-nums text-[#475467]">{formatCurrency(entry.amount)}</span>
                  </div>
                </button>
              ))}
              {metrics.overdue.length > 2 && (
                <span className="py-0.5 text-[11px] font-bold text-[#7d8795]">+{metrics.overdue.length - 2} more</span>
              )}
            </div>
          )}
        </MetricCard>

        <MetricCard>
          <CardLabel dot="#c98a1a">Outstanding</CardLabel>
          <div className="mt-[5px] text-[25px] font-extrabold tabular-nums tracking-[-0.02em]">
            {formatCurrency(metrics?.outstanding ?? 0)}
          </div>
          <div className="mt-0.5 text-[11.5px] text-[#7d8795]">sent, awaiting payment</div>
          {!!metrics?.overdueTotal && (
            <div className="mt-0.5 text-[11.5px] font-bold text-[#8a5e12]">{formatCurrency(metrics.overdueTotal)} overdue</div>
          )}
        </MetricCard>

        <MetricCard>
          <CardLabel>Expected this month</CardLabel>
          <div className="mt-[5px] text-[25px] font-extrabold tabular-nums tracking-[-0.02em]">
            {formatCurrency(metrics?.expected ?? 0)}
          </div>
          <div className="mt-0.5 text-[11.5px] text-[#7d8795]">
            {metrics?.invoiceCount ?? 0} invoice{(metrics?.invoiceCount ?? 0) === 1 ? "" : "s"}
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <div className="h-[5px] flex-1 overflow-hidden rounded-full bg-[#eef0f2]">
              <div className="h-full rounded-full bg-[#15793f]" style={{ width: `${metrics?.sentPct ?? 0}%` }} />
            </div>
            <span className="whitespace-nowrap text-[11px] font-bold tabular-nums text-[#667085]">
              {metrics?.sentCount ?? 0} sent
            </span>
          </div>
        </MetricCard>
      </div>

      {/* Invoice list */}
      <div className="mt-[18px] overflow-hidden rounded-[13px] border border-[#eaecef] bg-white">
        <div className="flex items-center justify-between border-b border-[#f0f1f3] px-5 py-3">
          <span className="text-[10.5px] font-extrabold uppercase tracking-[0.05em] text-[#7d8795]">
            {periodLabel(period)}
          </span>
          <span className="text-[11.5px] text-[#7d8795]">{invoices.length} invoice{invoices.length === 1 ? "" : "s"}</span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-[#98a2b3]">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : invoices.length === 0 ? (
          <div className="px-5 py-14 text-center text-[13px] text-[#7d8795]">No invoices in {periodLabel(period)}.</div>
        ) : (
          <div>
            {invoices.map(inv => {
              const chip = STATUS_STYLES[inv.status] ?? STATUS_STYLES.DRAFT
              const overdue = inv.status === "SENT" && inv.dateDue && new Date(inv.dateDue) < new Date()
              return (
                <button
                  key={inv.id}
                  type="button"
                  onClick={() => router.push(`/invoices/${inv.id}`)}
                  className="flex w-full items-center gap-3 border-b border-[#f4f5f7] px-5 py-3 text-left transition-colors last:border-b-0 hover:bg-[#f9fafb]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-bold tracking-[-0.01em] text-[#101828]">{inv.clientName}</span>
                    <span className="mt-px block truncate text-[11.5px] text-[#7d8795]">
                      {inv.invoiceNumber}
                      {inv.dateDue ? ` · due ${new Date(inv.dateDue).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
                    </span>
                  </span>
                  {overdue && (
                    <span className="flex-none rounded-full bg-[#fdecec] px-2 py-0.5 text-[10px] font-extrabold uppercase text-[#dc2626]">
                      Overdue
                    </span>
                  )}
                  <span className="flex-none text-[13.5px] font-bold tabular-nums text-[#101828]">{formatCurrency(inv.totalAmount)}</span>
                  <span
                    className="w-[52px] flex-none rounded-full px-2 py-0.5 text-center text-[10px] font-extrabold uppercase"
                    style={{ background: chip.bg, color: chip.color }}
                  >
                    {inv.status.toLowerCase()}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
