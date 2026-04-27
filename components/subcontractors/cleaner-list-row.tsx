"use client"

import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { formatCurrency } from "@/lib/utils"
import { getCleanerColorInfo, CLEANER_HEX_COLORS } from "@/lib/calendar-design-tokens"
import { differenceInDays, format } from "date-fns"
import { CheckCircle2, ChevronDown } from "lucide-react"
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
  const router = useRouter()
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

  const handleClick = () => {
    if (onToggleExpand) {
      onToggleExpand(sub.id)
    } else {
      router.push(`/subcontractors/${sub.id}`)
    }
  }

  return (
    <div
      className={`flex items-center gap-4 px-4 py-3 cursor-pointer transition-colors ${isExpanded ? 'bg-teal-50/40' : 'hover:bg-gray-50 active:bg-gray-100'}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') handleClick() }}
    >
      {/* Avatar */}
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm flex-shrink-0"
        style={{ backgroundColor: hex }}
      >
        {initials}
      </div>

      {/* Name + status + subtitle */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Link
            href={`/subcontractors/${sub.id}`}
            onClick={(e) => e.stopPropagation()}
            className="font-semibold text-gray-900 truncate text-[15px] hover:text-teal-600 transition-colors"
          >
            {sub.name}
          </Link>
          <span className="flex items-center gap-1 flex-shrink-0">
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: status.dotColor }} />
            <span className="text-xs text-gray-500">{status.label}</span>
          </span>
        </div>
        <p className="text-sm text-gray-400 truncate">{subtitle}</p>
      </div>

      {/* Amount + action */}
      {isPaidUp ? (
        <div className="flex items-center gap-1.5 text-teal-600 flex-shrink-0">
          <CheckCircle2 className="w-4 h-4" />
          <span className="text-sm font-medium">$0</span>
        </div>
      ) : (
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="font-bold text-gray-900 text-[15px] tabular-nums">
            {formatCurrency(owed)}
          </span>
          <Button
            size="sm"
            className="bg-teal-600 hover:bg-teal-700 text-white h-8 px-4 text-sm font-medium rounded-lg"
            onClick={(e) => { e.stopPropagation(); onPay(sub) }}
          >
            Pay
          </Button>
        </div>
      )}

      {/* Expand chevron */}
      {onToggleExpand && (
        <ChevronDown
          className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
        />
      )}
    </div>
  )
}
