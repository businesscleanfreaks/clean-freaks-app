"use client"

import { SkeletonPulse } from "@/components/ui/skeleton-pulse"

export function InvoicesSkeleton() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <SkeletonPulse className="h-8 w-32 mb-2" />
            <SkeletonPulse className="h-4 w-48" />
          </div>
          <div className="flex gap-2">
            <SkeletonPulse className="h-10 w-32" />
            <SkeletonPulse className="h-10 w-32" />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-4">
          {["Ready", "Drafts", "Waiting", "Paid"].map((tab) => (
            <SkeletonPulse key={tab} className="h-10 w-24" rounded="lg" />
          ))}
        </div>

        {/* Summary banner */}
        <div className="mb-3">
          <div
            className="bg-white rounded-lg px-4 py-3"
            style={{ border: "1px solid #EEEEEE", borderLeft: "4px solid #0d9488" }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <SkeletonPulse className="h-6 w-28" />
                <SkeletonPulse className="h-4 w-16" />
              </div>
              <SkeletonPulse className="h-9 w-24" rounded="lg" />
            </div>
          </div>
        </div>

        {/* Invoice cards */}
        <div
          className="bg-white rounded-lg overflow-hidden divide-y divide-gray-100"
          style={{ border: "1px solid #E5E5E5" }}
        >
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="px-4 py-4">
              {/* Client name + badge */}
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-3">
                  <SkeletonPulse className="w-5 h-5" rounded="sm" />
                  <div>
                    <SkeletonPulse className="h-5 w-40 mb-1" />
                    <SkeletonPulse className="h-3 w-28" />
                  </div>
                </div>
                <SkeletonPulse className="h-6 w-20" rounded="md" />
              </div>

              {/* Progress bar */}
              <div className="ml-8 mb-3">
                <div className="flex items-center justify-between mb-1">
                  <SkeletonPulse className="h-3 w-28" />
                  <SkeletonPulse className="h-3 w-8" />
                </div>
                <SkeletonPulse className="h-1.5 w-full" rounded="full" />
              </div>

              {/* Amount + button */}
              <div className="flex items-center justify-between ml-8">
                <div>
                  <SkeletonPulse className="h-6 w-24 mb-1" />
                  <SkeletonPulse className="h-3 w-20" />
                </div>
                <SkeletonPulse className="h-9 w-32" rounded="lg" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
