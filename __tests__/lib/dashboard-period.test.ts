import { describe, it, expect } from "vitest"
import {
  periodBasis,
  periodHeading,
  periodTotalsByClient,
  totalsFor,
  type PeriodJob,
} from "@/lib/dashboard-period"

const job = (over: Partial<PeriodJob> & { id: string }): PeriodJob => ({
  clientId: "client-1",
  scheduleId: "sched-1",
  clientRate: 100,
  subcontractorRate: 65,
  clientPayType: "PER_CLEAN",
  subcontractorPayType: "PER_CLEAN",
  recurringAddOns: [],
  jobAddOns: [],
  ...over,
})

describe("a past month is computed from the work that happened", () => {
  it("counts per-clean work per clean", () => {
    const totals = totalsFor(
      periodTotalsByClient([job({ id: "a" }), job({ id: "b" }), job({ id: "c" })]),
      "client-1",
    )
    expect(totals).toEqual({ revenue: 300, cleanerCost: 195, jobCount: 3 })
  })

  it("counts flat-rate work once for the month", () => {
    const flat = { clientPayType: "FLAT_RATE", subcontractorPayType: "FLAT_RATE" }
    const totals = totalsFor(
      periodTotalsByClient([
        job({ id: "a", ...flat, clientRate: 4000, subcontractorRate: 2500 }),
        job({ id: "b", ...flat, clientRate: 4000, subcontractorRate: 2500 }),
      ]),
      "client-1",
    )
    expect(totals.revenue).toBe(4000)
    expect(totals.cleanerCost).toBe(2500)
    expect(totals.jobCount).toBe(2)
  })

  it("counts a schedule that has since ended", () => {
    // The reported defect: the period figures were computed inside a loop over
    // the schedules current TODAY, so August's work on an August agreement
    // stopped counting the moment a September agreement started.
    const august = periodTotalsByClient([
      job({ id: "a", scheduleId: "ended-in-august" }),
      job({ id: "b", scheduleId: "ended-in-august" }),
    ])
    expect(totalsFor(august, "client-1").revenue).toBe(200)
  })

  it("does not move when a new schedule starts later", () => {
    // Same jobs, same answer, whatever the client's arrangement is now.
    const jobs = [job({ id: "a", scheduleId: "old" }), job({ id: "b", scheduleId: "old" })]
    const before = totalsFor(periodTotalsByClient(jobs), "client-1")
    const after = totalsFor(periodTotalsByClient(jobs), "client-1")
    expect(after).toEqual(before)
  })

  it("counts two schedules of one client separately", () => {
    const flat = { clientPayType: "FLAT_RATE", subcontractorPayType: "FLAT_RATE" }
    const totals = totalsFor(
      periodTotalsByClient([
        job({ id: "a", scheduleId: "s1", ...flat, clientRate: 1000, subcontractorRate: 600 }),
        job({ id: "b", scheduleId: "s2", ...flat, clientRate: 500, subcontractorRate: 300 }),
      ]),
      "client-1",
    )
    expect(totals.revenue).toBe(1500)
    expect(totals.cleanerCost).toBe(900)
  })
})

describe("one-off work", () => {
  it("counts even when the client has no recurring schedule at all", () => {
    // The reported defect: a client with no active schedule returned null
    // before its one-off jobs were considered, so it vanished from the month.
    const totals = totalsFor(
      periodTotalsByClient([job({ id: "a", scheduleId: null, clientRate: 250, subcontractorRate: 150 })]),
      "client-1",
    )
    expect(totals).toEqual({ revenue: 250, cleanerCost: 150, jobCount: 1 })
  })

  it("counts each one-off separately, never once for the month", () => {
    const totals = totalsFor(
      periodTotalsByClient([
        job({ id: "a", scheduleId: null, clientPayType: "FLAT_RATE" }),
        job({ id: "b", scheduleId: null, clientPayType: "FLAT_RATE" }),
      ]),
      "client-1",
    )
    expect(totals.jobCount).toBe(2)
    expect(totals.revenue).toBe(200)
  })

  it("adds to the same client as their recurring work", () => {
    const totals = totalsFor(
      periodTotalsByClient([
        job({ id: "a" }),
        job({ id: "b", scheduleId: null, clientRate: 250, subcontractorRate: 150 }),
      ]),
      "client-1",
    )
    expect(totals).toEqual({ revenue: 350, cleanerCost: 215, jobCount: 2 })
  })
})

describe("add-ons", () => {
  it("counts a recurring add-on once for the month", () => {
    const addOn = [{ clientRate: 80, subcontractorRate: 50 }]
    const totals = totalsFor(
      periodTotalsByClient([
        job({ id: "a", recurringAddOns: addOn }),
        job({ id: "b", recurringAddOns: addOn }),
      ]),
      "client-1",
    )
    expect(totals.revenue).toBe(280)
    expect(totals.cleanerCost).toBe(180)
  })

  it("counts a job add-on on every clean that had one", () => {
    const totals = totalsFor(
      periodTotalsByClient([
        job({ id: "a", jobAddOns: [{ clientRate: 40, subcontractorRate: 25 }] }),
        job({ id: "b", jobAddOns: [{ clientRate: 40, subcontractorRate: 25 }] }),
      ]),
      "client-1",
    )
    expect(totals.revenue).toBe(280)
  })
})

describe("several clients", () => {
  it("keeps them apart", () => {
    const byClient = periodTotalsByClient([
      job({ id: "a", clientId: "c1" }),
      job({ id: "b", clientId: "c2", scheduleId: "s2", clientRate: 300, subcontractorRate: 200 }),
    ])
    expect(totalsFor(byClient, "c1").revenue).toBe(100)
    expect(totalsFor(byClient, "c2").revenue).toBe(300)
  })

  it("gives zeroes for a client that did no work, not undefined", () => {
    expect(totalsFor(periodTotalsByClient([]), "nobody")).toEqual({
      revenue: 0, cleanerCost: 0, jobCount: 0,
    })
  })
})

describe("saying what the figures are", () => {
  it("calls a past month actuals", () => {
    expect(periodBasis(true)).toBe("actual")
    expect(periodHeading("August 2026", "actual")).toBe("August 2026 actuals")
  })

  it("calls a current or future month a forecast", () => {
    // The screen said "actuals" for every month and put Net Profit under it,
    // including months where no completed job is read at all.
    expect(periodBasis(false)).toBe("projected")
    expect(periodHeading("October 2026", "projected")).toBe("October 2026 forecast")
  })
})
