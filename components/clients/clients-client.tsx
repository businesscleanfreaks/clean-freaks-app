"use client"

import useSWR from "swr"
import { useSearchParams } from "next/navigation"
import { ClientsPageWrapper } from "./clients-page-wrapper"
import { ClientsSkeleton } from "@/components/skeletons/clients-skeleton"

const fetcher = (url: string) => fetch(url).then(res => {
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
})

export function ClientsClient() {
  const searchParams = useSearchParams()
  const prefillProspectId = searchParams.get("prefillProspectId")
  const { data: clients, error, isLoading } = useSWR(
    '/api/clients/data',
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 30000,
    }
  )

  const { data: prefillProspect } = useSWR(
    prefillProspectId ? `/api/prospects/${prefillProspectId}` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  )

  if (isLoading) {
    return <ClientsSkeleton />
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50/50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-2">Failed to load clients</p>
          <button 
            onClick={() => window.location.reload()}
            className="text-emerald-600 hover:underline"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  return <ClientsPageWrapper clients={clients || []} prefillProspect={prefillProspect || null} />
}
