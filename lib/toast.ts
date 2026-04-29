/**
 * Premium toast utility functions for easy error/success messaging
 * Replaces alert() calls throughout the app
 */

import { toast } from "@/hooks/use-toast"
import React from "react"

/**
 * Show a success toast message with icon
 */
export function showSuccess(message: string, title?: string) {
  toast({
    variant: "success",
    title: title || "✓ Success",
    description: message,
    duration: 4000,
  })
}

/**
 * Show an error toast message with icon
 */
export function showError(message: string, title?: string) {
  toast({
    variant: "destructive",
    title: title || "✕ Error",
    description: message,
    duration: 5000,
  })
}

/**
 * Show an info toast message with icon
 */
export function showInfo(message: string, title?: string) {
  toast({
    title: title || "ⓘ Info",
    description: message,
    duration: 4000,
  })
}

/**
 * Show a warning toast message with amber icon
 */
export function showWarning(message: string, title?: string) {
  toast({
    title: title || "⚠ Warning",
    description: message,
    duration: 7000,
  })
}

/**
 * Show a success toast with an Undo action button
 */
export function showUndoToast(message: string, onUndo: () => void) {
  const { ToastAction } = require("@/components/ui/toast")
  toast({
    variant: "success",
    title: "✓ " + message,
    duration: 6000,
    action: React.createElement(ToastAction, {
      altText: "Undo",
      onClick: onUndo,
      className: "bg-white text-gray-900 hover:bg-gray-100 border-0 font-semibold",
    }, "Undo") as React.ReactElement,
  })
}

/**
 * Convenience function to show error from API response with actionable guidance
 */
export async function showApiError(response: Response, defaultMessage: string = "An error occurred") {
  try {
    const errorData = await response.json()
    const errorMessage = errorData.error || defaultMessage
    
    // Enhance error messages with actionable guidance
    let enhancedMessage = errorMessage
    let actionHint = ""
    
    if (errorMessage.includes("not found")) {
      actionHint = "Please refresh the page and try again."
    } else if (errorMessage.includes("validation") || errorMessage.includes("required")) {
      actionHint = "Please check all required fields are filled correctly."
    } else if (errorMessage.includes("permission") || errorMessage.includes("unauthorized")) {
      actionHint = "You may need to refresh the page or check your connection."
    } else if (errorMessage.includes("network") || errorMessage.includes("fetch")) {
      actionHint = "Check your internet connection and try again."
    } else if (errorMessage.includes("database") || errorMessage.includes("constraint")) {
      actionHint = "This may be a temporary issue. Please try again in a moment."
    }
    
    if (actionHint) {
      enhancedMessage = `${errorMessage}\n\n💡 ${actionHint}`
    }
    
    showError(enhancedMessage)
  } catch {
    showError(`${defaultMessage}\n\n💡 Please try refreshing the page or contact support if the issue persists.`)
  }
}

