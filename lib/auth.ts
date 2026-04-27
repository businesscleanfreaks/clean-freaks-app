import bcrypt from 'bcryptjs'
import { createHmac, timingSafeEqual } from 'crypto'
import { prisma } from './db'
import { cookies } from 'next/headers'
import { logger } from './logger'

const SESSION_COOKIE_NAME = 'auth-session'
const SESSION_MAX_AGE = 60 * 60 * 24 * 7 // 7 days

// Secret for signing session tokens - MUST be set in production
function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SESSION_SECRET environment variable is required in production')
    }
    // Fallback for development only
    return 'dev-session-secret-do-not-use-in-production'
  }
  return secret
}

// Create HMAC signature for session data
function signSessionData(data: string): string {
  const hmac = createHmac('sha256', getSessionSecret())
  hmac.update(data)
  return hmac.digest('hex')
}

// Verify HMAC signature using timing-safe comparison
function verifySignature(data: string, signature: string): boolean {
  const expectedSignature = signSessionData(data)
  try {
    // Use timing-safe comparison to prevent timing attacks
    return timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    )
  } catch {
    return false
  }
}

// Parse and verify a signed session token
// Returns the data portion if valid, null if invalid
export function parseSignedSession(token: string): { userId: string; timestamp: number } | null {
  try {
    // Token format: base64(data).signature
    const [encodedData, signature] = token.split('.')
    if (!encodedData || !signature) {
      return null
    }
    
    // Verify signature first (before trusting any data)
    const data = Buffer.from(encodedData, 'base64').toString('utf8')
    if (!verifySignature(data, signature)) {
      logger.warn('[Auth] Invalid session signature detected')
      return null
    }
    
    // Parse the verified data
    const [userId, timestampStr] = data.split('::')
    const timestamp = parseInt(timestampStr, 10)
    
    if (!userId || isNaN(timestamp)) {
      return null
    }
    
    // Check if session has expired (7 days)
    const now = Date.now()
    const age = (now - timestamp) / 1000
    if (age > SESSION_MAX_AGE) {
      logger.debug('[Auth] Session expired')
      return null
    }
    
    return { userId, timestamp }
  } catch {
    return null
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

// Create a signed session token (without setting cookie)
export function createSessionToken(userId: string): string {
  const timestamp = Date.now()
  const data = `${userId}::${timestamp}`
  
  // Sign the session data with HMAC
  const signature = signSessionData(data)
  const encodedData = Buffer.from(data).toString('base64')
  return `${encodedData}.${signature}`
}

// Create session and set cookie (for use in Server Actions)
export async function createSession(userId: string): Promise<string> {
  const sessionToken = createSessionToken(userId)
  
  // Store session in cookie
  const cookieStore = await cookies()
  const isProduction = process.env.NODE_ENV === 'production'
  const isVercel = !!process.env.VERCEL
  
  cookieStore.set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: isProduction || isVercel,
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE,
    path: '/',
  })
  
  return sessionToken
}

export async function getSession(): Promise<string | null> {
  const cookieStore = await cookies()
  const session = cookieStore.get(SESSION_COOKIE_NAME)
  return session?.value || null
}

export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE_NAME)
}

export async function getCurrentUser() {
  try {
    const sessionToken = await getSession()
    if (!sessionToken) {
      logger.debug('[Auth] No session token found')
      return null
    }
    
    // Parse and verify the signed session token
    const session = parseSignedSession(sessionToken)
    if (!session) {
      logger.debug('[Auth] Invalid or expired session token')
      return null
    }
    
    const { userId } = session
    
    // Ensure Prisma client is properly imported
    if (!prisma) {
      logger.error('[Auth] Prisma client is undefined')
      return null
    }
    
    // Check if user model exists
    if (typeof prisma.user === 'undefined') {
      logger.error('[Auth] Prisma user model not available')
      return null
    }
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
      },
    })
    
    if (!user) {
      logger.debug('[Auth] User not found')
      return null
    }
    
    return user
  } catch (error) {
    const errorMessage = process.env.NODE_ENV === 'development'
      ? (error instanceof Error ? error.message : String(error))
      : 'Authentication error'
    logger.error('[Auth] Error getting current user:', errorMessage)
    return null
  }
}

export async function requireAuth() {
  const user = await getCurrentUser()
  if (!user) {
    throw Object.assign(new Error('Unauthorized'), { statusCode: 401 })
  }
  return user
}

