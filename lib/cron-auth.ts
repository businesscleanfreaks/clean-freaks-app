import { logger } from '@/lib/logger'

/**
 * Authorize a cron request.
 *
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when the CRON_SECRET
 * environment variable is set. We require it to match when set.
 *
 * Fail-closed in production: if CRON_SECRET is missing in a production deploy we
 * REFUSE the request, so cron endpoints (which regenerate schedules, send
 * invoice emails, and read the inbox) can never be triggered anonymously. In
 * non-production we warn and allow, so local/dev still works out of the box.
 */
export function authorizeCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      logger.error('[cron] CRON_SECRET not set in production — refusing the request. Set CRON_SECRET to enable cron endpoints.')
      return false
    }
    logger.warn('[cron] CRON_SECRET not set — allowing in non-production only. Set CRON_SECRET to lock these endpoints down.')
    return true
  }
  return request.headers.get('authorization') === `Bearer ${secret}`
}
