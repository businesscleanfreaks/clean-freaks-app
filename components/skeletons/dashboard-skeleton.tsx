"use client"

import { SkeletonPulse } from "@/components/ui/skeleton-pulse"

export function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-2 sm:pt-4 pb-4 sm:py-6 lg:pt-6">
        {/* Greeting */}
        <div className="mt-4 sm:mt-2 lg:mt-0 mb-6">
          <SkeletonPulse className="h-8 w-48 mb-2" />
          <SkeletonPulse className="h-4 w-72" />
        </div>

        {/* Needs Attention banner */}
        <div className="mb-6">
          <SkeletonPulse className="h-16 w-full" rounded="xl" />
        </div>

        {/* 4 Stat Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-white rounded-xl p-4 shadow-sm"
              style={{ border: "1px solid #EEEEEE" }}
            >
              <div className="flex items-center justify-between mb-3">
                <SkeletonPulse className="h-3 w-24" />
                <SkeletonPulse className="h-9 w-9" rounded="lg" />
              </div>
              <SkeletonPulse className="h-8 w-28 mb-2" />
              <SkeletonPulse className="h-3 w-16" />
            </div>
          ))}
        </div>

        {/* No Overdue banner */}
        <div className="mb-6">
          <SkeletonPulse className="h-14 w-full" rounded="xl" />
        </div>

        {/* Two Column: P&L + Checklist */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">
          {/* P&L Card */}
          <div className="lg:col-span-2">
            <div
              className="bg-white rounded-xl p-6 shadow-sm"
              style={{ border: "1px solid #EEEEEE" }}
            >
              <div className="flex items-center justify-between mb-6">
                <SkeletonPulse className="h-6 w-40" />
                <SkeletonPulse className="h-8 w-32" rounded="lg" />
              </div>
              <div className="space-y-3">
                {[0, 1, 2, 3, 4].map((i) => (
                  <SkeletonPulse key={i} className="h-14 w-full" rounded="xl" />
                ))}
              </div>
            </div>
          </div>

          {/* Checklist */}
          <div className="lg:col-span-1">
            <div
              className="bg-white rounded-xl p-6 shadow-sm"
              style={{ border: "1px solid #EEEEEE" }}
            >
              <SkeletonPulse className="h-6 w-32 mb-4" />
              <div className="space-y-3">
                {[0, 1, 2, 3].map((i) => (
                  <SkeletonPulse key={i} className="h-10 w-full" />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
