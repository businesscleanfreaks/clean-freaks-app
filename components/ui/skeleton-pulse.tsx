"use client"

import { cn } from "@/lib/utils"

interface SkeletonPulseProps {
  className?: string
  rounded?: "sm" | "md" | "lg" | "xl" | "full"
}

export function SkeletonPulse({ className, rounded = "lg" }: SkeletonPulseProps) {
  const roundedClass = {
    sm: "rounded-sm",
    md: "rounded-md",
    lg: "rounded-lg",
    xl: "rounded-xl",
    full: "rounded-full",
  }[rounded]

  return (
    <div
      className={cn("skeleton-pulse relative overflow-hidden bg-[var(--cf-skeleton-base)]", roundedClass, className)}
    >
      <div
        className="absolute inset-0 skeleton-shimmer"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, var(--cf-skeleton-shine) 50%, transparent 100%)",
        }}
      />
    </div>
  )
}
