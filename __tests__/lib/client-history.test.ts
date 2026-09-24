import { describe, it, expect } from "vitest"
import { buildHistory, type HistoryJob, type HistorySchedule } from "@/lib/client-history"

const day = (m: number, d: number) => new Date(Date.UTC(2026, m - 1, d, 12, 0, 0))
const TODAY = day(9, 24)

const schedule = (over: Partial<HistorySchedule> = {}): HistorySchedule => ({
  id: "s1",
  locationId: "L1",
  locationName: "1440 23rd St",
  startDate: day(8, 6),
  endDate: null,
  cadenceAnchor: day(8, 6),
  pauseFrom: null,
  pauseTo: null,
  frequency: "WEEKLY",
  daysOfWeek: "[4]",
  monthlyPattern: null,
  customDates: null,
  defaultClientRate: 450,
  clientPayType: "PER_CLEAN",
  cleanerName: "Ricardo",
  ...over,
})

const job = (d: Date, over: Partial<HistoryJob> = {}): HistoryJob => ({
  id: d.toISOString(),
  date: d,
  status: "COMPLETED",
  locationName: "1440 23rd St",
  scheduleId: "s1",
  cleanerName: "Ricardo",
  clientRate: 450,
  notes: null,
  addOnNames: [],
  ...over,
})

const history = (jobs: HistoryJob[], schedules: HistorySchedule[] = [schedule()], extra = {}) =>
  buildHistory({ jobs, schedules, notes: [], since: null, today: TODAY, ...extra })

describe("visits per cleaner", () => {
  it("counts done cleans per cleaner and lists nothing unusual for a routine month", () => {
    const [aug] = history([day(8, 6), day(8, 13), day(8, 20), day(8, 27)].map(d => job(d)))
      .filter(m => m.key === "2026-08")
    expect(aug.byCleaner).toEqual([{ name: "Ricardo", count: 4 }])
    // Only "Schedule started" · routine cleans are never events.
    expect(aug.events.map(e => e.title)).toEqual(["Schedule started"])
  })

  it("marks a cancelled clean skipped, with its note, and does not count it", () => {
    const [sep] = history([
      job(day(9, 3)),
      job(day(9, 10), { status: "CANCELLED", notes: "Client asked · fumigation" }),
    ]).filter(m => m.key === "2026-09")
    expect(sep.byCleaner).toEqual([{ name: "Ricardo", count: 1 }])
    expect(sep.skipped).toBe(1)
    expect(sep.events[0]).toMatchObject({ tag: "CHANGE", title: "Visit skipped", sub: "· 1440 23rd St · Client asked · fumigation", date: "Sep 10" })
  })

  it("credits a cover to the cleaner who did it", () => {
    const [sep] = history([job(day(9, 3)), job(day(9, 10), { cleanerName: "Marcia" })]).filter(m => m.key === "2026-09")
    expect(sep.byCleaner).toEqual([{ name: "Ricardo", count: 1 }, { name: "Marcia", count: 1 }])
    expect(sep.events[0]).toMatchObject({ title: "Cleaner covered", sub: "· 1440 23rd St · Marcia covered for Ricardo" })
    expect(sep.visitGroups.find(g => g.name === "Marcia")?.rows[0]).toMatchObject({ status: "Covered", date: "Thu Sep 10" })
  })

  it("counts future cleans as upcoming, not done", () => {
    const [oct] = history([job(day(10, 1), { status: "SCHEDULED" }), job(day(10, 8), { status: "SCHEDULED" })]).filter(m => m.key === "2026-10")
    expect(oct.upcoming).toBe(2)
    expect(oct.byCleaner).toEqual([])
  })
})

describe("schedule changes come from the schedule rows", () => {
  it("names a price change made going forward", () => {
    const before = schedule({ endDate: day(9, 14) })
    const after = schedule({ id: "s2", startDate: day(9, 15), defaultClientRate: 475 })
    const [sep] = history([], [before, after]).filter(m => m.key === "2026-09")
    expect(sep.events).toEqual([
      { iso: "2026-09-15", date: "Sep 15", tag: "RATE", title: "Rate changed", sub: "· 1440 23rd St · $450 → $475 a clean" },
    ])
  })

  it("names a cleaner change and a pattern change", () => {
    const before = schedule({ endDate: day(9, 14) })
    const after = schedule({ id: "s2", startDate: day(9, 15), cleanerName: "Marcia", daysOfWeek: "[1]" })
    const titles = history([], [before, after]).find(m => m.key === "2026-09")!.events.map(e => `${e.title} ${e.sub}`)
    expect(titles).toContain("Cleaner changed · 1440 23rd St · Ricardo → Marcia")
    expect(titles).toContain("Schedule changed · 1440 23rd St · Weekly · Thursday → Weekly · Monday")
  })

  it("shows a pause and the resumption, not an end and a new start", () => {
    const paused = schedule({ endDate: day(8, 31), pauseFrom: day(9, 1), pauseTo: day(9, 20) })
    const resumed = schedule({ id: "s2", startDate: day(9, 21) })
    const sep = history([], [paused, resumed]).find(m => m.key === "2026-09")!
    expect(sep.events.map(e => e.title)).toEqual(["Service resumed", "Paused"])
    expect(sep.events[1].sub).toBe("· 1440 23rd St · until Sep 20")
  })

  it("says when a schedule ended for good", () => {
    const ended = schedule({ endDate: day(9, 10) })
    expect(history([], [ended]).find(m => m.key === "2026-09")!.events.map(e => e.title)).toEqual(["Schedule ended"])
  })
})

describe("one-time services and notes", () => {
  it("lists a one-time service by its add-on, with where, who and what it cost", () => {
    const extra = job(day(9, 12), { scheduleId: null, addOnNames: ["Carpet shampoo"], clientRate: 250, cleanerName: "Ana" })
    const sep = history([extra]).find(m => m.key === "2026-09")!
    expect(sep.events[0]).toMatchObject({ tag: "EXTRA", title: "Carpet shampoo completed", sub: "· 1440 23rd St · Ana · $250" })
    expect(sep.visitGroups).toEqual([])
  })

  it("calls a future one-time clean scheduled", () => {
    const extra = job(day(10, 3), { scheduleId: null, status: "SCHEDULED" })
    expect(history([extra]).find(m => m.key === "2026-10")!.events[0].title).toBe("One-time clean scheduled")
  })

  it("lists notes, shortened", () => {
    const long = "x".repeat(200)
    const sep = history([], [], { notes: [{ day: day(9, 5), text: long }] }).find(m => m.key === "2026-09")!
    expect(sep.events[0].tag).toBe("NOTE")
    expect(sep.events[0].sub.length).toBeLessThan(100)
  })
})

describe("the months", () => {
  it("run newest first and skip months with nothing in them", () => {
    const months = history([job(day(6, 4)), job(day(9, 3))], [schedule({ startDate: day(6, 4), cadenceAnchor: day(6, 4) })])
    expect(months.map(m => m.key)).toEqual(["2026-09", "2026-06"])
  })

  it("is empty for a client with no records", () => {
    expect(history([], [])).toEqual([])
  })
})
