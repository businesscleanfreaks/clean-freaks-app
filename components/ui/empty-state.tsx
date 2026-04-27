import Link from "next/link"
import { Button } from "./button"
import { LucideIcon, HelpCircle } from "lucide-react"
import { SimpleTooltip } from "./simple-tooltip"

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  actionLabel?: string
  actionHref?: string
  secondaryActionLabel?: string
  secondaryActionHref?: string
  helpTooltip?: string
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionHref,
  secondaryActionLabel,
  secondaryActionHref,
  helpTooltip,
}: EmptyStateProps) {
  return (
    <div className="bg-gradient-to-br from-white via-gray-50/50 to-white rounded-2xl border border-gray-200/80 p-12 text-center shadow-sm hover:shadow-lg transition-all duration-400 relative overflow-hidden group">
      {/* Subtle background pattern */}
      <div className="absolute inset-0 opacity-[0.02] bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"></div>
      
      <div className="max-w-md mx-auto relative z-10">
        {/* Icon - Enhanced with premium animations */}
        <div className="mb-6 flex justify-center animate-in" style={{ animationDelay: '0.1s' }}>
          <div className="relative">
            {/* Outer glow ring - animated */}
            <div className="absolute inset-0 bg-gradient-to-r from-teal-400 via-teal-500 to-teal-600 rounded-full blur-2xl opacity-20 animate-pulse"></div>
            {/* Secondary glow */}
            <div className="absolute inset-0 bg-gradient-to-r from-blue-400 to-teal-400 rounded-full blur-xl opacity-10 animate-float"></div>
            {/* Icon container - premium styling */}
            <div className="relative bg-gradient-to-br from-teal-50 via-white to-teal-50/50 p-6 rounded-2xl border-2 border-teal-200/60 shadow-lg group-hover:shadow-xl group-hover:scale-105 transition-all duration-400">
              <Icon className="w-14 h-14 text-teal-600 group-hover:text-teal-700 transition-colors duration-300" strokeWidth={1.5} />
            </div>
          </div>
        </div>

        {/* Title - Refined typography */}
        <div className="flex items-center justify-center gap-2 mb-3 animate-in" style={{ animationDelay: '0.2s' }}>
          <h3 className="text-2xl font-bold text-gray-900 tracking-tight letter-spacing-tight">
            {title}
          </h3>
          {helpTooltip && (
            <SimpleTooltip content={helpTooltip}>
              <HelpCircle className="w-5 h-5 text-gray-400 hover:text-teal-600 transition-colors cursor-help hover:scale-110" />
            </SimpleTooltip>
          )}
        </div>

        {/* Description - Enhanced readability */}
        <p className="text-gray-600 mb-8 leading-relaxed text-base animate-in" style={{ animationDelay: '0.3s' }}>
          {description}
        </p>

        {/* Actions - Enhanced with animations */}
        {(actionLabel || secondaryActionLabel) && (
          <div className="flex gap-3 justify-center animate-in" style={{ animationDelay: '0.4s' }}>
            {actionLabel && actionHref && (
              <Link href={actionHref}>
                <Button size="lg" variant="premium" className="shadow-lg hover:shadow-xl">
                  {actionLabel}
                </Button>
              </Link>
            )}
            {secondaryActionLabel && secondaryActionHref && (
              <Link href={secondaryActionHref}>
                <Button size="lg" variant="outline" className="hover:shadow-md">
                  {secondaryActionLabel}
                </Button>
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
