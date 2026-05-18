"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import { addMonths, format, subMonths } from "date-fns"
import { ChevronLeft, ChevronRight, Settings2 } from "lucide-react"
import { SkeletonPulse } from "@/components/ui/skeleton-pulse"

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
  period: {
    year: number
    month: number
    label: string
  }
}

const fetcher = (url: string) => fetch(url).then(res => {
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
})

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value || 0)

type SortKey = 'periodRevenue' | 'periodProfit' | 'avgRevenue' | 'avgProfit'

function shortenName(name: string) {
  if (!name || name === 'Unassigned') return name || 'Unassigned'
  const companyMap: Record<string, string> = {
    'Celeste Cleaning Co.': 'Celeste C.',
    'Rose Cleaning Co': 'Rose C.',
    'Amy\'s Angels': 'Amy\'s A.',
  }
  if (companyMap[name]) return companyMap[name]

  const cleaned = name.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim()
  const parts = cleaned.split(' ').filter(Boolean)
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[1][0]}.`
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
  tone?: 'good' | 'bad'
}) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-4 py-3">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-stone-400">
        {label}
      </div>
      <div className={`font-mono text-2xl font-bold tracking-[-0.03em] ${tone === 'good' ? 'text-emerald-600' : tone === 'bad' ? 'text-red-600' : 'text-stone-950'}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-stone-400">{sub}</div>}
    </div>
  )
}

export function DashboardClient() {
  const [currentMonth, setCurrentMonth] = useState(() => new Date())
  const [sortBy, setSortBy] = useState<SortKey>('periodRevenue')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [showSettings, setShowSettings] = useState(false)
  const [overhead, setOverhead] = useState(800)
  const [marketing, setMarketing] = useState(1800)
  const [vaCost, setVaCost] = useState(1800)
  const [taxRate, setTaxRate] = useState(15)

  const year = currentMonth.getFullYear()
  const month = currentMonth.getMonth()
  const { data, error, isLoading } = useSWR<ClientOverviewData>(
    `/api/dashboard/client-overview?year=${year}&month=${month}`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30000 }
  )

  const rows = data?.clients || []
  const totals = data?.totals || {
    avgRevenue: 0,
    avgCleanerCost: 0,
    avgProfit: 0,
    periodRevenue: 0,
    periodCleanerCost: 0,
    periodProfit: 0,
    periodJobCount: 0,
  }

  const deductions = overhead + marketing + vaCost
  const taxMultiplier = (100 - taxRate) / 100
  const recurringNetProfit = Math.round((totals.avgProfit - deductions) * taxMultiplier)
  const periodNetProfit = Math.round((totals.periodProfit - deductions) * taxMultiplier)
  const periodNetMargin = totals.periodRevenue > 0 ? (periodNetProfit / totals.periodRevenue) * 100 : 0
  const recurringNetMargin = totals.avgRevenue > 0 ? (recurringNetProfit / totals.avgRevenue) * 100 : 0

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const aVal = a[sortBy] || 0
      const bVal = b[sortBy] || 0
      return sortDir === 'desc' ? bVal - aVal : aVal - bVal
    })
  }, [rows, sortBy, sortDir])

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir(current => current === 'desc' ? 'asc' : 'desc')
    } else {
      setSortBy(key)
      setSortDir('desc')
    }
  }

  const clientTypeCounts = rows.reduce(
    (acc, row) => {
      if (row.clientPayType.toLowerCase().includes('flat')) acc.flat += 1
      else acc.perClean += 1
      return acc
    },
    { flat: 0, perClean: 0 }
  )

  return (
    <div className="min-h-full bg-[#F8F7F4] px-5 py-7 text-stone-950 sm:px-8">
      <div className="mx-auto max-w-[1200px]">
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <strong>Error loading dashboard:</strong> {error.message}
          </div>
        )}

        <div className="mb-5 flex items-end justify-between border-b-2 border-stone-950 pb-3">
          <div>
            <h1 className="text-3xl font-bold tracking-[-0.04em]">Dashboard</h1>
            <p className="mt-0.5 text-sm text-stone-400">{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
          </div>
          <div className="flex items-center overflow-hidden rounded-md border border-stone-200 bg-white">
            <button
              type="button"
              onClick={() => setCurrentMonth(d => subMonths(d, 1))}
              className="border-r border-stone-200 px-2.5 py-1.5 text-stone-500 hover:bg-stone-50"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-5 py-1.5 text-sm font-semibold">{format(currentMonth, 'MMMM yyyy')}</span>
            <button
              type="button"
              onClick={() => setCurrentMonth(d => addMonths(d, 1))}
              className="border-l border-stone-200 px-2.5 py-1.5 text-stone-500 hover:bg-stone-50"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mb-2 flex items-center justify-between">
          <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-stone-400">Recurring Monthly</div>
          <button
            type="button"
            onClick={() => setShowSettings(current => !current)}
            className="inline-flex items-center gap-1 text-xs font-medium text-stone-400 hover:text-stone-700"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Settings
          </button>
        </div>

        {showSettings && (
          <div className="mb-3 rounded-lg border border-stone-200 bg-white p-4">
            <div className="grid gap-3 sm:grid-cols-4">
              {[
                ['Overhead', overhead, setOverhead, '$'],
                ['Marketing', marketing, setMarketing, '$'],
                ['VA Cost', vaCost, setVaCost, '$'],
                ['Tax Rate', taxRate, setTaxRate, '%'],
              ].map(([label, value, setter, suffix]) => (
                <label key={label as string} className="block">
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.06em] text-stone-400">{label as string}</span>
                  <div className="flex items-center gap-1">
                    {suffix === '$' && <span className="text-xs text-stone-400">$</span>}
                    <input
                      type="number"
                      value={value as number}
                      onChange={e => (setter as (value: number) => void)(Number(e.target.value) || 0)}
                      className="w-full rounded border border-stone-200 bg-[#F8F7F4] px-2 py-1 font-mono text-sm outline-none focus:border-teal-500"
                    />
                    {suffix === '%' && <span className="text-xs text-stone-400">%</span>}
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="mb-5 grid grid-cols-2 gap-2 lg:grid-cols-5">
            {[0, 1, 2, 3, 4].map(i => <SkeletonPulse key={i} className="h-24 w-full" rounded="lg" />)}
          </div>
        ) : (
          <div className="mb-5 grid grid-cols-2 gap-2 lg:grid-cols-5">
            <MetricCard label="Revenue" value={formatCurrency(totals.avgRevenue)} />
            <MetricCard label="Gross Profit" value={formatCurrency(totals.avgProfit)} />
            <MetricCard label="Net Profit" value={formatCurrency(recurringNetProfit)} tone={recurringNetProfit >= 0 ? 'good' : 'bad'} />
            <MetricCard label="Net Margin" value={`${recurringNetMargin.toFixed(1)}%`} />
            <MetricCard label="Clients" value={String(rows.length)} sub={`${clientTypeCounts.flat} flat · ${clientTypeCounts.perClean} per clean`} />
          </div>
        )}

        <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.08em] text-stone-400">{format(currentMonth, 'MMMM yyyy')} Actuals</div>
        <div className="mb-5 overflow-hidden rounded-lg border border-stone-200 bg-white">
          {isLoading ? (
            <SkeletonPulse className="h-20 w-full" />
          ) : (
            <div className="grid grid-cols-2 divide-x divide-stone-100 sm:grid-cols-6">
              <PnlCell label="Revenue" value={formatCurrency(totals.periodRevenue)} />
              <PnlCell label="Cleaner Pay" value={`-${formatCurrency(totals.periodCleanerCost)}`} />
              <PnlCell label="Gross Profit" value={formatCurrency(totals.periodProfit)} />
              <PnlCell label="Deductions" value={`-${formatCurrency(deductions)}`} />
              <PnlCell label="Net Profit" value={formatCurrency(periodNetProfit)} tone={periodNetProfit >= 0 ? 'good' : 'bad'} />
              <PnlCell label="Net Margin" value={`${periodNetMargin.toFixed(1)}%`} />
            </div>
          )}
        </div>

        <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.08em] text-stone-400">All Clients · {rows.length}</div>
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
          <div className="grid grid-cols-[minmax(260px,1fr)_120px_120px_100px_86px] border-b border-stone-950 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.06em] text-stone-500">
            <span>Client</span>
            <SortHeader label="Revenue" active={sortBy === 'periodRevenue'} dir={sortDir} onClick={() => toggleSort('periodRevenue')} />
            <SortHeader label="Profit" active={sortBy === 'periodProfit'} dir={sortDir} onClick={() => toggleSort('periodProfit')} />
            <span className="text-right">Cleaner</span>
            <span className="text-right">Type</span>
          </div>
          {isLoading ? (
            <div className="p-4">
              <SkeletonPulse className="h-64 w-full" rounded="lg" />
            </div>
          ) : (
            <div className="max-h-[480px] overflow-y-auto">
              {sortedRows.map((row, index) => (
                <div
                  key={row.id}
                  className="grid grid-cols-[minmax(260px,1fr)_120px_120px_100px_86px] items-center border-b border-stone-100 px-4 py-2 text-sm transition-colors last:border-b-0 hover:bg-stone-50"
                >
                  <div className="min-w-0">
                    <div className="font-semibold leading-tight">{row.name}</div>
                    <div className="truncate text-xs text-stone-400">{row.frequency || `${row.periodJobCount} jobs`}</div>
                  </div>
                  <div className="text-right font-mono font-semibold">{formatCurrency(row.periodRevenue)}</div>
                  <div className={`text-right font-mono font-semibold ${row.periodProfit > 0 ? 'text-emerald-600' : row.periodProfit < 0 ? 'text-red-600' : 'text-stone-400'}`}>
                    {formatCurrency(row.periodProfit)}
                  </div>
                  <div className="text-right text-xs text-stone-500">{shortenName(row.cleanerAssigned)}</div>
                  <div className="text-right text-xs text-stone-400">{row.clientPayType.replace('Flat Rate', 'Flat')}</div>
                </div>
              ))}
            </div>
          )}
          {!isLoading && (
            <div className="grid grid-cols-[minmax(260px,1fr)_120px_120px_100px_86px] border-t-2 border-stone-950 bg-stone-50 px-4 py-2 text-sm font-bold">
              <span>Total</span>
              <span className="text-right font-mono">{formatCurrency(totals.periodRevenue)}</span>
              <span className="text-right font-mono text-emerald-600">{formatCurrency(totals.periodProfit)}</span>
              <span />
              <span />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PnlCell({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="px-4 py-3">
      <div className="mb-0.5 text-[10px] text-stone-400">{label}</div>
      <div className={`font-mono text-lg font-bold tracking-[-0.03em] ${tone === 'good' ? 'text-emerald-600' : tone === 'bad' ? 'text-red-600' : 'text-stone-950'}`}>
        {value}
      </div>
    </div>
  )
}

function SortHeader({ label, active, dir, onClick }: { label: string; active: boolean; dir: 'asc' | 'desc'; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`text-right hover:text-stone-950 ${active ? 'text-stone-950' : 'text-stone-500'}`}>
      {label} {active ? (dir === 'desc' ? '↓' : '↑') : ''}
    </button>
  )
}
