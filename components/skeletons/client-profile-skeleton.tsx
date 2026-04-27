"use client"

import { SkeletonPulse } from "@/components/ui/skeleton-pulse"

export function ClientProfileSkeleton() {
  return (
    <div className="min-h-screen bg-gray-50/50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4 pb-6">
        {/* Back link */}
        <SkeletonPulse className="h-4 w-20 mb-4" />

        {/* Header: Avatar + Name + Status */}
        <div className="flex items-start gap-4 mb-6">
          <SkeletonPulse className="w-20 h-20 shrink-0" rounded="full" />
          <div className="flex-1">
            <SkeletonPulse className="h-7 w-56 mb-2" />
            <div className="flex items-center gap-3">
              <SkeletonPulse className="h-5 w-16" rounded="full" />
              <SkeletonPulse className="h-4 w-28" />
            </div>
            <div className="flex items-center gap-2 mt-2">
              <SkeletonPulse className="h-4 w-32" />
              <SkeletonPulse className="h-4 w-24" />
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-3 mb-6">
          <SkeletonPulse className="h-11 w-36" rounded="lg" />
          <SkeletonPulse className="h-11 w-28" rounded="lg" />
          <SkeletonPulse className="h-11 w-36" rounded="lg" />
          <SkeletonPulse className="h-11 w-20" rounded="lg" />
        </div>

        {/* Next clean banner */}
        <div className="mb-6">
          <SkeletonPulse className="h-16 w-full" rounded="xl" />
        </div>

        {/* Two column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Contact Info */}
          <div className="lg:col-span-1">
            <div
              className="bg-white rounded-xl p-5 shadow-sm"
              style={{ border: "1px solid #EEEEEE" }}
            >
              <SkeletonPulse className="h-5 w-36 mb-5" />
              <div className="space-y-4">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i}>
                    <SkeletonPulse className="h-3 w-20 mb-1.5" />
                    <SkeletonPulse className="h-4 w-44" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right: Jobs list */}
          <div className="lg:col-span-2">
            <div
              className="bg-white rounded-xl p-5 shadow-sm"
              style={{ border: "1px solid #EEEEEE" }}
            >
              {/* Tab toggle */}
              <div className="flex items-center gap-2 mb-4">
                <SkeletonPulse className="h-8 w-28" rounded="full" />
                <SkeletonPulse className="h-8 w-24" rounded="full" />
              </div>

              {/* Job rows */}
              <div className="space-y-3">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-3 rounded-lg"
                    style={{ backgroundColor: "#FAFAFA" }}
                  >
                    <div className="flex items-center gap-3">
                      <SkeletonPulse className="h-10 w-10" rounded="lg" />
                      <div>
                        <SkeletonPulse className="h-4 w-36 mb-1" />
                        <SkeletonPulse className="h-3 w-24" />
                      </div>
                    </div>
                    <div className="text-right">
                      <SkeletonPulse className="h-4 w-16 mb-1" />
                      <SkeletonPulse className="h-5 w-14" rounded="full" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
