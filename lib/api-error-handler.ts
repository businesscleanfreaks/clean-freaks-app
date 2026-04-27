/**
 * Standardized API error handling utility
 * Ensures consistent error responses across all API routes
 */

import { NextResponse } from 'next/server'

export interface ApiErrorResponse {
  error: string
  code?: string
  details?: unknown
}

/**
 * Standard error response format
 * All API routes should use this for consistent error handling
 */
export function createErrorResponse(
  message: string,
  status: number = 500,
  code?: string,
  details?: unknown
): NextResponse<ApiErrorResponse> {
  return NextResponse.json(
    {
      error: message,
      ...(code ? { code } : {}),
      ...(details ? { details } : {}),
    },
    { status }
  )
}

/**
 * Handle common error types and return standardized responses
 */
export function handleApiError(error: unknown, defaultMessage: string = 'An error occurred'): NextResponse<ApiErrorResponse> {
  // Log error for debugging (server-side only)
  // In production, be careful not to log sensitive information
  if (error instanceof Error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('API Error:', error.message, error.stack)
    } else {
      // In production, log error type but not full stack/details
      console.error('API Error:', error.message)
    }
  } else {
    console.error('API Error:', error)
  }

  // Handle specific error types
  if (error instanceof Error) {
    // Validation errors
    if (error.message.includes('validation') || error.message.includes('required')) {
      return createErrorResponse(
        error.message || 'Validation error. Please check all required fields.',
        400,
        'VALIDATION_ERROR'
      )
    }

    // Not found errors
    if (error.message.includes('not found') || error.message.includes('Record to update not found')) {
      return createErrorResponse(
        error.message || 'Resource not found',
        404,
        'NOT_FOUND'
      )
    }

    // Foreign key constraint errors
    if (error.message.includes('Foreign key constraint')) {
      return createErrorResponse(
        'A referenced record no longer exists. Please refresh the page and try again.',
        400,
        'CONSTRAINT_ERROR'
      )
    }

    // Unique constraint errors
    if (error.message.includes('Unique constraint') || error.message.includes('already exists')) {
      return createErrorResponse(
        error.message || 'This record already exists.',
        409,
        'DUPLICATE_ERROR'
      )
    }

    // Authentication errors
    if (error.message === 'Unauthorized' || error.message.includes('Unauthorized')) {
      return createErrorResponse(
        'You must be logged in to perform this action. Please log in and try again.',
        401,
        'AUTH_ERROR'
      )
    }

    // Database connection errors
    if (error.message.includes('database') || error.message.includes('connection')) {
      return createErrorResponse(
        'Database connection error. Please try again in a moment.',
        503,
        'DATABASE_ERROR'
      )
    }

    // Return error message if available
    return createErrorResponse(
      error.message || defaultMessage,
      500,
      'INTERNAL_ERROR'
    )
  }

  // Unknown error type
  return createErrorResponse(
    defaultMessage,
    500,
    'UNKNOWN_ERROR'
  )
}

/**
 * Parse error from API response
 * Client-side utility to extract error message from standardized response
 */
export async function parseApiError(response: Response): Promise<string> {
  try {
    const data: ApiErrorResponse = await response.json()
    return data.error || 'An error occurred'
  } catch {
    return response.statusText || 'An error occurred'
  }
}

