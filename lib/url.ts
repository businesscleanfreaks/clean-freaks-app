/**
 * Returns the application base URL.
 * Priority: NEXT_PUBLIC_APP_URL > NEXT_PUBLIC_BASE_URL > VERCEL_URL > localhost fallback
 */
export function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL
  if (process.env.NEXT_PUBLIC_BASE_URL) return process.env.NEXT_PUBLIC_BASE_URL
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}
