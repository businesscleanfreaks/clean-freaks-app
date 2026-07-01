import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyPassword, createSessionToken } from '@/lib/auth'
import { handleApiError, createErrorResponse } from '@/lib/api-error-handler'
import { logger } from '@/lib/logger'
import { loginSchema, formatZodErrors } from '@/lib/validations'
import {
  checkLoginRateLimit,
  clearLoginAttempts,
  getLoginClientIp,
  recordFailedLoginAttempt,
} from '@/lib/login-rate-limit'

const SESSION_MAX_AGE = 60 * 60 * 24 * 7 // 7 days

export async function POST(request: Request) {
  try {
    const body = await request.json()
    
    // Validate input using Zod schema
    const validationResult = loginSchema.safeParse(body)
    if (!validationResult.success) {
      const errors = formatZodErrors(validationResult.error)
      return createErrorResponse(errors[0] || 'Invalid login data', 400, 'VALIDATION_ERROR')
    }
    
    const { email, password } = validationResult.data
    const rateLimit = checkLoginRateLimit(request, email)
    if (rateLimit.limited) {
      logger.warn(`[Login] Rate limited: ${getLoginClientIp(request)}`)
      return createErrorResponse(
        `Too many login attempts. Please try again in ${rateLimit.remainingTime} minutes.`,
        429,
        'RATE_LIMIT'
      )
    }

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
      recordFailedLoginAttempt(request, email)
      return createErrorResponse('Invalid email or password', 401, 'AUTH_ERROR')
    }

    // Verify password
    const isValid = await verifyPassword(password, user.passwordHash)
    if (!isValid) {
      recordFailedLoginAttempt(request, email)
      return createErrorResponse('Invalid email or password', 401, 'AUTH_ERROR')
    }

    // Login successful - clear any previous failed attempts
    clearLoginAttempts(request, email)

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
