/**
 * What the Clients page says about each client.
 *
 * The design is explicit that a client's status is DERIVED from what is true
 * about its schedules and visits, never stored on the client. Only three things
 * are human decisions, and they are the only explicit inputs:
 *
 *   - ended   · the client is no longer active
 *   - trial   · the client came in on a trial clean
 *   - paused  · a schedule's own pause window covers today
 *
 * Everything else follows from the work. A current schedule makes a client
 * Recurring. Occasional visits with something recent or upcoming make it
 * As-needed. Nothing recent and nothing booked, or nothing ever, is Inactive.
 *
 * Two deliberate departures from the mockup's sample data, which ran on a
 * spreadsheet export and could take shortcuts real records cannot:
 *
 *   - Recurring means HAS A CURRENT SCHEDULE, not "monthly revenue above zero".
 *     A schedule starting next week, or one whose rate hasn't been entered, is
 *     still a recurring client · keying on the money would have shown them as
 *     As-needed.
 *   - A clean happening today counts as upcoming ("next"), not past, because it
 *     is still work to be done.
 *
 * Pure: no Prisma, no clock (today is passed in).
 */

import { formatDateOnly } from "./date-only"

export type ClientListStatus = "recurring" | "paused" | "trial" | "asneeded" | "inactive"

/** The facts the API works out for one client. */
export interface ClientListFacts {
  /** False once the client has been ended (the app's "Cancel client"). */
  isActive: boolean
  isTrial: boolean
  /** A schedule's pause window covers today. */
  pausedNow: boolean
  /** Has a schedule that is current or starting soon. */
  hasRecurringSchedule: boolean
  /** Committed monthly revenue from current schedules, add-ons excluded. */
  monthlyRecurring: number
  /** What the paused schedule was worth monthly, for "was $X/mo". */
  pausedMonthly: number
  /** FLAT_RATE or PER_CLEAN, from the schedule the page describes. */
  payType: string | null
  /** That schedule's rate: the month for flat rate, the visit for per clean. */
  rate: number | null
  /** Wording for that schedule, e.g. "2x Weekly: Tue, Fri". */
  scheduleText: string
  /** Most recent visit before today that was not cancelled. */
  lastVisit: Date | string | null
  /** Next visit from today onward that is not cancelled. */
  nextVisit: Date | string | null
  /** What the next visit (or else the last one) is charged. */
  visitRate: number | null
  /** Revenue from visits in the 90 days before today. */
  trailing90: number
  hasAnyVisits: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Days from a service day to today, both read as days. */
function daysSince(value: Date | string, today: Date): number {
  const d = value instanceof Date ? value : new Date(value)
  const a = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  const b = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  return Math.round((b - a) / DAY_MS)
}

/** How long a client can go without a visit before it stops being As-needed. */
export const AS_NEEDED_WINDOW_DAYS = 90

export function deriveClientStatus(facts: ClientListFacts, today: Date): ClientListStatus {
  if (!facts.isActive) return "inactive"
  if (facts.isTrial) return "trial"
  if (facts.pausedNow) return "paused"
  if (facts.hasRecurringSchedule) return "recurring"
  if (!facts.hasAnyVisits) return "inactive"
  if (facts.nextVisit) return "asneeded"
  if (facts.lastVisit && daysSince(facts.lastVisit, today) <= AS_NEEDED_WINDOW_DAYS) return "asneeded"
  return "inactive"
}

/** The tab a status belongs to. Paused clients stay with Recurring. */
export type ClientListTab = "all" | "recurring" | "asneeded" | "trial" | "inactive"

export function statusInTab(status: ClientListStatus, tab: ClientListTab): boolean {
  if (tab === "all") return true
  if (tab === "recurring") return status === "recurring" || status === "paused"
  return status === tab
}

export const STATUS_META: Record<ClientListStatus, { label: string; bg: string; color: string }> = {
  recurring: { label: "Recurring", bg: "#e7f6ee", color: "#1f8a5b" },
  paused: { label: "Paused", bg: "#fdeede", color: "#b45309" },
  trial: { label: "Trial", bg: "#efe9fb", color: "#7c3aed" },
  asneeded: { label: "As-needed", bg: "#e6f3f1", color: "#0f766e" },
  inactive: { label: "Inactive", bg: "#f0eee8", color: "#8a857a" },
}

/** "$1,449". Whole dollars, which is how the page talks about a month. */
export function wholeMoney(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US")
}

/** "$167.50" or "$165" · a visit price keeps its cents when it has them. */
export function visitMoney(n: number): string {
  const hasCents = Math.round(n * 100) % 100 !== 0
  return "$" + n.toLocaleString("en-US", {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  })
}

/** "$23.5k" above a thousand, "$840" below. */
export function shortMoney(n: number): string {
  const rounded = Math.round(n)
  if (rounded >= 1000) return "$" + (rounded / 1000).toFixed(1).replace(/\.0$/, "") + "k"
  return "$" + rounded
}

const shortDay = (value: Date | string | null) => formatDateOnly(value, "MMM d") ?? "–"

export interface ClientListDisplay {
  status: ClientListStatus
  statusLabel: string
  /** The schedule column, worded for the status. */
  scheduleLine: string
  /** The big number in the revenue column. */
  money: string
  /** Paused and inactive clients show their money greyed out. */
  moneyMuted: boolean
  /** The small line under it. */
  rateSub: string
}

export function clientListDisplay(facts: ClientListFacts, today: Date): ClientListDisplay {
  const status = deriveClientStatus(facts, today)
  const base = { status, statusLabel: STATUS_META[status].label }
  const isFlat = facts.payType === "FLAT_RATE"

  switch (status) {
    case "recurring":
      return {
        ...base,
        scheduleLine: facts.scheduleText || "Recurring",
        money: wholeMoney(facts.monthlyRecurring),
        moneyMuted: false,
        rateSub: isFlat
          ? "flat monthly"
          : facts.rate != null ? `${visitMoney(facts.rate)}/clean` : "per clean",
      }
    case "paused":
      return {
        ...base,
        scheduleLine: facts.scheduleText ? `Paused · was ${facts.scheduleText}` : "Paused",
        money: "–",
        moneyMuted: true,
        rateSub: facts.pausedMonthly > 0 ? `was ${wholeMoney(facts.pausedMonthly)}/mo` : "paused",
      }
    case "trial": {
      const price = facts.visitRate ?? facts.rate
      return {
        ...base,
        scheduleLine: facts.scheduleText ? `Trial · ${facts.scheduleText}` : "Trial",
        money: price != null ? visitMoney(price) : "–",
        moneyMuted: false,
        rateSub: "trial clean",
      }
    }
    case "asneeded":
      return {
        ...base,
        scheduleLine: facts.nextVisit
          ? `As-needed · next ${shortDay(facts.nextVisit)}`
          : `As-needed · last ${shortDay(facts.lastVisit)}`,
        money: facts.visitRate != null ? visitMoney(facts.visitRate) : "–",
        moneyMuted: false,
        rateSub: facts.trailing90 > 0 ? `last 90d ${shortMoney(facts.trailing90)}` : "per visit",
      }
    case "inactive":
      return {
        ...base,
        scheduleLine: facts.lastVisit ? `Inactive · last ${shortDay(facts.lastVisit)}` : "Inactive · not scheduled yet",
        money: "–",
        moneyMuted: true,
        rateSub: "inactive",
      }
  }
}

/** "17 clients · $23.5k/mo billed to clients" · client billing, not payout. */
export function cleanerGroupMeta(clientCount: number, monthlyTotal: number): string {
  return `${clientCount} ${clientCount === 1 ? "client" : "clients"} · ${shortMoney(monthlyTotal)}/mo billed to clients`
}

/** Groups sorted by what they bill, largest first, with Unassigned last. */
export function sortCleanerGroups<T extends { name: string; total: number }>(groups: T[]): T[] {
  return [...groups].sort(
    (a, b) =>
      Number(a.name === "Unassigned") - Number(b.name === "Unassigned") ||
      b.total - a.total,
  )
}

/** Two letters for an avatar, from the first two words. */
export function listInitials(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]/g, "").trim().split(/\s+/).filter(Boolean)
  const two = ((words[0] ?? "").charAt(0) + (words[1] ?? "").charAt(0)).toUpperCase()
  return two || (name.charAt(0) || "?").toUpperCase()
}
