/**
 * The client profile's History tab: one section per month, visits counted per
 * cleaner, and only the exceptions listed under it (Client Profile Main.dc.html).
 * Routine completed cleans are not events.
 *
 * Built from records that already exist · no change log is needed:
 *
 *   - visits are the recurring cleans on file. The app generates them ahead,
 *     so "what was scheduled" is the job itself, not a re-derivation.
 *     A cancelled clean is a skip; one done by someone other than the
 *     schedule's cleaner is a cover; a future one is upcoming.
 *   - one-time services are the cleans with no schedule.
 *   - schedule history is the schedule rows: a new row that continues an older
 *     one (lib/flat-rate-groups.ts) is a price, cleaner or pattern change, or a
 *     resumption after a pause; one that does not is a schedule starting.
 *   - notes are the client's notes.
 *
 * What it cannot say is WHO made a change or why a clean was skipped beyond
 * the clean's own note · that needs the change history not yet built.
 *
 * Pure: no Prisma, no clock.
 */

import { continuationKind, type FlatInterval } from "./flat-rate-groups"
import { money, scheduleHeadline } from "./client-profile"

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

export interface HistoryJob {
  id: string
  /** Calendar day, stored at noon UTC. */
  date: Date
  status: string
  locationName: string
  scheduleId: string | null
  /** Who did it: the cleaner, or the vendor for vendor work. */
  cleanerName: string | null
  clientRate: number
  notes: string | null
  /** Add-ons on the clean, used to name a one-time service. */
  addOnNames: string[]
}

export interface HistorySchedule extends FlatInterval {
  locationId: string
  locationName: string
  clientPayType: string | null
  cleanerName: string | null
}

export interface HistoryNote {
  /** The business day the note was written, at noon UTC. */
  day: Date
  text: string
}

export type HistoryTag = "CHANGE" | "RATE" | "EXTRA" | "NOTE"

export interface HistoryEvent {
  iso: string
  date: string
  tag: HistoryTag
  title: string
  sub: string
}

export type VisitStatus = "Done" | "Skipped" | "Covered" | "Upcoming"

export interface HistoryVisit {
  iso: string
  date: string
  location: string
  who: string
  status: VisitStatus
}

export interface HistoryMonth {
  key: string
  label: string
  byCleaner: Array<{ name: string; count: number }>
  skipped: number
  upcoming: number
  events: HistoryEvent[]
  visitGroups: Array<{ name: string; done: number; rows: HistoryVisit[] }>
}

export interface HistoryInput {
  jobs: HistoryJob[]
  schedules: HistorySchedule[]
  notes: HistoryNote[]
  /** When the client started, if recorded. */
  since: Date | null
  /** Today, as a noon-UTC calendar day. */
  today: Date
}

const isoOf = (d: Date) => d.toISOString().slice(0, 10)
const monthKeyOf = (d: Date) => isoOf(d).slice(0, 7)
const shortDate = (d: Date) => `${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
const visitDate = (d: Date) => `${SHORT_DAYS[d.getUTCDay()]} ${shortDate(d)}`
const noonOf = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12))
const trim = (text: string, max = 90) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text)

function event(day: Date, tag: HistoryTag, title: string, sub: string): HistoryEvent {
  return { iso: isoOf(day), date: shortDate(day), tag, title, sub: sub ? `· ${sub}` : "" }
}

function visitOf(job: HistoryJob, schedule: HistorySchedule | undefined, today: Date): HistoryVisit {
  const scheduled = schedule?.cleanerName ?? null
  const who = job.cleanerName ?? scheduled ?? "Unassigned"
  let status: VisitStatus = "Done"
  if (job.status === "CANCELLED") status = "Skipped"
  else if (noonOf(job.date) > today) status = "Upcoming"
  else if (job.cleanerName && scheduled && job.cleanerName !== scheduled) status = "Covered"
  return { iso: isoOf(job.date), date: visitDate(job.date), location: job.locationName, who, status }
}

function scheduleEvents(schedules: HistorySchedule[]): HistoryEvent[] {
  const events: HistoryEvent[] = []
  const byLocation = new Map<string, HistorySchedule[]>()
  for (const s of schedules) byLocation.set(s.locationId, [...(byLocation.get(s.locationId) ?? []), s])

  byLocation.forEach(list => {
    const ordered = [...list].sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
    const per = (s: HistorySchedule) => (s.clientPayType === "FLAT_RATE" ? " a month" : " a clean")
    ordered.forEach((s, index) => {
      const loc = s.locationName
      const earlier = ordered.slice(0, index).reverse()
      const pred = earlier.find(e => continuationKind(e, s) !== null)
      const kind = pred ? continuationKind(pred, s) : null

      if (!pred) {
        events.push(event(s.startDate, "CHANGE", "Schedule started", `${loc} · ${scheduleHeadline(s)}`))
      } else if (kind === "resumed") {
        events.push(event(s.startDate, "CHANGE", "Service resumed", loc))
      } else {
        if (pred.defaultClientRate !== s.defaultClientRate) {
          events.push(event(s.startDate, "RATE", "Rate changed", `${loc} · ${money(pred.defaultClientRate)} → ${money(s.defaultClientRate)}${per(s)}`))
        }
        if ((pred.cleanerName ?? "") !== (s.cleanerName ?? "")) {
          events.push(event(s.startDate, "CHANGE", "Cleaner changed", `${loc} · ${pred.cleanerName ?? "Unassigned"} → ${s.cleanerName ?? "Unassigned"}`))
        }
        const before = scheduleHeadline(pred)
        const after = scheduleHeadline(s)
        if (before !== after) events.push(event(s.startDate, "CHANGE", "Schedule changed", `${loc} · ${before} → ${after}`))
      }

      if (s.pauseFrom) {
        events.push(event(s.pauseFrom, "CHANGE", "Paused", `${loc}${s.pauseTo ? ` · until ${shortDate(s.pauseTo)}` : " · until further notice"}`))
      }
      const followed = ordered.slice(index + 1).some(later => continuationKind(s, later) !== null)
      if (s.endDate && !followed && !s.pauseFrom) {
        events.push(event(s.endDate, "CHANGE", "Schedule ended", loc))
      }
    })
  })
  return events
}

function oneTimeEvent(job: HistoryJob, today: Date): HistoryEvent {
  const service = job.addOnNames[0] ?? "One-time clean"
  const state = job.status === "CANCELLED" ? "cancelled" : noonOf(job.date) > today ? "scheduled" : "completed"
  const who = job.cleanerName ? ` · ${job.cleanerName}` : ""
  return event(job.date, "EXTRA", `${service} ${state}`, `${job.locationName}${who} · ${money(job.clientRate)}`)
}

/** Every month with anything in it, newest first. */
export function buildHistory(input: HistoryInput): HistoryMonth[] {
  const scheduleById = new Map(input.schedules.map(s => [s.id, s]))
  const visitsByMonth = new Map<string, HistoryVisit[]>()
  const eventsByMonth = new Map<string, HistoryEvent[]>()
  const addEvent = (e: HistoryEvent) => {
    const key = e.iso.slice(0, 7)
    eventsByMonth.set(key, [...(eventsByMonth.get(key) ?? []), e])
  }

  for (const job of input.jobs) {
    if (!job.scheduleId) {
      addEvent(oneTimeEvent(job, input.today))
      continue
    }
    const schedule = scheduleById.get(job.scheduleId)
    const visit = visitOf(job, schedule, input.today)
    const key = monthKeyOf(job.date)
    visitsByMonth.set(key, [...(visitsByMonth.get(key) ?? []), visit])
    if (visit.status === "Skipped") {
      addEvent(event(job.date, "CHANGE", "Visit skipped", [job.locationName, job.notes?.trim()].filter(Boolean).join(" · ")))
    } else if (visit.status === "Covered") {
      addEvent(event(job.date, "CHANGE", "Cleaner covered", `${job.locationName} · ${visit.who} covered for ${schedule?.cleanerName}`))
    }
  }

  scheduleEvents(input.schedules).forEach(addEvent)
  for (const note of input.notes) {
    const text = note.text.trim().replace(/\s+/g, " ")
    if (text) addEvent(event(note.day, "NOTE", "Note added", trim(text)))
  }

  // From the month the client started (or its first record) to the latest
  // month with anything in it.
  const keys = [...visitsByMonth.keys(), ...eventsByMonth.keys()]
  if (keys.length === 0) return []
  const first = [...keys, ...(input.since ? [monthKeyOf(input.since)] : [])].sort()[0]
  const last = [...keys, monthKeyOf(input.today)].sort().reverse()[0]

  const months: HistoryMonth[] = []
  let [y, m] = last.split("-").map(Number)
  const [fy, fm] = first.split("-").map(Number)
  while (y > fy || (y === fy && m >= fm)) {
    const key = `${y}-${String(m).padStart(2, "0")}`
    const visits = (visitsByMonth.get(key) ?? []).sort((a, b) => a.iso.localeCompare(b.iso))
    const events = (eventsByMonth.get(key) ?? []).sort((a, b) => b.iso.localeCompare(a.iso))
    if (visits.length > 0 || events.length > 0) {
      const counted = visits.filter(v => v.status === "Done" || v.status === "Covered")
      const count = new Map<string, number>()
      counted.forEach(v => count.set(v.who, (count.get(v.who) ?? 0) + 1))
      const groups = new Map<string, HistoryVisit[]>()
      visits.forEach(v => groups.set(v.who, [...(groups.get(v.who) ?? []), v]))
      months.push({
        key,
        label: `${LONG_MONTHS[m - 1]} ${y}`,
        byCleaner: [...count.entries()].map(([name, n]) => ({ name, count: n })).sort((a, b) => b.count - a.count),
        skipped: visits.filter(v => v.status === "Skipped").length,
        upcoming: visits.filter(v => v.status === "Upcoming").length,
        events,
        visitGroups: [...groups.entries()].map(([name, rows]) => ({
          name,
          done: rows.filter(v => v.status === "Done" || v.status === "Covered").length,
          rows,
        })),
      })
    }
    m -= 1
    if (m === 0) { m = 12; y -= 1 }
  }
  return months
}
