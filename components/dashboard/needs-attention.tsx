"use client"

import Link from "next/link"
import { AlertCircle, Calendar, FileText, DollarSign, ChevronRight } from "lucide-react"

interface NeedsAttentionProps {
  unassignedJobsCount: number
  overdueInvoicesCount: number
  pendingPayoutsCount: number
  pendingPayoutsTotal: number
}

export function NeedsAttention({
  unassignedJobsCount,
  overdueInvoicesCount,
  pendingPayoutsCount,
  pendingPayoutsTotal,
}: NeedsAttentionProps) {
  const hasItems = unassignedJobsCount > 0 || overdueInvoicesCount > 0 || (pendingPayoutsCount > 0 && pendingPayoutsTotal > 1000)
  
  if (!hasItems) return null

  const items = []

  if (unassignedJobsCount > 0) {
    items.push({
      id: 'unassigned',
      icon: Calendar,
      label: `${unassignedJobsCount} job${unassignedJobsCount !== 1 ? 's' : ''} need a cleaner today`,
      href: '/calendar',
      actionLabel: 'Assign',
      color: 'warning' as const,
    })
  }

  if (overdueInvoicesCount > 0) {
    items.push({
      id: 'overdue',
      icon: FileText,
      label: `${overdueInvoicesCount} overdue invoice${overdueInvoicesCount !== 1 ? 's' : ''}`,
      href: '/invoices',
      actionLabel: 'View',
      color: 'destructive' as const,
    })
  }

  if (pendingPayoutsCount > 0 && pendingPayoutsTotal > 1000) {
    items.push({
      id: 'payouts',
      icon: DollarSign,
      label: `$${Math.round(pendingPayoutsTotal).toLocaleString()} owed to ${pendingPayoutsCount} cleaner${pendingPayoutsCount !== 1 ? 's' : ''}`,
      href: '/subcontractors',
      actionLabel: 'Pay',
      color: 'warning' as const,
    })
  }

  const colorMap = {
    warning: 'var(--cf-warning)',
    destructive: 'var(--cf-destructive)',
  }

  return (
    <div className="mb-6" role="alert">
      <div className="flex items-center gap-2 mb-3">
        <AlertCircle className="w-4 h-4 text-cf-destructive" />
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Needs Attention</h2>
      </div>
      
      <div className="space-y-2">
        {items.map((item) => {
          const accent = colorMap[item.color]
          const Icon = item.icon
          
          return (
            <Link
              key={item.id}
              href={item.href}
              className="flex items-center gap-3 p-3 rounded-xl bg-white border border-cf-border-subtle transition-all hover:shadow-md active:scale-[0.99] group"
              style={{ borderLeft: `3px solid ${accent}` }}
            >
              <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-cf-bg-subtle">
                <Icon className="w-5 h-5" style={{ color: accent }} />
              </div>
              
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-800 truncate">{item.label}</p>
              </div>
              
              <div 
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white flex items-center gap-1 transition-transform group-hover:translate-x-0.5 shadow-sm"
                style={{ backgroundColor: accent }}
              >
                {item.actionLabel}
                <ChevronRight className="w-4 h-4" />
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
