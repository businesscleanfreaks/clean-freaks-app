"use client"

import { useState, useCallback, useMemo } from "react"
import useSWR from "swr"
import { format, startOfMonth, endOfMonth } from "date-fns"
import { fetcher } from "@/lib/fetcher"
import { InvoicesPageClient } from "./invoices-page-client"
import { InvoicesSkeleton } from "@/components/skeletons/invoices-skeleton"
import { showError } from "@/lib/toast"

export function InvoicesClient() {
  const [allInvoices, setAllInvoices] = useState<any[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  // Display month for UI filtering (default: current month). API always fetches all unbilled.
  const [displayMonth, setDisplayMonth] = useState(() => format(new Date(), 'yyyy-MM'))

  // Compute candidate API date range from displayMonth
  const candidateParams = useMemo(() => {
    if (!displayMonth || displayMonth === 'all') return null
    const [y, m] = displayMonth.split('-').map(Number)
    const monthDate = new Date(y, m - 1)
    return {
      start: format(startOfMonth(monthDate), 'yyyy-MM-dd'),
      end: format(endOfMonth(monthDate), 'yyyy-MM-dd'),
    }
  }, [displayMonth])

  const candidateUrl = candidateParams
    ? `/api/invoices/candidates?start=${candidateParams.start}&end=${candidateParams.end}`
    : null

  const { data, error, isLoading, mutate } = useSWR(
    '/api/invoices/data?period=all',
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 30000,
      onSuccess: (freshData) => {
        setAllInvoices(freshData.invoices || [])
        setHasMore(freshData.hasMore || false)
        setNextCursor(freshData.nextCursor || null)
      },
    }
  )

  // Fetch candidates for the selected month
  const { data: candidateData, isLoading: candidatesLoading, mutate: mutateCandidates } = useSWR(
    candidateUrl,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 15000,
    }
  )

  const handleLoadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const res = await fetch(`/api/invoices/data?period=all&cursor=${nextCursor}&limit=50`)
      if (!res.ok) throw new Error('Failed to load more invoices')
      const moreData = await res.json()
      setAllInvoices(prev => [...prev, ...(moreData.invoices || [])])
      setHasMore(moreData.hasMore || false)
      setNextCursor(moreData.nextCursor || null)
    } catch {
      showError('Failed to load more invoices')
    } finally {
      setLoadingMore(false)
    }
  }, [nextCursor, loadingMore])

  const handleDataChange = useCallback(() => {
    setAllInvoices([])
    setNextCursor(null)
    mutate()
    mutateCandidates()
  }, [mutate, mutateCandidates])

  if (isLoading) {
    return <InvoicesSkeleton />
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-2">Failed to load invoices</p>
          <button
            onClick={() => mutate()}
            className="text-emerald-600 hover:underline"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  return (
    <InvoicesPageClient
      flatRateClients={data?.flatRateClients || []}
      perCleanClients={data?.perCleanClients || []}
      totalReadyToBill={data?.totalReadyToBill || 0}
      draftsCount={data?.draftsCount || 0}
      waitingCount={data?.waitingCount || 0}
      paidCount={data?.paidCount || 0}
      readyCount={data?.readyCount || 0}
      invoices={allInvoices}
      onDataChange={handleDataChange}
      hasMore={hasMore}
      loadingMore={loadingMore}
      onLoadMore={handleLoadMore}
      displayMonth={displayMonth}
      onDisplayMonthChange={setDisplayMonth}
      candidates={candidateData?.candidates || []}
      candidateStats={candidateData?.stats || null}
      candidatesLoading={candidatesLoading}
      olderUninvoiced={candidateData?.olderUninvoiced || null}
    />
  )
}
