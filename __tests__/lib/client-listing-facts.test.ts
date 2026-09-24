import { describe, it, expect } from "vitest"
import {
  buildClientListFacts,
  ordinal,
  pauseCoversToday,
  scheduleMonthlyValue,
  scheduleWording,
  type FactInput,
  type FactSchedule,
} from "@/lib/client-listing-facts"
import { deriveClientStatus } from "@/lib/client-listing"

const TODAY = new Date(Date.UTC(2026, 8, 23, 12, 0, 0))
const day = (m: number, d: number) => new Date(Date.UTC(2026, m - 1, d, 12, 0, 0))

const schedule = (over: Partial<FactSchedule> = {}): FactSchedule => ({
  isActive: true,
  startDate: day(1, 5),
  endDate: null,
  pauseFrom: null,
  pauseTo: null,
  frequency: "WEEKLY",
  daysOfWeek: JSON.stringify([2, 5]),
  monthlyPattern: null,
  customDates: null,
  excludedDates: null,
  defaultClientRate: 167.5,
  clientPayType: "PER_CLEAN",
  cleanerName: "Maggie Quevedo",
  ...over,
})

const input = (over: Partial<FactInput> = {}): FactInput => ({
  isActive: true,
  notes: null,
  billingType: "PER_CLEAN",
  schedules: [],
  lastVisit: null,
  nextVisit: null,
  nearbyVisits: [],
  ...over,
})

const build = (over: Partial<FactInput> = {}) => buildClientListFacts(input(over), TODAY)

describe("the schedule in the page's words", () => {
  it("counts weekly visits", () => {
    expect(scheduleWording("WEEKLY", JSON.stringify([4]), null)).toBe("1x Weekly: Thu")
    expect(scheduleWording("WEEKLY", JSON.stringify([2, 5]), null)).toBe("2x Weekly: Tue, Fri")
  })

  it("collapses a run of weekdays", () => {
    expect(scheduleWording("WEEKLY", JSON.stringify([1, 2, 3, 4, 5]), null)).toBe("5x Weekly: Mon–Fri")
  })

  it("calls seven days a week daily", () => {
    expect(scheduleWording("WEEKLY", JSON.stringify([0, 1, 2, 3, 4, 5, 6]), null)).toBe("Daily: Mon–Sun")
  })

  it("does not collapse days that are not a run", () => {
    expect(scheduleWording("WEEKLY", JSON.stringify([1, 3, 5]), null)).toBe("3x Weekly: Mon, Wed, Fri")
  })

  it("names every-N-weeks cadences", () => {
    expect(scheduleWording("BI_WEEKLY", JSON.stringify([3]), null)).toBe("Bi-Weekly: Wed")
    expect(scheduleWording("EVERY_3_WEEKS", null, null)).toBe("Every 3 Weeks")
  })

  it("reads twice-monthly fixed dates", () => {
    expect(scheduleWording("2X_MONTHLY", null, '{"type":"FIXED_DATES","dates":[7,21]}')).toBe("2x Monthly: 7th & 21st")
  })

  it("reads twice-monthly nth weekdays, even without a type label", () => {
    expect(scheduleWording("2X_MONTHLY", null, '{"weekday":1,"weeks":[1,3]}')).toBe("2x Monthly: 1st & 3rd Mon")
  })

  it("says monthly with no pattern", () => {
    expect(scheduleWording("MONTHLY", null, null)).toBe("1x Monthly")
  })

  it("names the start day when no days were saved, as the calendar books them", () => {
    // Design Studio: every 4 weeks, no days ticked, started Thu Jul 9.
    const thu = new Date(Date.UTC(2026, 6, 9, 12))
    expect(scheduleWording("EVERY_4_WEEKS", "[]", null, thu)).toBe("Every 4 Weeks: Thu")
    expect(scheduleWording("WEEKLY", null, null, thu)).toBe("1x Weekly: Thu")
  })

  it("names the start date's day for a monthly schedule with no pattern", () => {
    expect(scheduleWording("MONTHLY", null, null, new Date(Date.UTC(2026, 2, 14, 12)))).toBe("1x Monthly: 14th")
  })

  it("keeps saved days over the start day", () => {
    expect(scheduleWording("BI_WEEKLY", JSON.stringify([3]), null, new Date(Date.UTC(2026, 6, 9, 12)))).toBe("Bi-Weekly: Wed")
  })
})

describe("ordinals", () => {
  it("handles the teens and the usual endings", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal))
      .toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "31st"])
  })
})

describe("what a schedule is worth a month", () => {
  it("is the rate itself for a flat-rate client", () => {
    expect(scheduleMonthlyValue(schedule({ clientPayType: "FLAT_RATE", defaultClientRate: 2050 }), "FLAT_RATE", TODAY)).toBe(2050)
  })

  it("is the visit rate times visits a month for a per-clean client", () => {
    // Twice a week is a little under nine visits in an average month.
    const value = scheduleMonthlyValue(schedule(), "PER_CLEAN", TODAY)
    expect(value).toBeGreaterThan(167.5 * 8)
    expect(value).toBeLessThan(167.5 * 9.5)
  })

  it("is nothing when no rate has been entered", () => {
    expect(scheduleMonthlyValue(schedule({ defaultClientRate: 0 }), "PER_CLEAN", TODAY)).toBe(0)
  })

  it("falls back to the client's billing type when the schedule has none", () => {
    expect(scheduleMonthlyValue(schedule({ clientPayType: null, defaultClientRate: 900 }), "FLAT_RATE", TODAY)).toBe(900)
  })
})

describe("whether a pause covers today", () => {
  it("does inside the window", () => {
    expect(pauseCoversToday(schedule({ pauseFrom: day(9, 1), pauseTo: day(10, 1) }), TODAY)).toBe(true)
  })

  it("does for an open-ended pause that has started", () => {
    expect(pauseCoversToday(schedule({ pauseFrom: day(9, 1) }), TODAY)).toBe(true)
  })

  it("does on the first and last day of the pause", () => {
    expect(pauseCoversToday(schedule({ pauseFrom: day(9, 23), pauseTo: day(9, 30) }), TODAY)).toBe(true)
    expect(pauseCoversToday(schedule({ pauseFrom: day(9, 1), pauseTo: day(9, 23) }), TODAY)).toBe(true)
  })

  it("does not for a pause that is over", () => {
    expect(pauseCoversToday(schedule({ pauseFrom: day(8, 1), pauseTo: day(8, 31) }), TODAY)).toBe(false)
  })

  it("does not for a pause that has not started", () => {
    expect(pauseCoversToday(schedule({ pauseFrom: day(10, 1), pauseTo: day(10, 15) }), TODAY)).toBe(false)
  })
})

describe("building a client's facts", () => {
  it("makes a client with a current schedule recurring", () => {
    const { facts } = build({ schedules: [schedule()] })
    expect(facts.hasRecurringSchedule).toBe(true)
    expect(deriveClientStatus(facts, TODAY)).toBe("recurring")
    expect(facts.scheduleText).toBe("2x Weekly: Tue, Fri")
  })

  it("counts a schedule that starts next week as current", () => {
    const { facts } = build({ schedules: [schedule({ startDate: day(9, 30) })] })
    expect(deriveClientStatus(facts, TODAY)).toBe("recurring")
  })

  it("ignores a schedule that has ended", () => {
    const { facts } = build({ schedules: [schedule({ endDate: day(8, 31) })] })
    expect(facts.hasRecurringSchedule).toBe(false)
  })

  it("ignores a deactivated schedule", () => {
    const { facts } = build({ schedules: [schedule({ isActive: false })] })
    expect(facts.hasRecurringSchedule).toBe(false)
  })

  it("sums every current schedule's month, but not an ended one", () => {
    const flat = schedule({ clientPayType: "FLAT_RATE", defaultClientRate: 1000 })
    const another = schedule({ clientPayType: "FLAT_RATE", defaultClientRate: 500 })
    const ended = schedule({ clientPayType: "FLAT_RATE", defaultClientRate: 9999, endDate: day(8, 31) })
    expect(build({ schedules: [flat, another, ended] }).facts.monthlyRecurring).toBe(1500)
  })

  it("describes a client with several schedules by the one worth the most", () => {
    // 1440 23rd Street: a $1,000 every-3-weeks location and a $2,050 weekly one.
    // The row said "Every 3 Weeks: Sun" beside $3,050, because display order
    // picked the smaller schedule.
    const small = schedule({ frequency: "EVERY_3_WEEKS", daysOfWeek: JSON.stringify([0]), clientPayType: "FLAT_RATE", defaultClientRate: 1000, startDate: day(6, 21) })
    // The display order puts the newest schedule first, which here is the small one.
    const large = schedule({ daysOfWeek: JSON.stringify([4]), clientPayType: "FLAT_RATE", defaultClientRate: 2050, startDate: day(4, 1) })
    for (const order of [[small, large], [large, small]]) {
      const { facts } = build({ schedules: order })
      expect(facts.scheduleText).toBe("1x Weekly: Thu")
      expect(facts.rate).toBe(2050)
      expect(facts.monthlyRecurring).toBe(3050)
    }
  })

  it("weighs a per-clean schedule by its month, not its visit price", () => {
    // $300 a clean once a month is worth less than $120 a clean twice a week.
    const monthly = schedule({ frequency: "MONTHLY", daysOfWeek: null, defaultClientRate: 300 })
    const twiceWeekly = schedule({ defaultClientRate: 120 })
    expect(build({ schedules: [monthly, twiceWeekly] }).facts.scheduleText).toBe("2x Weekly: Tue, Fri")
  })

  it("makes a paused client paused, describing the schedule it was on", () => {
    // A finite pause ends the interval and starts a resumed one later, so the
    // client has a current schedule during the pause. The pause must still win.
    const before = schedule({ endDate: day(8, 31), pauseFrom: day(9, 1), pauseTo: day(10, 15), clientPayType: "FLAT_RATE", defaultClientRate: 1200, daysOfWeek: JSON.stringify([4]) })
    const resumed = schedule({ startDate: day(10, 16), clientPayType: "FLAT_RATE", defaultClientRate: 1200, daysOfWeek: JSON.stringify([4]) })
    const { facts } = build({ schedules: [before, resumed] })
    expect(facts.pausedNow).toBe(true)
    expect(deriveClientStatus(facts, TODAY)).toBe("paused")
    expect(facts.pausedMonthly).toBe(1200)
    expect(facts.scheduleText).toBe("1x Weekly: Thu")
  })

  it("reads the trial marker the add-client flow writes", () => {
    const { facts } = build({ notes: "TRIAL CLIENT · first visit Oct 2", schedules: [schedule()] })
    expect(deriveClientStatus(facts, TODAY)).toBe("trial")
  })

  it("marks an ended client inactive", () => {
    const { facts } = build({ isActive: false, schedules: [schedule()] })
    expect(deriveClientStatus(facts, TODAY)).toBe("inactive")
  })

  it("makes a one-off client as-needed and prices the next visit", () => {
    const { facts } = build({
      nextVisit: day(10, 3),
      lastVisit: day(8, 14),
      nearbyVisits: [
        { date: day(8, 14), clientRate: 180, cleanerName: "Ana Lina" },
        { date: day(10, 3), clientRate: 250, cleanerName: "Ana Lina" },
      ],
    })
    expect(deriveClientStatus(facts, TODAY)).toBe("asneeded")
    expect(facts.visitRate).toBe(250)
  })

  it("totals the last 90 days only, not the future and not older work", () => {
    const { facts } = build({
      lastVisit: day(9, 10),
      nearbyVisits: [
        { date: day(5, 1), clientRate: 999, cleanerName: null },
        { date: day(7, 1), clientRate: 200, cleanerName: null },
        { date: day(9, 10), clientRate: 300, cleanerName: null },
        { date: day(10, 3), clientRate: 400, cleanerName: null },
      ],
    })
    expect(facts.trailing90).toBe(500)
  })

  it("takes the cleaner from the schedules when there are any", () => {
    expect(build({ schedules: [schedule()] }).cleaner).toBe("Maggie Quevedo")
  })

  it("says Mixed when schedules have different cleaners", () => {
    const two = [schedule(), schedule({ cleanerName: "Ana Lina" })]
    expect(build({ schedules: two }).cleaner).toBe("Mixed")
  })

  it("takes the cleaner from the visit for a client with no schedule", () => {
    const { cleaner } = build({
      nextVisit: day(10, 3),
      nearbyVisits: [{ date: day(10, 3), clientRate: 250, cleanerName: "Ana Lina" }],
    })
    expect(cleaner).toBe("Ana Lina")
  })

  it("says Unassigned when nothing names a cleaner", () => {
    expect(build().cleaner).toBe("Unassigned")
  })
})
