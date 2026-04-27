"use client"

import { SkeletonPulse } from "@/components/ui/skeleton-pulse"

export function ClientsSkeleton() {
  return (
    <div className="min-h-screen bg-gray-50/50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4 pb-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <SkeletonPulse className="h-8 w-32 mb-2" />
            <SkeletonPulse className="h-4 w-48" />
          </div>
          <SkeletonPulse className="h-10 w-32" />
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="bg-white rounded-xl p-4 shadow-sm"
              style={{ border: "1px solid #EEEEEE" }}
            >
              <SkeletonPulse className="h-4 w-20 mb-2" />
              <SkeletonPulse className="h-8 w-12" />
            </div>
          ))}
        </div>

        {/* Search + view toggle */}
        <div className="flex gap-4 mb-6">
          <SkeletonPulse className="flex-1 h-10 max-w-md" />
          <SkeletonPulse className="h-10 w-24" />
        </div>

        {/* Table header */}
        <div
          className="bg-white rounded-t-xl overflow-hidden"
          style={{ border: "1px solid #E0E0E0" }}
        >
          <div className="h-10 flex items-center gap-4 px-4" style={{ backgroundColor: "#0d9488" }}>
            <SkeletonPulse className="h-4 w-40 opacity-40" />
            <SkeletonPulse className="h-4 w-20 opacity-40" />
            <SkeletonPulse className="h-4 w-28 opacity-40" />
            <SkeletonPulse className="h-4 w-24 opacity-40" />
            <SkeletonPulse className="h-4 w-24 opacity-40" />
            <SkeletonPulse className="h-4 w-32 opacity-40" />
          </div>

          {/* Table rows */}
          <div className="divide-y" style={{ borderColor: "#E0E0E0" }}>
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div key={i} className="flex items-center gap-4 px-4 h-9">
                <SkeletonPulse className="h-3.5 w-40" />
                <SkeletonPulse className="h-3.5 w-16" />
                <SkeletonPulse className="h-3.5 w-24" />
                <SkeletonPulse className="h-3.5 w-20" />
                <SkeletonPulse className="h-3.5 w-20" />
                <SkeletonPulse className="h-3.5 w-28" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
