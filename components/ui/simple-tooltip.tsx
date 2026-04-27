"use client"

import { ReactNode } from "react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useTooltipSetting } from "@/lib/hooks/use-tooltip-setting"
import { getTooltipContent } from "@/lib/tooltip-content"

interface SimpleTooltipProps {
  /**
   * Tooltip content key from tooltip-content.ts, or custom text
   */
  content: string
  /**
   * Child element to wrap with tooltip
   */
  children: ReactNode
  /**
   * Tooltip position
   */
  side?: "top" | "right" | "bottom" | "left"
  /**
   * Delay before showing tooltip (ms)
   */
  delayDuration?: number
  /**
   * Override tooltip setting - force show even if disabled
   */
  forceShow?: boolean
}

/**
 * SimpleTooltip - A wrapper component that shows tooltips in simple language
 * 
 * Automatically checks user's tooltip preference from settings.
 * If tooltips are disabled, this component renders children without tooltip.
 * 
 * Usage:
 * ```tsx
 * <SimpleTooltip content="job-edit">
 *   <Button>Edit</Button>
 * </SimpleTooltip>
 * 
 * // Or with custom text:
 * <SimpleTooltip content="Click to edit this job">
 *   <Button>Edit</Button>
 * </SimpleTooltip>
 * ```
 */
export function SimpleTooltip({
  content,
  children,
  side = "top",
  delayDuration = 300,
  forceShow = false,
}: SimpleTooltipProps) {
  const { enabled, mounted } = useTooltipSetting()

  // Don't render tooltip until mounted (avoid hydration mismatch)
  if (!mounted) {
    return <>{children}</>
  }

  // If tooltips are disabled and not forced, just render children
  if (!enabled && !forceShow) {
    return <>{children}</>
  }

  // Get tooltip text (either from dictionary or use content as-is)
  const tooltipText = getTooltipContent(content)

  return (
    <Tooltip 
      delayDuration={delayDuration}
      disableHoverableContent={true}
    >
      <TooltipTrigger asChild>
        {children}
      </TooltipTrigger>
      <TooltipContent 
        side={side} 
        className="max-w-sm text-sm z-[9999] pointer-events-none"
        sideOffset={12}
        align="center"
        avoidCollisions={true}
        collisionPadding={12}
      >
        <p className="leading-relaxed pointer-events-none">{tooltipText}</p>
      </TooltipContent>
    </Tooltip>
  )
}

