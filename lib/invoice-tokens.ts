import crypto from 'crypto'

function getInvoiceTokenSecret() {
  const secret = process.env.INVOICE_TOKEN_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('INVOICE_TOKEN_SECRET must be set in production')
    }
    return 'default-secret-change-in-development'
  }
  return secret
}

function safeEqualHex(actual: string, expected: string): boolean {
  try {
    const actualBuffer = Buffer.from(actual, 'hex')
    const expectedBuffer = Buffer.from(expected, 'hex')
    if (actualBuffer.length !== expectedBuffer.length) return false
    return crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  } catch {
    return false
  }
}

/**
 * Generate a secure token for public invoice viewing
 * Token format: base64url encoded `invoiceId:timestamp:hash`
 */
export function generateInvoiceToken(invoiceId: string): string {
  const timestamp = Date.now()
  const secret = getInvoiceTokenSecret()
  const hash = crypto
    .createHash('sha256')
    .update(`${invoiceId}:${timestamp}:${secret}`)
    .digest('hex')
    .substring(0, 16)
  
  const token = Buffer.from(`${invoiceId}:${timestamp}:${hash}`).toString('base64url')
  return token
}

/**
 * Decode and verify an invoice token
 * Returns invoice ID if valid, null if invalid or expired
 */
export function decodeInvoiceToken(token: string): string | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf-8')
    const parts = decoded.split(':')
    
    if (parts.length !== 3) {
      return null
    }
    
    const [invoiceId, timestamp, hash] = parts
    
    // Verify hash
    const secret = getInvoiceTokenSecret()
    const expectedHash = crypto
      .createHash('sha256')
      .update(`${invoiceId}:${timestamp}:${secret}`)
      .digest('hex')
      .substring(0, 16)
    
    if (!safeEqualHex(hash, expectedHash)) {
      return null
    }
    
    // Check expiration (1 year)
    const issuedAt = parseInt(timestamp, 10)
    if (!Number.isFinite(issuedAt)) {
      return null
    }
    const tokenAge = Date.now() - issuedAt
    const oneYear = 365 * 24 * 60 * 60 * 1000
    if (tokenAge < 0 || tokenAge > oneYear) {
      return null
    }
    
    return invoiceId
  } catch {
    return null
  }
}
