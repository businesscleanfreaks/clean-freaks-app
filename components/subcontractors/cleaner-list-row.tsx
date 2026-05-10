"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { formatCurrency } from "@/lib/utils"
import { getCleanerColorInfo } from "@/lib/calendar-design-tokens"
import { differenceInDays, format } from "date-fns"
import { CheckCircle2, ChevronDown, User } from "lucide-react"
import type { CleanerData, CleanerJob } from "@/types"

interface PaymentGroup {
  id: string
  type: 'FLAT_RATE' | 'PER_CLEAN'
  amount: number
  jobCount?: number
}

function getPaymentGroupsForRow(sub: CleanerData): PaymentGroup[] {
  const groups: PaymentGroup[] = []
  const jobsByClient = new Map<string, CleanerJob[]>()

  ;(sub.jobs || []).forEach(job => {
    if (!job.location?.client) return
    const clientId = job.location.client.id
    if (!jobsByClient.has(clientId)) jobsByClient.set(clientId, [])
    jobsByClient.get(clientId)!.push(job)
  })

  const allPerCleanJobs: CleanerJob[] = []

  jobsByClient.forEach((jobs) => {
    const client = jobs[0].location.client
    const payType = (client.cleanerPayType || 'PER_CLEAN') as 'FLAT_RATE' | 'PER_CLEAN'

    if (payType === 'FLAT_RATE') {
      const jobsByMonth = new Map<string, CleanerJob[]>()
      jobs.forEach(job => {
        const monthKey = format(new Date(job.date), 'yyyy-MM')
        if (!jobsByMonth.has(monthKey)) jobsByMonth.set(monthKey, [])
        jobsByMonth.get(monthKey)!.push(job)
      })
      jobsByMonth.forEach((monthJobs, monthKey) => {
        groups.push({
          id: `${client.id}-${monthKey}`,
          type: 'FLAT_RATE',
          amount: monthJobs[0].subcontractorRate,
        })
      })
    } else {
      allPerCleanJobs.push(...jobs)
    }
  })

  if (allPerCleanJobs.length > 0) {
    const perCleanByMonth = new Map<string, CleanerJob[]>()
    allPerCleanJobs.forEach(job => {
      const monthKey = format(new Date(job.date), 'yyyy-MM')
      if (!perCleanByMonth.has(monthKey)) perCleanByMonth.set(monthKey, [])
      perCleanByMonth.get(monthKey)!.push(job)
    })
    perCleanByMonth.forEach((monthJobs, monthKey) => {
      groups.push({
        id: `perclean-${monthKey}`,
        type: 'PER_CLEAN',
        amount: monthJobs.reduce((sum, j) => sum + j.subcontractorRate, 0),
        jobCount: monthJobs.length,
      })
    })
  }

  return groups
}

export function getCorrectOwedAmount(sub: CleanerData): number {
  return getPaymentGroupsForRow(sub).reduce((sum, g) => sum + g.amount, 0)
}

function getSummaryText(sub: CleanerData): string {
  const groups = getPaymentGroupsForRow(sub)
  const flatRateCount = groups.filter(g => g.type === 'FLAT_RATE').length
  const totalJobs = groups.filter(g => g.type === 'PER_CLEAN').reduce((sum, g) => sum + (g.jobCount || 0), 0)

  const parts: string[] = []
  if (flatRateCount > 0) parts.push(`${flatRateCount} month${flatRateCount !== 1 ? 's' : ''}`)
  if (totalJobs > 0) parts.push(`${totalJobs} clean${totalJobs !== 1 ? 's' : ''}`)
  return parts.join(' · ') || 'No jobs'
}

function getStatusInfo(sub: CleanerData, owed: number) {
  if (owed === 0) {
    return { label: 'Paid Up', dotColor: '#0d9488' }
  }
  const lastPayment = sub.payments?.[0]
  if (!lastPayment) {
    return { label: 'Never Paid', dotColor: '#9ca3af' }
  }
  const daysSince = differenceInDays(new Date(), new Date(lastPayment.datePaid))
  if (daysSince > 30) {
    return { label: 'Overdue', dotColor: '#E53935' }
  }
  if (daysSince > 14) {
    return { label: 'Due Soon', dotColor: '#f59e0b' }
  }
  return { label: 'Recent', dotColor: '#0d9488' }
}

interface CleanerListRowProps {
  sub: CleanerData
  owed: number
  onPay: (sub: CleanerData) => void
  onToggleExpand?: (subId: string) => void
  isExpanded?: boolean
}

export function CleanerListRow({ sub, owed, onPay, onToggleExpand, isExpanded }: CleanerListRowProps) {
  const status = getStatusInfo(sub, owed)
  const { hex } = getCleanerColorInfo(sub.name)
  const lastPayment = sub.payments?.[0]
  const isPaidUp = owed === 0

  const summaryParts: string[] = []
  if (!isPaidUp) summaryParts.push(getSummaryText(sub))
  if (lastPayment) {
    summaryParts.push(`Last paid ${format(new Date(lastPayment.datePaid), 'MMM d')}`)
  } else if (isPaidUp) {
    summaryParts.push('No payments yet')
  }
  const subtitle = summaryParts.join(' · ')

  const initials = sub.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 transition-colors ${isExpanded ? 'bg-teal-50/40' : ''}`}
    >
      {/* Avatar — links to profile */}
      <Link
        href={`/subcontractors/${sub.id}`}
        className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm flex-shrink-0 hover:ring-2 hover:ring-teal-400 hover:ring-offset-1 transition-all"
        style={{ backgroundColor: hex }}
      >
        {initials}
      </Link>

      {/* Name + status + subtitle — links to profile */}
      <Link href={`/subcontractors/${sub.id}`} className="flex-1 min-w-0 no-underline group">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-gray-900 truncate text-[15px] group-hover:text-teal-600 transition-colors">
            {sub.name}
          </span>
          <span className="flex items-center gap-1 flex-shrink-0">
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: status.dotColor }} />
            <span className="text-xs text-gray-500">{status.label}</span>
          </span>
        </div>
        <p className="text-sm text-gray-400 truncate">{subtitle}</p>
      </Link>

      {/* Amount + actions */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {isPaidUp ? (
          <div className="flex items-center gap-1.5 text-teal-600">
            <CheckCircle2 className="w-4 h-4" />
            <span className="text-sm font-medium">$0</span>
          </div>
        ) : (
          <>
            <span className="font-bold text-gray-900 text-[15px] tabular-nums">
              {formatCurrency(owed)}
            </span>
            <Button
              size="sm"
              className="bg-teal-600 hover:bg-teal-700 text-white h-8 px-3 text-sm font-medium rounded-lg"
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); onPay(sub) }}
            >
              Pay
            </Button>
          </>
        )}

        {/* Open Profile button — always visible */}
        <Link
          href={`/subcontractors/${sub.id}`}
          className="inline-flex items-center gap-1 h-8 px-2.5 text-xs font-medium text-teal-600 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg transition-colors no-underline"
          title="Open Profile"
        >
          <User className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Profile</span>
        </Link>

        {/* Expand chevron for quick inline details */}
        {onToggleExpand && (
          <button
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); onToggleExpand(sub.id) }}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label={isExpanded ? 'Collapse details' : 'Expand details'}
          >
            <ChevronDown
              className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
            />
          </button>
        )}
      </div>
    </div>
  )
}
