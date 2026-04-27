"use client"

import useSWR from "swr"
import { ClientDetailView } from "./client-detail-view"
import { fetcher } from "@/lib/fetcher"
import { SkeletonPulse } from "@/components/ui/skeleton-pulse"

function ClientDetailSkeleton() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4">
        <SkeletonPulse className="h-8 w-48 mb-4" />
        <SkeletonPulse className="h-4 w-32 mb-6" />
        <div className="space-y-4">
          <SkeletonPulse className="h-24 w-full" rounded="xl" />
          <SkeletonPulse className="h-24 w-full" rounded="xl" />
          <SkeletonPulse className="h-24 w-full" rounded="xl" />
        </div>
      </div>
    </div>
  )
}

export function ClientDetailClient({ clientId }: { clientId: string }) {
  const { data: client, error, isLoading, mutate } = useSWR(
    `/api/clients/${clientId}`,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 30000,
    }
  )

  if (isLoading) {
    return <ClientDetailSkeleton />
  }

  if (error || !client) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-2">Failed to load client</p>
          <button
            onClick={() => mutate()}
            className="text-teal-600 hover:underline"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  return <ClientDetailView client={client} onDataChange={mutate} />
}
