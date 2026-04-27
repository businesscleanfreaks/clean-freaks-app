import { cn } from "@/lib/utils"

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {}

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-lg bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 bg-[length:200%_100%]",
        className
      )}
      style={{
        animation: "shimmer 2s ease-in-out infinite",
      }}
      {...props}
    />
  )
}

// Add shimmer animation to globals.css
export function CardSkeleton() {
  return (
    <div className="bg-white rounded-xl border-2 border-gray-200 p-6 shadow-sm">
      <div className="space-y-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
        <div className="flex gap-2 mt-4">
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-10 w-24" />
        </div>
      </div>
    </div>
  )
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="bg-white rounded-xl border-2 border-gray-200 overflow-hidden shadow-sm">
      <div className="p-4 border-b border-gray-200 bg-gray-50">
        <Skeleton className="h-6 w-full max-w-md" />
      </div>
      <div className="divide-y divide-gray-200">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="p-4 flex gap-4">
            <Skeleton className="h-6 w-1/4" />
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-6 w-1/4" />
            <Skeleton className="h-6 w-1/6" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function StatCardSkeleton() {
  return (
    <div className="bg-white rounded-xl border-2 border-gray-200 p-6 shadow-sm">
      <Skeleton className="h-5 w-24 mb-3" />
      <Skeleton className="h-10 w-32 mb-2" />
      <Skeleton className="h-4 w-20" />
    </div>
  )
}
