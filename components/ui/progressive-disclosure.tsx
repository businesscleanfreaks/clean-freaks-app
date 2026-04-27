"use client"

import { useState, ReactNode } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { Button } from "./button"
import { cn } from "@/lib/utils"

interface ProgressiveDisclosureProps {
  /**
   * Label for the toggle button
   */
  label: string
  /**
   * Content to show when expanded
   */
  children: ReactNode
  /**
   * Whether to show by default
   */
  defaultOpen?: boolean
  /**
   * Optional className for the container
   */
  className?: string
  /**
   * Optional description text below the label
   */
  description?: string
}

/**
 * ProgressiveDisclosure - A collapsible section for advanced/optional features
 * 
 * Use this to hide complex options until the user needs them.
 * 
 * Usage:
 * ```tsx
 * <ProgressiveDisclosure label="Advanced Options" description="Optional settings">
 *   <YourAdvancedContent />
 * </ProgressiveDisclosure>
 * ```
 */
export function ProgressiveDisclosure({
  label,
  children,
  defaultOpen = false,
  className = "",
  description,
}: ProgressiveDisclosureProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div className={cn("border border-gray-200 rounded-lg overflow-hidden", className)}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-900">{label}</span>
            <span className="text-xs text-gray-500 bg-gray-200 px-2 py-0.5 rounded">
              Optional
            </span>
          </div>
          {description && (
            <p className="text-sm text-gray-600 mt-1">{description}</p>
          )}
        </div>
        {isOpen ? (
          <ChevronUp className="w-5 h-5 text-gray-500 shrink-0 ml-4" />
        ) : (
          <ChevronDown className="w-5 h-5 text-gray-500 shrink-0 ml-4" />
        )}
      </button>
      
      {isOpen && (
        <div className="p-4 bg-white border-t border-gray-200">
          {children}
        </div>
      )}
    </div>
  )
}

