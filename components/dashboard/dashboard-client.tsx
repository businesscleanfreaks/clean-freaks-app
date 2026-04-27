"use client"

import useSWR from "swr"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { DashboardStats } from "@/components/dashboard/dashboard-stats"
import { NoOverdueInvoicesBanner } from "@/components/dashboard/no-overdue-banner"
import { NeedsAttention } from "@/components/dashboard/needs-attention"
import { TodaysJobs } from "@/components/dashboard/todays-jobs"
import { MoneyToCollect } from "@/components/dashboard/money-to-collect"
import { SkeletonPulse } from "@/components/ui/skeleton-pulse"

interface TodaysJobItem {
  id: string
  clientName: string
  locationName: string
  cleanerName: string | null
  startTime: string | null
  status: string
}

interface DashboardStatsData {
  mrr: number
  recurringProfit: number
  recurringClientsCount: number
  outstandingClientBalance: number
  totalJobsThisMonth: number
  jobsTodayCount: number
  jobsCompletedTodayCount: number
  overdueInvoicesCount: number
  pendingInvoicesCount: number
  pendingInvoicesAmount: number
  unassignedJobsCount: number
  pendingPayoutsCount: number
  pendingPayoutsTotal: number
  sentInvoicesCount: number
  sentInvoicesAmount: number
  todaysJobsList: TodaysJobItem[]
}

const fetcher = (url: string) => fetch(url).then(res => {
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
})

function StatsLoadingSkeleton() {
  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="bg-white rounded-xl p-4 shadow-sm border border-cf-border-subtle">
          <div className="flex items-center justify-between mb-3">
            <SkeletonPulse className="h-3 w-24" />
            <SkeletonPulse className="h-9 w-9" rounded="lg" />
          </div>
          <SkeletonPulse className="h-8 w-28 mb-2" />
        </div>
      ))}
    </div>
  )
}

function NeedsAttentionSkeleton() {
  return (
    <div className="mb-6">
      <SkeletonPulse className="h-16 w-full" rounded="xl" />
    </div>
  )
}

function JobsListSkeleton() {
  return (
    <div className="mb-6">
      <SkeletonPulse className="h-4 w-28 mb-3" />
      <div className="bg-white rounded-xl border border-cf-border-subtle overflow-hidden">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: i < 2 ? '1px solid #F3F3F3' : 'none' }}>
            <SkeletonPulse className="h-2.5 w-2.5" rounded="full" />
            <div className="flex-1">
              <SkeletonPulse className="h-4 w-32 mb-1" />
              <SkeletonPulse className="h-3 w-20" />
            </div>
            <SkeletonPulse className="h-3 w-12" />
            <SkeletonPulse className="h-3 w-16" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function DashboardClient() {
  const { data: stats, error, isLoading } = useSWR<DashboardStatsData>(
    '/api/dashboard-stats',
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 30000,
    }
  )

  const safeStats: DashboardStatsData = stats || {
    mrr: 0,
    recurringProfit: 0,
    recurringClientsCount: 0,
    outstandingClientBalance: 0,
    totalJobsThisMonth: 0,
    jobsTodayCount: 0,
    jobsCompletedTodayCount: 0,
    overdueInvoicesCount: 0,
    pendingInvoicesCount: 0,
    pendingInvoicesAmount: 0,
    unassignedJobsCount: 0,
    pendingPayoutsCount: 0,
    pendingPayoutsTotal: 0,
    sentInvoicesCount: 0,
    sentInvoicesAmount: 0,
    todaysJobsList: [],
  }

  return (
    <div className="w-full px-4 sm:px-6 pt-2 sm:pt-4 pb-4 sm:py-6 lg:pt-6">
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          <strong>Error loading dashboard:</strong> {error.message}
        </div>
      )}

      <div className="mt-4 sm:mt-2 lg:mt-0">
        <DashboardHeader jobsToday={isLoading ? undefined : safeStats.jobsTodayCount} />
      </div>

      {isLoading ? (
        <NeedsAttentionSkeleton />
      ) : (
        <NeedsAttention
          unassignedJobsCount={safeStats.unassignedJobsCount}
          overdueInvoicesCount={safeStats.overdueInvoicesCount}
          pendingPayoutsCount={safeStats.pendingPayoutsCount}
          pendingPayoutsTotal={safeStats.pendingPayoutsTotal}
        />
      )}

      {/* Today's Jobs - Morning Command Center */}
      {isLoading ? (
        <JobsListSkeleton />
      ) : (
        <TodaysJobs
          jobs={safeStats.todaysJobsList}
          jobsCompleted={safeStats.jobsCompletedTodayCount}
        />
      )}

      {/* Money to Collect */}
      <section aria-label="Money to collect">
        {isLoading ? (
          <div className="bg-white rounded-xl p-6 shadow-sm border border-cf-border-subtle mb-6">
            <SkeletonPulse className="h-6 w-32 mb-4" />
            <div className="space-y-3">
              {[0, 1].map((i) => (
                <SkeletonPulse key={i} className="h-10 w-full" />
              ))}
            </div>
          </div>
        ) : (
          <MoneyToCollect
            pendingInvoices={safeStats.pendingInvoicesCount}
            pendingInvoicesAmount={safeStats.pendingInvoicesAmount}
            sentInvoicesCount={safeStats.sentInvoicesCount}
            sentInvoicesAmount={safeStats.sentInvoicesAmount}
          />
        )}
      </section>

      {!isLoading && (
        <NoOverdueInvoicesBanner show={safeStats.overdueInvoicesCount === 0} />
      )}

      {/* Business Health Strip — compact metrics at bottom */}
      <section aria-label="Key metrics">
        <h2 className="sr-only">Key Metrics</h2>
        {isLoading ? (
          <StatsLoadingSkeleton />
        ) : (
          <DashboardStats
            mrr={safeStats.mrr}
            recurringProfit={safeStats.recurringProfit}
            recurringClientsCount={safeStats.recurringClientsCount}
          />
        )}
      </section>
    </div>
  )
}

