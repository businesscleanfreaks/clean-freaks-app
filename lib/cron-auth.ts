import { logger } from '@/lib/logger'

/**
 * Authorize a cron request.
 *
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when the CRON_SECRET
 * environment variable is set. We require it to match when set. When it is not
 * set we allow the call but warn, so the endpoint still works out of the box —
 * set CRON_SECRET in the environment to lock these endpoints down.
 */
export function authorizeCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    logger.warn('[cron] CRON_SECRET not set — cron endpoint is unprotected. Set CRON_SECRET to lock it down.')
    return true
  }
  return request.headers.get('authorization') === `Bearer ${secret}`
}
