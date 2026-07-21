"use client"

import useSWR, { mutate as globalMutate } from "swr"
import { CalendarView } from "./calendar-view"
import type { JobWithFullRelations, ClientWithLocations, Subcontractor } from "@/types"

interface CalendarData {
  jobs: JobWithFullRelations[]
  clients: ClientWithLocations[]
  subcontractors: Subcontractor[]
}

export const CALENDAR_SWR_KEY = '/api/calendar/data'
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

// `no-store` so SWR revalidations after a mutation (move, add-on, rate edit)
// always hit the network. The route sends Cache-Control: max-age=10, which
// otherwise served a stale browser-cached response — the add-on bubble only
// appeared after a hard refresh.
const fetcher = (url: string) => fetch(url, { cache: 'no-store' }).then(res => {
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
})

// Simple loading state - avoids rendering a duplicate calendar grid
function CalendarLoadingSkeleton() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center bg-[var(--cf-canvas)]">
      <div className="flex flex-col items-center gap-3">
        <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-[var(--cf-green-rule)] border-t-[var(--cf-green)]" />
        <p className="text-xs font-bold text-[var(--cf-ink-muted)]">Loading calendar...</p>
      </div>
    </div>
  )
}

export function CalendarClient() {
  const { data, error, isLoading } = useSWR(
    CALENDAR_SWR_KEY,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 30000,
      keepPreviousData: true,
    }
  )

  if (isLoading && !data) {
    return <CalendarLoadingSkeleton />
  }

  if (error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-[var(--cf-canvas)] p-4">
        <div className="w-full max-w-md rounded-lg border border-[var(--cf-rule)] bg-white p-7 text-center shadow-[var(--cf-panel-shadow)]">
          <h1 className="mb-2 text-xl font-extrabold text-[var(--cf-ink)]">Calendar could not load</h1>
          <p className="mb-5 text-sm text-[var(--cf-ink-secondary)]">{error.message}</p>
          <button
            onClick={() => window.location.reload()}
            className="inline-block rounded-lg bg-[var(--cf-green)] px-4 py-2 text-sm font-bold text-white hover:bg-[var(--cf-green-hover)]"
          >
            Try again
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
