import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface LoadingSpinnerProps {
  size?: "sm" | "md" | "lg"
  className?: string
  text?: string
  variant?: "default" | "branded"
}

export function LoadingSpinner({ size = "md", className, text, variant = "default" }: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: "w-4 h-4",
    md: "w-6 h-6",
    lg: "w-8 h-8",
  }

  if (variant === "branded") {
    return (
      <div className={cn("flex items-center justify-center gap-2", className)}>
        <div className="relative inline-flex items-center justify-center">
          {/* Outer glow - animated */}
          <div className="absolute inset-0 bg-gradient-to-r from-teal-400 to-teal-600 rounded-full blur-lg opacity-30 animate-pulse"></div>
          {/* Spinner */}
          <Loader2 className={cn(
            "animate-spin text-teal-600 relative z-10",
            sizeClasses[size]
          )} strokeWidth={2.5} />
        </div>
        {text && <span className="text-sm text-gray-600 font-medium">{text}</span>}
      </div>
    )
  }

  return (
    <div className={cn("flex items-center justify-center gap-2", className)}>
      <Loader2 className={cn("animate-spin text-teal-600 transition-colors", sizeClasses[size])} strokeWidth={2} />
      {text && <span className="text-sm text-gray-600 font-medium">{text}</span>}
    </div>
  )
}

interface PageLoadingProps {
  message?: string
}

export function PageLoading({ message = "Loading..." }: PageLoadingProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 flex items-center justify-center">
      <div className="text-center animate-in">
        <LoadingSpinner size="lg" variant="branded" />
        <p className="mt-4 text-gray-600 font-medium">{message}</p>
      </div>
    </div>
  )
}

interface InlineLoadingProps {
  message?: string
  className?: string
}

export function InlineLoading({ message, className }: InlineLoadingProps) {
  return (
    <div className={cn("flex items-center justify-center py-8", className)}>
      <LoadingSpinner size="md" text={message} />
    </div>
  )
}


