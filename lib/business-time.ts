/**
 * The timezone the business runs in, and how to render a real moment in it.
 *
 * Two different things get called "a date" in this app and they need opposite
 * treatment:
 *
 *   - A SERVICE DAY · "the clean on the 10th". It has no time and no timezone.
 *     It must read as the 10th everywhere. lib/date-only.ts handles those, and
 *     the bug this addresses was date-only values being parsed as instants with
 *     `new Date("2026-06-10")` (UTC midnight) and then read back with local
 *     getters, which is the 9th anywhere behind UTC.
 *
 *   - A REAL MOMENT · "you marked this billed externally at 5pm". It is an
 *     instant, and which day it falls on depends on where you are standing.
 *     Those were rendered with `toLocaleDateString` and no timezone, so they
 *     came out in whatever zone the code happened to run in: the viewer's
 *     browser on the client, and UTC on a Vercel server. The same record could
 *     show two different days.
 *
 * The business is in Pacific time; that constant already existed inside
 * app/api/schedules/route.ts and is promoted here so everything agrees. Render
 * real moments in it explicitly, so the answer does not depend on where the
 * code runs or where the reader happens to be.
 */

export const BUSINESS_TIME_ZONE = "America/Los_Angeles"

/**
 * A real moment, as a day in the business's timezone.
 *
 * Use for timestamps the app recorded itself (when something was sent, billed,
 * confirmed). For a service day use lib/date-only.ts instead · running a
 * service day through here would reintroduce exactly the shift being fixed.
 */
export function formatBusinessDate(
  value: Date | string | null | undefined,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString("en-US", { ...options, timeZone: BUSINESS_TIME_ZONE })
}

/** "yyyy-MM-dd" for a real moment, in the business's timezone. */
export function businessDayKey(value: Date | string): string | null {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  // en-CA gives ISO-ordered parts, which is what makes this sortable.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}
