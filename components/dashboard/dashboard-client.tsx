"use client"

import { addMonths, format, subMonths } from "date-fns"
import { ChevronLeft, ChevronRight, Pencil } from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"
import useSWR from "swr"
import {
  ExpensesModal,
  ProjectedExpensesModal,
  type ExpenseData,
  type ProjectedExpenses,
} from "@/components/dashboard/dashboard-expenses"
import {
  OperationsRail,
  TodoView,
  todoCount,
  type DashboardCompletionState,
  type DashboardOperationsData,
  type DashboardPayablesData,
} from "@/components/dashboard/dashboard-operations"
import { SkeletonPulse } from "@/components/ui/skeleton-pulse"
import { showError, showSuccess } from "@/lib/toast"

interface ClientOverviewRow {
  id: string
  name: string
  cleanerAssigned: string
  frequency: string
  clientPayType: string
  avgRevenue: number
  avgCleanerCost: number
  avgProfit: number
  periodJobCount: number
  periodRevenue: number
  periodCleanerCost: number
  periodProfit: number
}

interface ClientOverviewData {
  clients: ClientOverviewRow[]
  totals: {
    avgRevenue: number
    avgCleanerCost: number
    avgProfit: number
    periodRevenue: number
    periodCleanerCost: number
    periodProfit: number
    periodJobCount: number
  }
  period: { year: number; month: number; label: string }
}

interface ProjectedExpenseResponse {
  projectedExpenses: ProjectedExpenses
}

type SortKey = "name" | "periodRevenue" | "periodCleanerCost" | "periodProfit"

const emptyProjected: ProjectedExpenses = {
  software: 0,
  insurance: 0,
  marketing: 0,
  mistakes: 0,
  freelancers: 0,
  miscellaneous: 0,
}

const fetcher = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url)
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || "Failed to load dashboard")
  return response.json()
}

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

function formatCurrency(value: number) {
  return money.format(Math.abs(value || 0))
}

function shortenName(name: string) {
  if (!name || name === "Unassigned") return name || "Unassigned"
  const cleaned = name.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim()
  const parts = cleaned.split(" ").filter(Boolean)
  return parts.length < 2 ? parts[0] : `${parts[0]} ${parts[1][0]}.`
}

function MetricCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub?: string
  tone?: "good" | "bad"
}) {
  return (
    <div className="flex min-h-[108px] flex-col justify-center rounded-lg border border-[#e6dfd4] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(40,30,10,0.04)]">
      <div className="text-[10px] font-extrabold uppercase tracking-[0.5px] text-[#8a857a]">{label}</div>
      <div className={`mt-1 text-[18px] font-extrabold leading-none tabular-nums ${tone === "good" ? "text-[#15803d]" : tone === "bad" ? "text-[#c33d0e]" : "text-[#1a1a1a]"}`}>{value}</div>
      {sub && <div className="mt-2 text-[11px] font-medium text-stone-500">{sub}</div>}
    </div>
  )
}

function ActualCell({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" | "muted" }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <div className="text-[10px] font-bold text-stone-500">{label}</div>
      <div className={`mt-1 truncate text-[19px] font-extrabold leading-none tabular-nums ${tone === "good" ? "text-[#087c3d]" : tone === "bad" ? "text-[#c33d0e]" : tone === "muted" ? "text-stone-500" : "text-[#07101f]"}`}>{value}</div>
    </div>
  )
}

export function DashboardClient() {
  const [currentMonth, setCurrentMonth] = useState(() => new Date())
  const [activeView, setActiveView] = useState<"dashboard" | "todo">("dashboard")
  const [sortBy, setSortBy] = useState<SortKey>("periodRevenue")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [projectedOpen, setProjectedOpen] = useState(false)
  const [expensesOpen, setExpensesOpen] = useState(false)
  const [doneTasks, setDoneTasks] = useState<DashboardCompletionState>({})

  const year = currentMonth.getFullYear()
  const month = currentMonth.getMonth()
  const period = format(currentMonth, "yyyy-MM")

  const overview = useSWR<ClientOverviewData>(`/api/dashboard/client-overview?year=${year}&month=${month}`, fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  })
  const operations = useSWR<DashboardOperationsData>(`/api/dashboard/operations?year=${year}&month=${month}`, fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  })
  const payables = useSWR<DashboardPayablesData>(`/api/payables/data?period=${period}`, fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  })
  const projectedSettings = useSWR<ProjectedExpenseResponse>("/api/dashboard/expense-settings", fetcher, {
    revalidateOnFocus: false,
  })
  const expenses = useSWR<ExpenseData>(`/api/expenses?year=${year}&month=${month}`, fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  })

  const rows = useMemo(() => overview.data?.clients || [], [overview.data?.clients])
  const totals = overview.data?.totals || {
    avgRevenue: 0,
    avgCleanerCost: 0,
    avgProfit: 0,
    periodRevenue: 0,
    periodCleanerCost: 0,
    periodProfit: 0,
    periodJobCount: 0,
  }
  const projected = projectedSettings.data?.projectedExpenses || emptyProjected
  const projectedExpenseTotal = Object.values(projected).reduce((sum, value) => sum + value, 0)
  const actualExpenseTotal = expenses.data?.total || 0
  const projectedNet = totals.avgProfit - projectedExpenseTotal
  const projectedMargin = totals.avgRevenue ? (projectedNet / totals.avgRevenue) * 100 : 0
  const actualNet = totals.periodProfit - actualExpenseTotal
  const actualMargin = totals.periodRevenue ? (actualNet / totals.periodRevenue) * 100 : 0
  const todoTotal = todoCount(operations.data, payables.data, doneTasks)
  const actualAverage = expenses.data?.months.length
    ? expenses.data.months.reduce((sum, item) => sum + item.total, 0) / expenses.data.months.length
    : 0

  const billingCounts = rows.reduce((counts, row) => {
    if (row.clientPayType.toLowerCase().includes("flat")) counts.flat += 1
    else counts.perClean += 1
    return counts
  }, { flat: 0, perClean: 0 })

  const sortedRows = useMemo(() => [...rows].sort((a, b) => {
    if (sortBy === "name") {
      const result = a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      return sortDir === "desc" ? -result : result
    }
    const result = (a[sortBy] || 0) - (b[sortBy] || 0)
    return sortDir === "desc" ? -result : result
  }), [rows, sortBy, sortDir])

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) setSortDir((value) => value === "desc" ? "asc" : "desc")
    else {
      setSortBy(key)
      setSortDir(key === "name" ? "asc" : "desc")
    }
  }

  const toggleTask = (taskId: string) => {
    setDoneTasks((current) => ({ ...current, [taskId]: !current[taskId] }))
  }

  const saveProjectedExpenses = async (values: ProjectedExpenses) => {
    try {
      const response = await fetch("/api/dashboard/expense-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      })
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || "Failed to save projected expenses")
      await projectedSettings.mutate({ projectedExpenses: values }, { revalidate: false })
      showSuccess("Projected expenses saved")
    } catch (error) {
      showError(error instanceof Error ? error.message : "Failed to save projected expenses")
      throw error
    }
  }

  const error = overview.error || operations.error || payables.error || projectedSettings.error || expenses.error

  return (
    <div className="min-h-full bg-[#f3f0e9] text-[#171717]">
      <div className="mx-auto w-full max-w-[1760px] px-4 pb-8 pt-5 sm:px-7 lg:px-8">
        {error && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-700">
            {error.message || "Some dashboard data could not be loaded."}
          </div>
        )}

        <header className="flex items-start justify-between gap-5 border-b-[1.5px] border-stone-900 pb-4">
          <div>
            <h1 className="text-[28px] font-extrabold leading-none text-[#101010]">Dashboard</h1>
            <p className="mt-2 text-[13px] font-medium text-stone-500">{format(new Date(), "EEEE, MMMM d, yyyy")}</p>
          </div>
          <div className="flex h-11 items-center overflow-hidden rounded-lg border border-[#e2dbcf] bg-white">
            <button type="button" onClick={() => setCurrentMonth((date) => subMonths(date, 1))} className="flex h-full w-11 items-center justify-center border-r border-[#eee8dd] text-stone-500 hover:bg-[#faf8f3]" aria-label="Previous month">
              <ChevronLeft size={15} />
            </button>
            <span className="min-w-[126px] px-3 text-center text-[13px] font-extrabold">{format(currentMonth, "MMMM yyyy")}</span>
            <button type="button" onClick={() => setCurrentMonth((date) => addMonths(date, 1))} className="flex h-full w-11 items-center justify-center border-l border-[#eee8dd] text-stone-500 hover:bg-[#faf8f3]" aria-label="Next month">
              <ChevronRight size={15} />
            </button>
          </div>
        </header>

        <div className="mt-4 inline-flex h-[53px] items-center rounded-lg border border-[#ded6ca] bg-white p-1">
          <button type="button" onClick={() => setActiveView("dashboard")} className={`h-[41px] min-w-[122px] rounded-lg px-4 text-[13px] font-extrabold ${activeView === "dashboard" ? "bg-[#07101f] text-white" : "text-stone-600 hover:bg-stone-50"}`}>Dashboard</button>
          <button type="button" onClick={() => setActiveView("todo")} className={`flex h-[41px] min-w-[112px] items-center justify-center gap-2 rounded-lg px-4 text-[13px] font-extrabold ${activeView === "todo" ? "bg-[#07101f] text-white" : "text-stone-600 hover:bg-stone-50"}`}>
            To-do
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${activeView === "todo" ? "bg-white/15 text-white" : "bg-[#b63a0d] text-white"}`}>{todoTotal}</span>
          </button>
        </div>

        {activeView === "todo" ? (
          <TodoView operations={operations.data} payables={payables.data} doneTasks={doneTasks} onToggleTask={toggleTask} />
        ) : (
          <div className="mt-4 grid items-start gap-5 min-[1180px]:grid-cols-[minmax(0,1fr)_340px] min-[1500px]:grid-cols-[minmax(0,1fr)_370px]">
            <main className="min-w-0">
              <div className="mb-2 flex items-center justify-between gap-4">
                <h2 className="text-[11px] font-extrabold uppercase text-stone-500">Recurring monthly · projected</h2>
                <button type="button" onClick={() => setProjectedOpen(true)} className="inline-flex items-center gap-1.5 text-[12px] font-bold text-stone-500 hover:text-stone-900">
                  <Pencil size={13} /> Projected expenses
                </button>
              </div>

              {overview.isLoading || projectedSettings.isLoading ? (
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{Array.from({ length: 5 }, (_, index) => <SkeletonPulse key={index} className="h-[108px] w-full" rounded="lg" />)}</div>
              ) : (
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                  <MetricCard label="Net profit" value={`${projectedNet < 0 ? "-" : ""}${formatCurrency(projectedNet)}`} sub={`after ${money.format(projectedExpenseTotal)}/mo expenses`} tone={projectedNet >= 0 ? "good" : "bad"} />
                  <MetricCard label="Net margin" value={`${projectedMargin.toFixed(1)}%`} />
                  <MetricCard label="Revenue" value={formatCurrency(totals.avgRevenue)} />
                  <MetricCard label="Gross profit" value={formatCurrency(totals.avgProfit)} sub="after cleaner pay" />
                  <MetricCard label="Clients" value={String(rows.length)} sub={`${billingCounts.flat} flat · ${billingCounts.perClean} per clean`} />
                </div>
              )}

              <div className="mb-2 mt-4 flex items-center justify-between gap-4">
                <h2 className="text-[11px] font-extrabold uppercase text-stone-500">{format(currentMonth, "MMMM yyyy")} actuals</h2>
                <button type="button" onClick={() => setExpensesOpen(true)} className="inline-flex items-center gap-1.5 text-[12px] font-bold text-stone-500 hover:text-stone-900">
                  <Pencil size={13} /> Manage expenses
                </button>
              </div>
              <div className="overflow-hidden rounded-lg border border-[#e6dfd4] bg-white shadow-[0_1px_2px_rgba(40,30,10,0.04)]">
                {overview.isLoading || expenses.isLoading ? <SkeletonPulse className="h-[78px] w-full" /> : (
                  <div className="grid grid-cols-2 divide-x divide-[#eee8dd] sm:grid-cols-3 lg:grid-cols-6">
                    <ActualCell label="Net Profit" value={`${actualNet < 0 ? "-" : ""}${formatCurrency(actualNet)}`} tone={actualNet >= 0 ? "good" : "bad"} />
                    <ActualCell label="Net Margin" value={`${actualMargin.toFixed(1)}%`} />
                    <ActualCell label="Revenue" value={formatCurrency(totals.periodRevenue)} />
                    <ActualCell label="Cleaner Pay" value={`-${formatCurrency(totals.periodCleanerCost)}`} tone="muted" />
                    <ActualCell label="Gross Profit" value={formatCurrency(totals.periodProfit)} />
                    <ActualCell label="Expenses" value={`-${formatCurrency(actualExpenseTotal)}`} tone="bad" />
                  </div>
                )}
              </div>

              <h2 className="mb-2 mt-4 text-[11px] font-extrabold uppercase text-stone-500">All clients / {rows.length}</h2>
              <div className="overflow-x-auto rounded-lg border border-[#e6dfd4] bg-white shadow-[0_1px_2px_rgba(40,30,10,0.04)]">
                <div className="grid min-w-[820px] grid-cols-[minmax(260px,1fr)_120px_120px_110px_100px_110px] border-b border-[#e9e2d7] px-4 py-2.5 text-[10px] font-bold text-stone-500">
                  <SortHeader label="Client" active={sortBy === "name"} dir={sortDir} align="left" onClick={() => toggleSort("name")} />
                  <SortHeader label="Revenue" active={sortBy === "periodRevenue"} dir={sortDir} onClick={() => toggleSort("periodRevenue")} />
                  <SortHeader label="Cleaner Pay" active={sortBy === "periodCleanerCost"} dir={sortDir} onClick={() => toggleSort("periodCleanerCost")} />
                  <SortHeader label="Profit" active={sortBy === "periodProfit"} dir={sortDir} onClick={() => toggleSort("periodProfit")} />
                  <span className="text-right uppercase">Cleaner</span>
                  <span className="text-right uppercase">Type</span>
                </div>
                {overview.isLoading ? (
                  <div className="p-4"><SkeletonPulse className="h-[320px] w-full" rounded="lg" /></div>
                ) : sortedRows.length ? (
                  <div className="max-h-[420px] overflow-y-auto">
                    {sortedRows.map((row) => (
                      <Link key={row.id} href={`/clients/${row.id}`} className="grid min-w-[820px] grid-cols-[minmax(260px,1fr)_120px_120px_110px_100px_110px] items-center border-b border-[#eee8dd] px-4 py-3 text-[13px] last:border-b-0 hover:bg-[#fffdf8]">
                        <div className="min-w-0">
                          <div className="truncate text-[14px] font-extrabold text-[#171717]">{row.name}</div>
                          <div className="truncate text-[11px] text-stone-500">{row.frequency || `${row.periodJobCount} jobs`}</div>
                        </div>
                        <div className="text-right font-extrabold tabular-nums">{formatCurrency(row.periodRevenue)}</div>
                        <div className="text-right font-semibold tabular-nums text-stone-500">-{formatCurrency(row.periodCleanerCost)}</div>
                        <div className={`text-right font-extrabold tabular-nums ${row.periodProfit >= 0 ? "text-[#087c3d]" : "text-[#c33d0e]"}`}>{row.periodProfit < 0 ? "-" : ""}{formatCurrency(row.periodProfit)}</div>
                        <div className="truncate text-right text-[12px] font-medium text-stone-600">{shortenName(row.cleanerAssigned)}</div>
                        <div className="truncate text-right text-[12px] font-medium text-stone-600">{row.clientPayType.replace("Flat Rate", "Monthly Flat")}</div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="py-14 text-center text-[13px] text-stone-400">No active clients with schedules.</div>
                )}
              </div>
            </main>

            <OperationsRail operations={operations.data} payables={payables.data} doneTasks={doneTasks} onToggleTask={toggleTask} />
          </div>
        )}
      </div>

      <ProjectedExpensesModal
        open={projectedOpen}
        onClose={() => setProjectedOpen(false)}
        values={projected}
        actualAverage={actualAverage}
        onSave={saveProjectedExpenses}
      />
      <ExpensesModal
        open={expensesOpen}
        onClose={() => setExpensesOpen(false)}
        selectedMonth={currentMonth}
        data={expenses.data}
        isLoading={expenses.isLoading}
        mutate={expenses.mutate}
        onSelectMonth={setCurrentMonth}
      />
    </div>
  )
}

function SortHeader({
  label,
  active,
  dir,
  align = "right",
  onClick,
}: {
  label: string
  active: boolean
  dir: "asc" | "desc"
  align?: "left" | "right"
  onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} className={`${align === "left" ? "text-left" : "text-right"} uppercase hover:text-stone-900 ${active ? "text-stone-900" : "text-stone-500"}`}>
      {label} {active ? (dir === "desc" ? "v" : "^") : ""}
    </button>
  )
}
