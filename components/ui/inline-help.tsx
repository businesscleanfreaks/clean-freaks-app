"use client"

import { HelpCircle } from "lucide-react"
import { SimpleTooltip } from "./simple-tooltip"

interface InlineHelpProps {
  /**
   * Tooltip content key or custom text
   */
  content: string
  /**
   * Optional custom className
   */
  className?: string
}

/**
 * InlineHelp - A small "?" icon that shows a tooltip when hovered
 * 
 * Use this next to form fields or labels that need explanation.
 * 
 * Usage:
 * ```tsx
 * <Label>
 *   Billing Type
 *   <InlineHelp content="help-billing-types" />
 * </Label>
 * ```
 */
export function InlineHelp({ content, className = "" }: InlineHelpProps) {
  return (
    <SimpleTooltip content={content} side="right">
      <HelpCircle className={`w-4 h-4 text-muted-foreground hover:text-teal-600 transition-colors inline-block ml-1.5 ${className}`} />
    </SimpleTooltip>
  )
}

