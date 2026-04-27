import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyPassword, createSessionToken } from '@/lib/auth'
import { handleApiError, createErrorResponse } from '@/lib/api-error-handler'
import { logger } from '@/lib/logger'
import { loginSchema, formatZodErrors } from '@/lib/validations'

const SESSION_MAX_AGE = 60 * 60 * 24 * 7 // 7 days

// Simple in-memory rate limiting (resets on server restart)
// For a small app with 2 users, this is sufficient
const loginAttempts = new Map<string, { count: number; lastAttempt: number }>()
const MAX_ATTEMPTS = 5
const LOCKOUT_DURATION = 15 * 60 * 1000 // 15 minutes

function getRateLimitKey(request: Request): string {
  // Use IP address from headers (Vercel provides this)
  const forwarded = request.headers.get('x-forwarded-for')
  const ip = forwarded?.split(',')[0]?.trim() || 'unknown'
  return ip
}

function isRateLimited(key: string): { limited: boolean; remainingTime?: number } {
  const attempts = loginAttempts.get(key)
  if (!attempts) return { limited: false }
  
  const timeSinceLastAttempt = Date.now() - attempts.lastAttempt
  
  // Reset if lockout period has passed
  if (timeSinceLastAttempt > LOCKOUT_DURATION) {
    loginAttempts.delete(key)
    return { limited: false }
  }
  
  // Check if locked out
  if (attempts.count >= MAX_ATTEMPTS) {
    const remainingTime = Math.ceil((LOCKOUT_DURATION - timeSinceLastAttempt) / 1000 / 60)
    return { limited: true, remainingTime }
  }
  
  return { limited: false }
}

function recordFailedAttempt(key: string): void {
  const attempts = loginAttempts.get(key)
  if (attempts) {
    attempts.count += 1
    attempts.lastAttempt = Date.now()
  } else {
    loginAttempts.set(key, { count: 1, lastAttempt: Date.now() })
  }
}

function clearAttempts(key: string): void {
  loginAttempts.delete(key)
}

export async function POST(request: Request) {
  const rateLimitKey = getRateLimitKey(request)
  
  // Check rate limit before processing
  const rateLimit = isRateLimited(rateLimitKey)
  if (rateLimit.limited) {
    logger.warn(`[Login] Rate limited: ${rateLimitKey}`)
    return createErrorResponse(
      `Too many login attempts. Please try again in ${rateLimit.remainingTime} minutes.`,
      429,
      'RATE_LIMIT'
    )
  }
  
  try {
    const body = await request.json()
    
    // Validate input using Zod schema
    const validationResult = loginSchema.safeParse(body)
    if (!validationResult.success) {
      const errors = formatZodErrors(validationResult.error)
      return createErrorResponse(errors[0] || 'Invalid login data', 400, 'VALIDATION_ERROR')
    }
    
    const { email, password } = validationResult.data

    // Validate Prisma is available
    if (!prisma) {
      logger.error('[Login] Prisma client is undefined')
      return createErrorResponse('Database connection error. Please restart the server.', 500, 'SERVER_ERROR')
    }

    // Check if user model exists
    if (typeof prisma.user === 'undefined') {
      logger.error('[Login] Prisma user model not available - Prisma client may need regeneration')
      return createErrorResponse('Database error. Please contact support.', 500, 'SERVER_ERROR')
    }

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    })

    if (!user) {
      recordFailedAttempt(rateLimitKey)
      return createErrorResponse('Invalid email or password', 401, 'AUTH_ERROR')
    }

    // Verify password
    const isValid = await verifyPassword(password, user.passwordHash)
    if (!isValid) {
      recordFailedAttempt(rateLimitKey)
      return createErrorResponse('Invalid email or password', 401, 'AUTH_ERROR')
    }

    // Login successful - clear any previous failed attempts
    clearAttempts(rateLimitKey)

    // Create session token
    const sessionToken = createSessionToken(user.id)

    // Create response with explicit Set-Cookie header
    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    })

    // Set cookie explicitly in the response
    const isProduction = process.env.NODE_ENV === 'production'
    const isVercel = !!process.env.VERCEL
    
    response.cookies.set('auth-session', sessionToken, {
      httpOnly: true,
      secure: isProduction || isVercel,
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE,
      path: '/',
    })

    return response
  } catch (error) {
    return handleApiError(error, 'Failed to login')
  }
}

