import { describe, it, expect } from "vitest"
import { finalizeTargets, utcMonthRange, type FinalizeLine } from "@/lib/invoice-finalize"

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12, 0, 0))

const line = (
  jobId: string,
  over: Partial<NonNullable<FinalizeLine["job"]>> = {},
): FinalizeLine => ({
  jobId,
  job: {
    id: jobId,
    scheduleId: "sched-1",
    date: utc(2026, 9, 7),
    billsMonthly: false,
    ...over,
  },
})

describe("a per-clean invoice", () => {
  it("bills exactly the cleans it has lines for", () => {
    // The reported defect: finalize also swept in every other non-cancelled
    // clean on that schedule-month. On a per-clean account those are precisely
    // the cleans the reviewer took OFF the invoice.
    const targets = finalizeTargets([line("j1"), line("j2"), line("j3")])
    expect(targets.jobIds.sort()).toEqual(["j1", "j2", "j3"])
  })

  it("sweeps up no schedule-month at all", () => {
    // No sweep means the fourth clean stays billable and comes back to the queue.
    expect(finalizeTargets([line("j1")]).scheduleMonths).toEqual([])
  })

  it("still bills a clean that has a line but no schedule", () => {
    const oneOff = { jobId: "j9", job: { id: "j9", scheduleId: null, date: utc(2026, 9, 3), billsMonthly: false } }
    expect(finalizeTargets([oneOff]).jobIds).toEqual(["j9"])
  })
})

describe("a flat-rate month", () => {
  const monthly = (jobId: string, over = {}) => line(jobId, { billsMonthly: true, ...over })

  it("bills the whole schedule-month from its single line", () => {
    // One "Monthly Cleaning" line covers every clean in the month, so they all
    // have to be marked · otherwise they come back as unbilled next month.
    const targets = finalizeTargets([monthly("j1")])
    expect(targets.scheduleMonths).toHaveLength(1)
    expect(targets.scheduleMonths[0].scheduleId).toBe("sched-1")
  })

  it("covers the whole calendar month, end to end", () => {
    const [month] = finalizeTargets([monthly("j1")]).scheduleMonths
    expect(month.monthStart.toISOString()).toBe("2026-09-01T00:00:00.000Z")
    expect(month.monthEnd.toISOString()).toBe("2026-09-30T23:59:59.999Z")
  })

  it("names a schedule-month once however many lines touch it", () => {
    const targets = finalizeTargets([monthly("j1"), monthly("j2"), monthly("j3")])
    expect(targets.scheduleMonths).toHaveLength(1)
  })

  it("keeps two months of one schedule apart", () => {
    const targets = finalizeTargets([
      monthly("j1", { date: utc(2026, 9, 7) }),
      monthly("j2", { date: utc(2026, 10, 5) }),
    ])
    expect(targets.scheduleMonths).toHaveLength(2)
  })

  it("keeps two schedules in one month apart", () => {
    const targets = finalizeTargets([
      monthly("j1"),
      monthly("j2", { scheduleId: "sched-2" }),
    ])
    expect(targets.scheduleMonths.map(m => m.scheduleId).sort()).toEqual(["sched-1", "sched-2"])
  })
})

describe("an invoice mixing both", () => {
  it("sweeps the flat month and not the per-clean schedule", () => {
    const targets = finalizeTargets([
      line("j1", { billsMonthly: true, scheduleId: "flat" }),
      line("j2", { scheduleId: "per-clean" }),
    ])
    expect(targets.scheduleMonths.map(m => m.scheduleId)).toEqual(["flat"])
    expect(targets.jobIds.sort()).toEqual(["j1", "j2"])
  })
})

describe("the month boundaries", () => {
  it("are read in UTC, matching how service days are stored", () => {
    // Local month boundaries put a clean near either end into the wrong
    // month's sweep wherever the server does not run in UTC.
    const { monthStart, monthEnd } = utcMonthRange(utc(2026, 9, 1))
    expect(monthStart.toISOString()).toBe("2026-09-01T00:00:00.000Z")
    expect(monthEnd.toISOString()).toBe("2026-09-30T23:59:59.999Z")
  })

  it("hold a clean on the last day of the month in that month", () => {
    const { monthStart } = utcMonthRange(utc(2026, 8, 31))
    expect(monthStart.toISOString()).toBe("2026-08-01T00:00:00.000Z")
  })

  it("handle a December, where the next month is a new year", () => {
    const { monthEnd } = utcMonthRange(utc(2026, 12, 15))
    expect(monthEnd.toISOString()).toBe("2026-12-31T23:59:59.999Z")
  })

  it("handle a leap February", () => {
    const { monthEnd } = utcMonthRange(new Date(Date.UTC(2028, 1, 10, 12)))
    expect(monthEnd.toISOString()).toBe("2028-02-29T23:59:59.999Z")
  })
})

describe("edge cases", () => {
  it("returns nothing for an invoice with no lines", () => {
    expect(finalizeTargets([])).toEqual({ jobIds: [], scheduleMonths: [] })
  })

  it("ignores a line with no job, such as a manual adjustment", () => {
    const manual: FinalizeLine = { jobId: null, job: null }
    expect(finalizeTargets([manual])).toEqual({ jobIds: [], scheduleMonths: [] })
  })

  it("does not repeat a job named by two lines", () => {
    // A clean with both a cleaning line and an add-on line.
    expect(finalizeTargets([line("j1"), line("j1")]).jobIds).toEqual(["j1"])
  })
})
