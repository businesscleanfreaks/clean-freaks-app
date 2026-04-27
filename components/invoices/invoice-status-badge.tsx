import { cn } from "@/lib/utils"

interface InvoiceStatusBadgeProps {
  status: 'DRAFT' | 'SENT' | 'PAID'
  size?: 'sm' | 'md' | 'lg'
  showIcon?: boolean
  className?: string
}

export function InvoiceStatusBadge({
  status,
  size = 'md',
  showIcon = true,
  className
}: InvoiceStatusBadgeProps) {
  const baseClasses = "inline-flex items-center gap-1.5 font-semibold rounded-full transition-all duration-200 hover:scale-105 active:scale-95"

  const sizeClasses = {
    sm: "px-2 py-0.5 text-xs",
    md: "px-3 py-1 text-sm",
    lg: "px-4 py-1.5 text-base",
  }

  const variantClasses = {
    DRAFT: "bg-gradient-to-r from-gray-100 to-gray-200 text-gray-700 border-2 border-gray-300 shadow-sm hover:shadow-md",
    SENT: "bg-gradient-to-r from-amber-100 to-yellow-100 text-amber-800 border-2 border-amber-300 shadow-sm shadow-amber-200/50 hover:shadow-md hover:shadow-amber-200/70",
    PAID: "bg-gradient-to-r from-emerald-100 to-teal-100 text-emerald-800 border-2 border-emerald-300 shadow-sm shadow-emerald-200/50 hover:shadow-md hover:shadow-emerald-200/70",
  }

  const icons = {
    DRAFT: "📝",
    SENT: "📧",
    PAID: "✓",
  }

  const labels = {
    DRAFT: "Draft",
    SENT: "Sent",
    PAID: "Paid",
  }

  return (
    <span className={cn(
      baseClasses,
      sizeClasses[size],
      variantClasses[status],
      className
    )}>
      {showIcon && <span className="text-base">{icons[status]}</span>}
      <span>{labels[status]}</span>
    </span>
  )
}
