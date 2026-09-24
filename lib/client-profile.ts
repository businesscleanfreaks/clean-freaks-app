/**
 * What the client profile says (Client Profile Main.dc.html), worked out from
 * the records. The page formats; this decides.
 *
 * Pure: no Prisma, no clock (today is passed in, as a noon-UTC calendar day).
 */

import { normaliseMonthlyPattern } from "./monthly-pattern"
import { ordinal } from "./client-listing-facts"
import { flatBillingGroups, groupOverlapsPeriod, intervalForPeriod, type FlatInterval } from "./flat-rate-groups"
import type { ClientListFacts, ClientListStatus } from "./client-listing"

const FULL_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]
const WEEKLY_KINDS: Record<string, number> = { WEEKLY: 1, BI_WEEKLY: 2, EVERY_3_WEEKS: 3, EVERY_4_WEEKS: 4, EVERY_6_WEEKS: 6 }

const toDate = (value: Date | string) => (value instanceof Date ? value : new Date(value))

/** "Sep 24" from a date stored at noon UTC. */
export function shortDay(value: Date | string): string {
  const d = toDate(value)
  return `${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}

/** "Apr 2026". */
export function monthYear(value: Date | string): string {
  const d = toDate(value)
  return `${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

export function money(n: number): string {
  const whole = Math.abs(n - Math.round(n)) < 0.005
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`
}

function parseDays(raw: string | null | undefined): number[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? [...new Set(parsed.map(Number).filter(n => n >= 0 && n <= 6))] : []
  } catch {
    return []
  }
}

function fullDayList(days: number[]): string {
  const ordered = [...days].sort((a, b) => WEEK_ORDER.indexOf(a) - WEEK_ORDER.indexOf(b))
  const positions = ordered.map(d => WEEK_ORDER.indexOf(d))
  const isRun = ordered.length >= 3 && positions.every((p, i) => i === 0 || p === positions[i - 1] + 1)
  if (isRun) return `${FULL_DAYS[ordered[0]]}–${FULL_DAYS[ordered[ordered.length - 1]]}`
  if (ordered.length === 2) return `${FULL_DAYS[ordered[0]]} & ${FULL_DAYS[ordered[1]]}`
  return ordered.map(d => FULL_DAYS[d]).join(", ")
}

export interface HeadlineSchedule {
  frequency: string
  daysOfWeek: string | null
  monthlyPattern: string | null
  startDate: Date | string
}

/**
 * The schedule cell's headline, with whole day names: "Weekly · Thursday",
 * "Every 2 weeks · Monday", "5x weekly · Monday–Friday",
 * "Twice a month · 1st & 3rd Monday", "Monthly · 8th". A schedule saved
 * without days runs on its start day, so that is the day named.
 */
export function scheduleHeadline(s: HeadlineSchedule): string {
  const start = toDate(s.startDate)
  const every = WEEKLY_KINDS[s.frequency]
  if (every) {
    const saved = parseDays(s.daysOfWeek)
    const days = saved.length > 0 ? saved : [start.getUTCDay()]
    if (every === 1 && days.length === 7) return "Daily"
    const cadence = every === 1
      ? days.length === 1 ? "Weekly" : `${days.length}x weekly`
      : `Every ${every} weeks`
    return `${cadence} · ${fullDayList(days)}`
  }
  if (s.frequency === "DAILY") return "Daily"
  if (s.frequency === "CUSTOM") return "Custom dates"

  const pattern = normaliseMonthlyPattern(s.monthlyPattern)
  const which = pattern?.type === "FIXED_DATES"
    ? pattern.dates.map(ordinal).join(" & ")
    : pattern?.type === "NTH_WEEKDAY"
      ? `${pattern.weeks.map(w => (w === "last" ? "last" : ordinal(w))).join(" & ")} ${FULL_DAYS[pattern.weekday]}`
      : ordinal(start.getUTCDate())
  if (s.frequency === "MONTHLY") return `Monthly · ${which}`
  if (s.frequency === "2X_MONTHLY" || s.frequency === "BI_MONTHLY") return `Twice a month · ${which}`
  return s.frequency
}

/** "9 AM", "9:30 AM" from a stored "09:00" / "9:30 AM". */
export function clockLabel(raw: string | null | undefined): string {
  if (!raw) return ""
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?$/)
  if (!m) return raw.trim()
  let hour = Number(m[1])
  const minutes = m[2]
  let suffix = m[3]?.toUpperCase()
  if (!suffix) {
    suffix = hour >= 12 ? "PM" : "AM"
    hour = hour % 12 || 12
  }
  return minutes === "00" ? `${hour} ${suffix}` : `${hour}:${minutes} ${suffix}`
}

export interface ArrivalSchedule {
  timeType?: string | null
  startTime?: string | null
  startWindowBegin?: string | null
  startWindowEnd?: string | null
}

export interface Arrival {
  tag: "Set time" | "Window" | "Flexible"
  bg: string
  fg: string
  line: string
}

/** When the cleaner arrives, in the design's tag + line form. */
export function arrivalInfo(s: ArrivalSchedule): Arrival {
  if (s.timeType === "WINDOW" && (s.startWindowBegin || s.startWindowEnd)) {
    const from = clockLabel(s.startWindowBegin)
    const to = clockLabel(s.startWindowEnd || s.startWindowBegin)
    return { tag: "Window", bg: "#eef2fb", fg: "#3b5bdb", line: `Anytime ${from} – ${to}` }
  }
  if (s.startTime) {
    return { tag: "Set time", bg: "#fdf0df", fg: "#b45309", line: `Arrives at ${clockLabel(s.startTime)}` }
  }
  return { tag: "Flexible", bg: "#f3f0e9", fg: "#8a857a", line: "Anytime that day" }
}

/** "$2,050/mo" for a flat month, "$165/clean" per visit. */
export function rateText(rate: number | null | undefined, payType: string | null | undefined): string {
  if (!rate) return "–"
  return `${money(rate)}${payType === "FLAT_RATE" ? "/mo" : "/clean"}`
}

// ── Getting in ─────────────────────────────────────────────────────────────

export interface AccessSource {
  accessInfo?: string | null
  accessFields?: unknown
}

export interface Access {
  gettingIn: string
  notes: string
}

const LEGACY_ACCESS: Array<[string, string]> = [
  ["entry", "Entry"],
  ["alarm", "Alarm"],
  ["gate", "Gate"],
  ["lockbox", "Lockbox"],
  ["parking", "Parking"],
]

/**
 * A location's "Getting in" and "Notes". Getting in is the free-text access
 * field the calendar already shows; the older structured fields (entry, alarm,
 * gate, lockbox, parking) fold into it, labelled, so nothing typed there is
 * lost when the page stops showing them separately.
 */
export function readAccess(location: AccessSource): Access {
  const fields = (location.accessFields && typeof location.accessFields === "object"
    ? location.accessFields
    : {}) as Record<string, unknown>
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "")
  const legacy = LEGACY_ACCESS
    .map(([key, label]) => (text(fields[key]) ? `${label}: ${text(fields[key])}` : ""))
    .filter(Boolean)
  const gettingIn = [text(location.accessInfo), ...legacy].filter(Boolean).join("\n")
  return { gettingIn, notes: text(fields.notes) }
}

/** What saving the access editor writes: the legacy fields are now in the text. */
export function accessSavePayload(access: Access): { accessInfo: string | null; accessFields: { notes: string } } {
  return {
    accessInfo: access.gettingIn.trim() || null,
    accessFields: { notes: access.notes.trim() },
  }
}

/** "Copy for Cleaner": where, then how to get in, then the notes. */
export function copyForCleaner(name: string, address: string | null | undefined, access: Access): string {
  const head = address ? `${name} · ${address}` : name
  return [head, access.gettingIn, access.notes ? `\n${access.notes}` : ""].filter(Boolean).join("\n")
}

// ── Header ─────────────────────────────────────────────────────────────────

export interface MonthMoneyJob {
  date: Date | string
  status: string
  scheduleId: string | null
  clientRate: number | null
  subcontractorRate: number | null
}

export interface MonthMoneySchedule extends FlatInterval {
  clientPayType: string | null
  subcontractorPayType: string | null
  defaultSubcontractorRate: number
}

export interface MonthMoneyLocation {
  schedules: MonthMoneySchedule[]
  jobs: MonthMoneyJob[]
}

export interface MonthMoney {
  client: number
  cleaners: number
  margin: number
}

/**
 * This month's money, the way invoices and payables count it: a flat service
 * once for the month at the price in force (a mid-month change counts once, at
 * the new price), everything else per clean that was not cancelled.
 */
export function monthMoney(locations: MonthMoneyLocation[], today: Date): MonthMoney {
  const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1, 12))
  const last = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0, 12))
  const inMonth = (d: Date | string) => {
    const t = toDate(d)
    return t >= new Date(first.getTime() - 12 * 3600e3) && t <= new Date(last.getTime() + 12 * 3600e3)
  }

  let client = 0
  let cleaners = 0
  for (const loc of locations) {
    const flatClient = loc.schedules.filter(s => s.clientPayType === "FLAT_RATE")
    const flatCleaner = loc.schedules.filter(s => s.subcontractorPayType === "FLAT_RATE")
    const monthlyOnce = <T extends FlatInterval>(list: T[], rate: (s: T) => number) => {
      const groupOf = flatBillingGroups(list)
      const groups = new Map<string, T[]>()
      list.forEach(s => {
        const g = groupOf.get(s.id) ?? s.id
        groups.set(g, [...(groups.get(g) ?? []), s])
      })
      let sum = 0
      groups.forEach(group => {
        if (groupOverlapsPeriod(group, first, last)) sum += rate(intervalForPeriod(group, first, last))
      })
      return sum
    }
    client += monthlyOnce(flatClient, s => s.defaultClientRate || 0)
    cleaners += monthlyOnce(flatCleaner, s => s.defaultSubcontractorRate || 0)

    const flatClientIds = new Set(flatClient.map(s => s.id))
    const flatCleanerIds = new Set(flatCleaner.map(s => s.id))
    for (const job of loc.jobs) {
      if (job.status === "CANCELLED" || !inMonth(job.date)) continue
      if (!(job.scheduleId && flatClientIds.has(job.scheduleId))) client += job.clientRate || 0
      if (!(job.scheduleId && flatCleanerIds.has(job.scheduleId))) cleaners += job.subcontractorRate || 0
    }
  }
  return { client, cleaners, margin: client - cleaners }
}

export interface HeaderFigures {
  label: string
  value: string
  sub: string
  subColor: string
}

/** The number top-right of the header, per status (the mockup's revLabel/revValue/revSub). */
export function headerFigures(status: ClientListStatus, facts: ClientListFacts, month: MonthMoney): HeaderFigures {
  const muted = "#8a857a"
  switch (status) {
    case "recurring":
      return {
        label: "This month",
        value: money(month.client),
        sub: `${money(month.margin)} margin · cleaners ${money(month.cleaners)}`,
        subColor: month.margin >= 0 ? "#1f8a5b" : "#b4413a",
      }
    case "asneeded":
      return {
        label: "Last 90 days",
        value: money(facts.trailing90),
        sub: facts.visitRate ? `${money(facts.visitRate)}/clean` : "",
        subColor: muted,
      }
    case "trial":
      return { label: "Trial", value: facts.visitRate ? money(facts.visitRate) : "–", sub: "first clean", subColor: "#7c3aed" }
    case "paused":
      return { label: "Paused", value: "–", sub: facts.pausedMonthly ? `was ${money(facts.pausedMonthly)}/mo` : "", subColor: muted }
    default:
      return {
        label: "Revenue",
        value: "–",
        sub: facts.lastVisit ? `last ${shortDay(facts.lastVisit)}` : "no jobs yet",
        subColor: muted,
      }
  }
}

/** The grey line under the name: "Monthly · 2 locations · Client since Apr 2026". */
export function descriptorLine(
  status: ClientListStatus,
  facts: ClientListFacts,
  locationCount: number,
  since: Date | string | null,
): string {
  const locs = `${locationCount} location${locationCount === 1 ? "" : "s"}`
  const sinceText = since ? monthYear(since) : ""
  const cadence = facts.payType === "FLAT_RATE" ? "Monthly" : facts.scheduleText || "Recurring"
  const parts =
    status === "recurring" ? [cadence, locs, sinceText && `Client since ${sinceText}`]
    : status === "asneeded" ? [facts.visitRate ? `On-demand · ${money(facts.visitRate)}/clean` : "On-demand", locs, sinceText && `Client since ${sinceText}`]
    : status === "trial" ? ["Trial", locs, sinceText && `Since ${sinceText}`]
    : status === "paused" ? [`Paused · was ${facts.scheduleText || "recurring"}`, locs, sinceText && `Since ${sinceText}`]
    : facts.hasAnyVisits ? [`Inactive${facts.lastVisit ? ` · last ${shortDay(facts.lastVisit)}` : ""}`, locs, sinceText && `Since ${sinceText}`]
    : ["Not scheduled yet", locs, sinceText && `Added ${sinceText}`]
  return parts.filter(Boolean).join(" · ")
}

// ── Billing answer card ────────────────────────────────────────────────────

export interface ProfileInvoice {
  id: string
  invoiceNumber: string | null
  status: string
  totalAmount: number
  dateCreated: Date | string
  dateSent?: Date | string | null
  datePaid?: Date | string | null
  billingPeriodStart?: Date | string | null
}

export interface BillingStatus {
  value: string
  sub: string
  color: string
}

const OPEN = new Set(["SENT", "OVERDUE"])

/**
 * The Billing answer card. The mockup's statuses, but read from the invoices
 * themselves: "Paid up" only when nothing sent is still unpaid.
 */
export function billingStatus(
  status: ClientListStatus,
  invoices: ProfileInvoice[],
  billingDelivery: string | null | undefined,
): BillingStatus {
  const open = invoices.filter(i => OPEN.has(i.status))
  if (open.length > 0) {
    const owed = open.reduce((sum, i) => sum + (i.totalAmount || 0), 0)
    const overdue = open.some(i => i.status === "OVERDUE")
    const oldest = [...open].sort((a, b) => toDate(a.dateSent ?? a.dateCreated).getTime() - toDate(b.dateSent ?? b.dateCreated).getTime())[0]
    return {
      value: `${money(owed)} ${overdue ? "overdue" : "due"}`,
      sub: open.length === 1
        ? `${oldest.invoiceNumber ?? "Invoice"} sent ${shortDay(oldest.dateSent ?? oldest.dateCreated)}`
        : `${open.length} invoices open · oldest sent ${shortDay(oldest.dateSent ?? oldest.dateCreated)}`,
      color: overdue ? "#b4413a" : "#b45309",
    }
  }
  if (status === "trial") return { value: "Trial", sub: "Not yet billed", color: "#7c3aed" }
  if (status === "paused") return { value: "Paused", sub: "No active billing", color: "#b45309" }

  const paid = invoices
    .filter(i => i.status === "PAID")
    .sort((a, b) => toDate(b.datePaid ?? b.dateCreated).getTime() - toDate(a.datePaid ?? a.dateCreated).getTime())[0]
  const tracked = billingDelivery === "TRACK_ONLY" ? " · pays directly" : ""
  if (paid) return { value: "Paid up", sub: `Last paid ${shortDay(paid.datePaid ?? paid.dateCreated)}${tracked}`, color: "#1f9d57" }
  const drafts = invoices.filter(i => i.status === "DRAFT").length
  if (drafts > 0) return { value: "Nothing sent yet", sub: `${drafts} draft${drafts === 1 ? "" : "s"} waiting${tracked}`, color: "#7f8ea3" }
  if (status === "asneeded") return { value: "Per visit", sub: `Invoiced per clean${tracked}`, color: "#0f766e" }
  if (status === "inactive") return { value: invoices.length ? "Closed" : "No invoices", sub: invoices.length ? "Nothing open" : "No jobs yet", color: "#8a857a" }
  return { value: "No invoices yet", sub: `Nothing sent so far${tracked}`, color: "#7f8ea3" }
}
