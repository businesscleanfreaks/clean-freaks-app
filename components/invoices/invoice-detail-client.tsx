"use client"

import useSWR from "swr"
import { InvoiceDetail } from "./invoice-detail"
import { fetcher } from "@/lib/fetcher"
import { SkeletonPulse } from "@/components/ui/skeleton-pulse"

function InvoiceDetailSkeleton() {
  return (
    <div className="p-8">
      <SkeletonPulse className="h-8 w-48 mb-4" />
      <SkeletonPulse className="h-4 w-32 mb-6" />
      <div className="space-y-4">
        <SkeletonPulse className="h-32 w-full" rounded="xl" />
        <SkeletonPulse className="h-48 w-full" rounded="xl" />
      </div>
    </div>
  )
}

export function InvoiceDetailClient({ invoiceId }: { invoiceId: string }) {
  const { data: invoice, error, isLoading, mutate } = useSWR(
    `/api/invoices/${invoiceId}`,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 30000,
    }
  )

  if (isLoading) {
    return <InvoiceDetailSkeleton />
  }

  if (error || !invoice) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-2">Failed to load invoice</p>
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

  return (
    <div className="p-8">
      <InvoiceDetail invoice={invoice} onDataChange={mutate} />
    </div>
  )
}
