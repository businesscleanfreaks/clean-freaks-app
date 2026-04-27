import { SkeletonPulse } from "@/components/ui/skeleton-pulse"

export default function SubcontractorsLoading() {
  return (
    <div className="min-h-screen bg-gray-50 px-6 py-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex justify-between items-center">
          <div>
            <SkeletonPulse className="h-8 w-36 mb-2" />
            <SkeletonPulse className="h-4 w-64" />
          </div>
          <SkeletonPulse className="h-10 w-36" />
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-xl p-4 shadow-sm" style={{ border: "1px solid #EEEEEE" }}>
              <SkeletonPulse className="h-3 w-24 mb-3" />
              <SkeletonPulse className="h-7 w-20 mb-2" />
              <SkeletonPulse className="h-3 w-16" />
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          <SkeletonPulse className="h-10 w-28" rounded="lg" />
          <SkeletonPulse className="h-10 w-32" rounded="lg" />
        </div>

        {/* Cleaner Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="bg-white rounded-xl p-5 shadow-sm" style={{ border: "1px solid #EEEEEE" }}>
              <div className="flex items-center gap-4 mb-4">
                <SkeletonPulse className="h-12 w-12" rounded="full" />
                <div className="flex-1">
                  <SkeletonPulse className="h-5 w-32 mb-2" />
                  <SkeletonPulse className="h-3 w-24" />
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <SkeletonPulse className="h-3.5 w-20" />
                  <SkeletonPulse className="h-3.5 w-16" />
                </div>
                <div className="flex justify-between">
                  <SkeletonPulse className="h-3.5 w-24" />
                  <SkeletonPulse className="h-3.5 w-20" />
                </div>
                <SkeletonPulse className="h-9 w-full mt-2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
