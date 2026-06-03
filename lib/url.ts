/**
 * Returns the application base URL (used to build links baked into emails, e.g.
 * the public "View invoice" link).
 *
 * Priority: NEXT_PUBLIC_APP_URL > NEXT_PUBLIC_BASE_URL > Vercel production domain
 * > Vercel deployment URL > localhost. CRITICAL: a localhost value is ignored
 * when actually running in production — otherwise a stray NEXT_PUBLIC_BASE_URL=
 * http://localhost:3000 (carried over from .env.local) makes every emailed
 * invoice link point at localhost and 404 / break for the client.
 */
export function getBaseUrl(): string {
  const isProd = process.env.NODE_ENV === 'production' || !!process.env.VERCEL
  const isLocalhost = (url: string) => /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(url)

  const explicit = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL
  if (explicit && !(isProd && isLocalhost(explicit))) {
    return explicit.replace(/\/+$/, '')
  }

  // Stable production domain on Vercel (does not change between deployments).
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  }
  // Per-deployment URL fallback.
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }
  return 'http://localhost:3000'
}
