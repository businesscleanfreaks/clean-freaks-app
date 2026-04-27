/**
 * Production logging utility
 * Replaces console.log statements with proper logging
 */

const isDevelopment = process.env.NODE_ENV === 'development'

export const logger = {
  /**
   * Log debug information (only in development)
   */
  debug: (...args: unknown[]) => {
    if (isDevelopment) {
      console.log('[DEBUG]', ...args)
    }
  },

  /**
   * Log info messages
   */
  info: (...args: unknown[]) => {
    if (isDevelopment) {
      console.info('[INFO]', ...args)
    }
  },

  /**
   * Log warnings
   */
  warn: (...args: unknown[]) => {
    console.warn('[WARN]', ...args)
  },

  /**
   * Log errors (always logged)
   */
  error: (...args: unknown[]) => {
    console.error('[ERROR]', ...args)
  },
}

/** Safely extract a message string from an unknown caught value. */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'An unexpected error occurred'
}


