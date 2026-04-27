"use client"

import { useState } from "react"
import { TrendingUp, Users, DollarSign, Percent, Info } from "lucide-react"
import { formatCurrency } from "@/lib/utils"

interface DashboardStatsProps {
  mrr: number
  recurringProfit: number
  recurringClientsCount: number
}

function StatCard({ title, value, icon, tooltip, small }: {
  title: string
  value: string
  icon: React.ReactNode
  tooltip: string
  small?: boolean
}) {
  const [showTooltip, setShowTooltip] = useState(false)

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-cf-border-subtle relative">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-cf-text-muted uppercase tracking-wide">{title}</span>
          <button
            type="button"
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
            onClick={() => setShowTooltip(!showTooltip)}
            className="text-cf-text-disabled hover:text-cf-text-muted transition-colors"
            aria-label={`How ${title} is calculated`}
          >
            <Info className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="h-9 w-9 rounded-lg bg-cf-bg-subtle flex items-center justify-center">
          {icon}
        </div>
      </div>
      <p className={`font-bold text-cf-text-primary tabular-nums ${small ? 'text-xl' : 'text-2xl'}`}>{value}</p>

      {/* Tooltip */}
      {showTooltip && (
        <div
          className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 z-50 pointer-events-none"
          style={{ minWidth: '200px', maxWidth: '260px' }}
        >
          <div
            className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-lg"
            style={{ lineHeight: 1.5 }}
          >
            {tooltip}
          </div>
          <div className="w-2.5 h-2.5 bg-gray-900 rotate-45 mx-auto -mt-1.5" />
        </div>
      )}
    </div>
  )
}

export function DashboardStats({
  mrr,
  recurringProfit,
  recurringClientsCount,
}: DashboardStatsProps) {
  const averageMargin = mrr > 0 ? ((recurringProfit / mrr) * 100) : 0

  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 mb-6 items-stretch">
      <StatCard
        title="Monthly Recurring"
        value={formatCurrency(mrr)}
        icon={<DollarSign className="w-5 h-5 text-cf-icon-muted" />}
        tooltip="Per-clean clients: rate × avg cleans/month (52-week annualized ÷ 12). Flat rate clients: monthly rate as-is. Includes recurring add-on revenue at their own frequency."
      />
      <StatCard
        title="Recurring Gross Profit"
        value={formatCurrency(recurringProfit)}
        icon={<TrendingUp className="w-5 h-5 text-cf-icon-muted" />}
        tooltip="MRR minus monthly subcontractor costs (same 52/12 averaging). Flat rate cleaner pay counted once per month."
      />
      <StatCard
        title="Average Margin"
        value={`${averageMargin.toFixed(1)}%`}
        icon={<Percent className="w-5 h-5 text-cf-icon-muted" />}
        tooltip="Gross Profit ÷ MRR × 100. Shows how much of each dollar billed is retained after paying cleaners."
      />
      <StatCard
        title="Clients"
        value={String(recurringClientsCount)}
        icon={<Users className="w-5 h-5 text-cf-icon-muted" />}
        tooltip="Active clients with at least one active cleaning schedule."
        small
      />
    </div>
  )
}
