"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { AlertTriangle, RefreshCcw, Home } from "lucide-react"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Application error:', error)
  }, [error])

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
        {/* Error Icon */}
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-8 h-8 text-red-600" />
        </div>

        {/* Error Message */}
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Something went wrong
        </h1>

        <p className="text-gray-600 mb-6">
          We encountered an unexpected error. Don&apos;t worry, your data is safe.
        </p>

        {/* Show error details in development mode only */}
        {process.env.NODE_ENV === 'development' && error.message && (
          <div className="mb-6 p-4 bg-gray-50 rounded-lg text-left">
            <p className="text-xs font-semibold text-gray-700 mb-1">Error details:</p>
            <p className="text-sm font-mono text-gray-700 break-words">
              {error.message}
            </p>
            {error.digest && (
              <p className="text-xs text-gray-500 mt-2">
                Error ID: {error.digest}
              </p>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3 justify-center">
          <Button
            onClick={reset}
            className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white"
          >
            <RefreshCcw className="w-4 h-4" />
            Try again
          </Button>

          <Button
            onClick={() => window.location.href = '/'}
            variant="outline"
            className="flex items-center gap-2"
          >
            <Home className="w-4 h-4" />
            Go home
          </Button>
        </div>

        <p className="text-xs text-gray-500 mt-6">
          If this problem persists, please contact support.
        </p>
      </div>
    </div>
  )
}
