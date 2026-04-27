import crypto from 'crypto'

/**
 * Generate a secure token for public invoice viewing
 * Token format: base64url encoded `invoiceId:timestamp:hash`
 */
export function generateInvoiceToken(invoiceId: string): string {
  const timestamp = Date.now()
  const secret = process.env.INVOICE_TOKEN_SECRET || 'default-secret-change-in-production'
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
    const secret = process.env.INVOICE_TOKEN_SECRET || 'default-secret-change-in-production'
    const expectedHash = crypto
      .createHash('sha256')
      .update(`${invoiceId}:${timestamp}:${secret}`)
      .digest('hex')
      .substring(0, 16)
    
    if (hash !== expectedHash) {
      return null
    }
    
    // Check expiration (1 year)
    const tokenAge = Date.now() - parseInt(timestamp)
    const oneYear = 365 * 24 * 60 * 60 * 1000
    if (tokenAge > oneYear) {
      return null
    }
    
    return invoiceId
  } catch {
    return null
  }
}

