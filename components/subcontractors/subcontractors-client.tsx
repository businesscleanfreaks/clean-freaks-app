"use client"

import useSWR, { mutate as globalMutate } from "swr"
import { WorkersPageWrapper } from "./workers-page-wrapper"
import { SkeletonPulse } from "@/components/ui/skeleton-pulse"

const fetcher = (url: string) => fetch(url).then(res => {
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
})

function CleanersLoadingSkeleton() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-end gap-2">
          <SkeletonPulse className="h-9 w-24" rounded="lg" />
          <SkeletonPulse className="h-9 w-28" rounded="lg" />
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4">
        <div className="bg-white rounded-xl p-4 mb-4 border border-gray-200 border-l-4 border-l-teal-600">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <SkeletonPulse className="w-5 h-5" rounded="full" />
              <div>
                <SkeletonPulse className="h-3 w-16 mb-1.5" />
                <SkeletonPulse className="h-7 w-28" />
              </div>
            </div>
            <SkeletonPulse className="h-4 w-16" />
          </div>
        </div>

        <SkeletonPulse className="h-10 w-full mb-5" rounded="lg" />

        <SkeletonPulse className="h-4 w-24 mb-2" />
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-gray-100 last:border-b-0">
              <SkeletonPulse className="w-10 h-10" rounded="full" />
              <div className="flex-1">
                <SkeletonPulse className="h-4 w-32 mb-1" />
                <SkeletonPulse className="h-3 w-40" />
              </div>
              <SkeletonPulse className="h-5 w-20" />
              <SkeletonPulse className="h-8 w-14" rounded="lg" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function SubcontractorsClient() {
  const { data: subcontractors, error, isLoading, mutate } = useSWR(
    '/api/subcontractors/data',
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 30000,
    }
  )

  if (isLoading) {
    return <CleanersLoadingSkeleton />
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-2">Failed to load cleaners</p>
          <button
            onClick={() => window.location.reload()}
            className="text-teal-600 hover:underline"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  return <WorkersPageWrapper subcontractors={subcontractors || []} onDataChange={() => { mutate(); globalMutate('/api/dashboard-stats') }} />
}
