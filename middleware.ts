import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const SESSION_MAX_AGE = 60 * 60 * 24 * 7 // 7 days in seconds

// Get session secret (same logic as lib/auth.ts)
function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return ''
    }
    return 'dev-session-secret-do-not-use-in-production'
  }
  return secret
}

// Convert Uint8Array to hex string
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

// HMAC-SHA256 using Web Crypto API (Edge Runtime compatible)
async function hmacSha256(secret: string, data: string): Promise<string> {
  const encoder = new TextEncoder()
  const keyData = encoder.encode(secret)
  const messageData = encoder.encode(data)
  
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  
  const signature = await crypto.subtle.sign('HMAC', key, messageData)
  return bytesToHex(new Uint8Array(signature))
}

// Verify session token signature using Web Crypto API (Edge Runtime compatible)
async function verifySessionToken(token: string): Promise<boolean> {
  try {
    const secret = getSessionSecret()
    if (!secret) return false
    
    const parts = token.split('.')
    if (parts.length !== 2) return false
    
    const [encodedData, signature] = parts
    if (!encodedData || !signature) return false
    
    // Decode base64
    let data: string
    try {
      data = atob(encodedData)
    } catch {
      return false
    }
    
    // Verify HMAC signature using Web Crypto API
    const expectedSignature = await hmacSha256(secret, data)
    if (signature !== expectedSignature) return false
    
    // Check expiration
    const dataParts = data.split('::')
    if (dataParts.length < 2) return false
    
    const timestamp = parseInt(dataParts[1], 10)
    if (isNaN(timestamp)) return false
    
    const age = (Date.now() - timestamp) / 1000
    if (age > SESSION_MAX_AGE) return false
    
    return true
  } catch {
    return false
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow access to login page and API auth routes
  if (pathname === '/login' || pathname.startsWith('/api/auth/')) {
    return NextResponse.next()
  }

  // Allow public invoice viewing
  if (pathname.startsWith('/view-invoice/')) {
    return NextResponse.next()
  }

  // Check for auth session cookie
  const sessionCookie = request.cookies.get('auth-session')
  
  if (!sessionCookie?.value) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Verify the session signature cryptographically
  const isValid = await verifySessionToken(sessionCookie.value)
  if (!isValid) {
    // Invalid or expired session - clear the cookie and redirect
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    const response = NextResponse.redirect(loginUrl)
    response.cookies.delete('auth-session')
    return response
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons/.*|.*\\.(?:svg|png|jpg|jpeg|gif|webp|json)$).*)',
  ],
}
