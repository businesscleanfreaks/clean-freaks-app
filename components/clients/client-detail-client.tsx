"use client"

import useSWR from "swr"
import { ProfileView } from "./profile/profile-view"
import { fetcher } from "@/lib/fetcher"
import { SkeletonPulse } from "@/components/ui/skeleton-pulse"

function ClientDetailSkeleton() {
  // The profile's own shape: header, tabs, the answer cards and a rail.
  return (
    <div style={{ width: "100%", maxWidth: 1560, margin: "0 auto", padding: "18px 38px 48px" }}>
      <SkeletonPulse className="h-4 w-20 mb-4" />
      <div className="flex items-center gap-3.5">
        <SkeletonPulse className="h-[58px] w-[58px]" rounded="xl" />
        <div>
          <SkeletonPulse className="h-7 w-72 mb-2.5" />
          <SkeletonPulse className="h-4 w-56" />
        </div>
      </div>
      <SkeletonPulse className="h-5 w-56 mt-6" />
      <div className="grid gap-4 mt-6" style={{ gridTemplateColumns: "minmax(0,1fr) 320px" }}>
        <div className="space-y-3.5">
          <SkeletonPulse className="h-36 w-full" rounded="xl" />
          <SkeletonPulse className="h-64 w-full" rounded="xl" />
        </div>
        <div className="space-y-3.5">
          <SkeletonPulse className="h-60 w-full" rounded="xl" />
          <SkeletonPulse className="h-32 w-full" rounded="xl" />
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

  return <ProfileView client={client} onDataChange={mutate} />
}
