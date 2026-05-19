"use client"

import { useEffect, useState } from "react"
import useSWR, { mutate as globalMutate } from "swr"
import { CalendarView } from "./calendar-view"
import type { JobWithFullRelations, ClientWithLocations, Subcontractor } from "@/types"

interface CalendarData {
  jobs: JobWithFullRelations[]
  clients: ClientWithLocations[]
  subcontractors: Subcontractor[]
}

export const CALENDAR_SWR_KEY = '/api/calendar/data'
const CALENDAR_CACHE_KEY = 'cleanfreaks-calendar-data-v1'

export function refreshCalendarData(patch?: { jobId: string; updates?: Record<string, unknown>; remove?: boolean }) {
  if (patch?.remove) {
    return globalMutate(
      CALENDAR_SWR_KEY,
      (data: CalendarData | undefined) => {
        if (!data) return data
        return {
          ...data,
          jobs: data.jobs.filter((j) => j.id !== patch.jobId),
        }
      },
      { revalidate: true }
    )
  }
  if (patch?.updates) {
    return globalMutate(
      CALENDAR_SWR_KEY,
      (data: CalendarData | undefined) => {
        if (!data) return data
        return {
          ...data,
          jobs: data.jobs.map((j) =>
            j.id === patch.jobId ? { ...j, ...patch.updates } : j
          ),
        }
      },
      { revalidate: true }
    )
  }
  return globalMutate(CALENDAR_SWR_KEY)
}

const fetcher = (url: string) => fetch(url).then(res => {
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
}).then(data => {
  try {
    localStorage.setItem(CALENDAR_CACHE_KEY, JSON.stringify({ data, savedAt: Date.now() }))
  } catch {}
  return data
})

// Simple loading state - avoids rendering a duplicate calendar grid
function CalendarLoadingSkeleton() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-3 border-teal-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-500 font-medium">Loading calendar...</p>
      </div>
    </div>
  )
}

export function CalendarClient() {
  const [cachedData] = useState<CalendarData | undefined>(() => {
    if (typeof window === 'undefined') return undefined
    try {
      const raw = localStorage.getItem(CALENDAR_CACHE_KEY)
      if (!raw) return undefined
      const parsed = JSON.parse(raw) as { data?: CalendarData; savedAt?: number }
      if (!parsed.data || !parsed.savedAt) return undefined
      const isFreshEnough = Date.now() - parsed.savedAt < 10 * 60 * 1000
      return isFreshEnough ? parsed.data : undefined
    } catch {
      return undefined
    }
  })
  const { data, error, isLoading } = useSWR(
    CALENDAR_SWR_KEY,
    fetcher,
    {
      fallbackData: cachedData,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 30000,
      keepPreviousData: true,
    }
  )

  useEffect(() => {
    if (data) {
      try {
        localStorage.setItem(CALENDAR_CACHE_KEY, JSON.stringify({ data, savedAt: Date.now() }))
      } catch {}
    }
  }, [data])

  if (isLoading && !data) {
    return <CalendarLoadingSkeleton />
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Error Loading Calendar</h1>
          <p className="text-gray-600 mb-4">{error.message}</p>
          <button
            onClick={() => window.location.reload()}
            className="inline-block px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700"
          >
            Reload Page
          </button>
        </div>
      </div>
    )
  }

  return (
      <CalendarView 
        jobs={data?.jobs || []} 
        clients={data?.clients || []} 
        subcontractors={data?.subcontractors || []} 
      />
  )
}
