import { describe, it, expect } from "vitest"
import {
  buildObligations,
  coveredJobIds,
  jobKey,
  obligationKeysForJobs,
  lineBelongsToObligation,
  obligationLines,
  obligationsTotal,
  periodOf,
  scheduleMonthKey,
  type PayableJob,
} from "@/lib/payment-obligations"

const job = (over: Partial<PayableJob> & { id: string }): PayableJob => ({
  date: "2026-08-03T12:00:00.000Z",
  scheduleId: "sched-1",
  subcontractorRate: 1000,
  clientId: "client-1",
  subcontractorPayType: "FLAT_RATE",
  addOnTotal: 0,
  ...over,
})

describe("periodOf", () => {
  it("reads the month in UTC, matching how job dates are stored", () => {
    expect(periodOf("2026-08-03T12:00:00.000Z")).toBe("2026-08")
    expect(periodOf(new Date(Date.UTC(2026, 11, 31, 12)))).toBe("2026-12")
  })

  it("does not slide a month-end into the next month", () => {
    expect(periodOf("2026-08-31T12:00:00.000Z")).toBe("2026-08")
  })
})

describe("a flat-rate month", () => {
  const august = [
    job({ id: "a" }),
    job({ id: "b", date: "2026-08-10T12:00:00.000Z" }),
    job({ id: "c", date: "2026-08-17T12:00:00.000Z" }),
  ]

  it("owes the monthly rate once, however many cleans are selected", () => {
    // The defect this replaces: the monthly rate was added once per REQUEST, so
    // paying two jobs in two selections recorded $1,000 twice.
    const obligations = buildObligations(august)
    expect(obligations).toHaveLength(1)
    expect(obligations[0].amount).toBe(1000)
    expect(obligations[0].kind).toBe("SCHEDULE_MONTH")
  })

  it("covers every clean in that month, not just the first", () => {
    // The undo defect: one line item was written against the first job while
    // all of them were marked paid.
    expect(buildObligations(august)[0].jobIds).toEqual(["a", "b", "c"])
  })

  it("is the same obligation whichever clean you start from", () => {
    // So paying job b after paying job a hits the same key and is refused.
    expect(obligationKeysForJobs([august[0]])).toEqual(obligationKeysForJobs([august[1]]))
  })

  it("keys on the schedule and the month", () => {
    expect(buildObligations(august)[0].key).toBe(scheduleMonthKey("sched-1", "2026-08"))
  })

  it("separates two months of the same schedule", () => {
    const obligations = buildObligations([
      job({ id: "a" }),
      job({ id: "d", date: "2026-09-07T12:00:00.000Z" }),
    ])
    expect(obligations).toHaveLength(2)
    expect(obligationsTotal(obligations)).toBe(2000)
  })

  it("separates two schedules in the same month", () => {
    const obligations = buildObligations([
      job({ id: "a" }),
      job({ id: "e", scheduleId: "sched-2" }),
    ])
    expect(obligations).toHaveLength(2)
  })

  it("pays add-ons on top, per clean", () => {
    // The month's rate is fixed; extra work is extra money.
    const obligations = buildObligations([
      job({ id: "a", addOnTotal: 50 }),
      job({ id: "b", date: "2026-08-10T12:00:00.000Z", addOnTotal: 75 }),
    ])
    expect(obligations[0].amount).toBe(1125)
  })
})

describe("per-clean and one-off work", () => {
  it("owes per visit", () => {
    const obligations = buildObligations([
      job({ id: "a", subcontractorPayType: "PER_CLEAN", subcontractorRate: 80 }),
      job({ id: "b", subcontractorPayType: "PER_CLEAN", subcontractorRate: 80, date: "2026-08-10T12:00:00.000Z" }),
    ])
    expect(obligations).toHaveLength(2)
    expect(obligationsTotal(obligations)).toBe(160)
  })

  it("treats a one-off as its own obligation even on a flat-rate cleaner", () => {
    // No schedule means no monthly rate to spread it into.
    const obligations = buildObligations([job({ id: "x", scheduleId: null, subcontractorRate: 120 })])
    expect(obligations[0].key).toBe(jobKey("x"))
    expect(obligations[0].amount).toBe(120)
  })

  it("keys each clean separately", () => {
    const obligations = buildObligations([
      job({ id: "a", subcontractorPayType: "PER_CLEAN" }),
      job({ id: "b", subcontractorPayType: "PER_CLEAN" }),
    ])
    expect(new Set(obligations.map(o => o.key)).size).toBe(2)
  })
})

describe("a mixed selection", () => {
  const mixed = [
    job({ id: "flat-1" }),
    job({ id: "flat-2", date: "2026-08-10T12:00:00.000Z" }),
    job({ id: "per-1", scheduleId: "sched-9", subcontractorPayType: "PER_CLEAN", subcontractorRate: 80 }),
    job({ id: "oneoff", scheduleId: null, subcontractorRate: 150 }),
  ]

  it("bills the flat month once and the rest individually", () => {
    const obligations = buildObligations(mixed)
    expect(obligations).toHaveLength(3)
    expect(obligationsTotal(obligations)).toBe(1000 + 80 + 150)
  })

  it("covers every selected job exactly once", () => {
    expect(coveredJobIds(buildObligations(mixed)).sort())
      .toEqual(["flat-1", "flat-2", "oneoff", "per-1"])
  })
})

describe("edge cases", () => {
  it("returns nothing for nothing", () => {
    expect(buildObligations([])).toEqual([])
    expect(obligationsTotal([])).toBe(0)
  })

  it("rounds to the cent rather than carrying float noise", () => {
    const obligations = buildObligations([
      job({ id: "a", subcontractorPayType: "PER_CLEAN", subcontractorRate: 0.1, addOnTotal: 0.2 }),
    ])
    expect(obligations[0].amount).toBe(0.3)
  })

  it("treats an unknown pay type as per clean", () => {
    // Safer to owe per visit than to assume a month is covered.
    const obligations = buildObligations([
      job({ id: "a", subcontractorPayType: null }),
      job({ id: "b", subcontractorPayType: null, date: "2026-08-10T12:00:00.000Z" }),
    ])
    expect(obligations).toHaveLength(2)
  })
})

describe("line items, one per covered clean", () => {
  const flatMonth = [
    job({ id: "a", date: "2026-08-03T12:00:00.000Z" }),
    job({ id: "b", date: "2026-08-10T12:00:00.000Z" }),
    job({ id: "c", date: "2026-08-17T12:00:00.000Z", addOnTotal: 40 }),
  ]

  it("writes a row for every clean, not only the first", () => {
    // The payment history counts these rows to say "N cleans". A fifteen-visit
    // flat month reported "1 clean", because only the first job got a row.
    const [obligation] = buildObligations(flatMonth)
    expect(obligation.lines.map(l => l.jobId)).toEqual(["a", "b", "c"])
  })

  it("puts the monthly rate on the first clean and add-ons on their own", () => {
    const [obligation] = buildObligations(flatMonth)
    expect(obligation.lines).toEqual([
      { jobId: "a", amount: 1000 },
      { jobId: "b", amount: 0 },
      { jobId: "c", amount: 40 },
    ])
  })

  it("sums the rows to exactly what the obligation is worth", () => {
    // Several routes recompute a payment total by summing its line items, so a
    // split that does not add up would quietly restate the payment.
    for (const obligation of buildObligations(flatMonth)) {
      const summed = obligation.lines.reduce((sum, l) => sum + l.amount, 0)
      expect(summed).toBe(obligation.amount)
    }
  })

  it("sums every row in a mixed payment to the payment total", () => {
    const obligations = buildObligations([
      ...flatMonth,
      job({ id: "d", scheduleId: "sched-2", subcontractorPayType: "PER_CLEAN", subcontractorRate: 65 }),
      job({ id: "e", scheduleId: null, subcontractorPayType: null, subcontractorRate: 50, addOnTotal: 15 }),
    ])
    const summed = obligationLines(obligations).reduce((sum, l) => sum + l.amount, 0)
    expect(summed).toBe(obligationsTotal(obligations))
    expect(obligationLines(obligations)).toHaveLength(5)
  })

  it("gives one row per clean with no duplicates", () => {
    const lines = obligationLines(buildObligations(flatMonth))
    expect(new Set(lines.map(l => l.jobId)).size).toBe(lines.length)
  })
})

describe("matching line items back to the obligation being reversed", () => {
  const monthObligation = {
    kind: "SCHEDULE_MONTH",
    obligationKey: scheduleMonthKey("sched-1", "2026-08"),
    scheduleId: "sched-1",
    period: "2026-08",
  }
  const line = (jobId: string, date: string, scheduleId: string | null) => ({
    jobId,
    job: { date, scheduleId },
  })

  it("claims every clean of that schedule in that month", () => {
    expect(lineBelongsToObligation(monthObligation, line("a", "2026-08-03T12:00:00.000Z", "sched-1"))).toBe(true)
    expect(lineBelongsToObligation(monthObligation, line("b", "2026-08-31T12:00:00.000Z", "sched-1"))).toBe(true)
  })

  it("does not claim the next month of the same schedule", () => {
    // Undoing August must not unmark September, which a different payment paid.
    expect(lineBelongsToObligation(monthObligation, line("c", "2026-09-01T12:00:00.000Z", "sched-1"))).toBe(false)
  })

  it("does not claim another schedule in the same month", () => {
    expect(lineBelongsToObligation(monthObligation, line("d", "2026-08-05T12:00:00.000Z", "sched-2"))).toBe(false)
  })

  it("does not claim a one-off clean that has no schedule", () => {
    expect(lineBelongsToObligation(monthObligation, line("e", "2026-08-05T12:00:00.000Z", null))).toBe(false)
  })

  it("claims exactly its own clean for a per-clean obligation", () => {
    const perClean = { kind: "JOB", obligationKey: jobKey("x"), scheduleId: null, period: "2026-08" }
    expect(lineBelongsToObligation(perClean, line("x", "2026-08-05T12:00:00.000Z", null))).toBe(true)
    expect(lineBelongsToObligation(perClean, line("y", "2026-08-05T12:00:00.000Z", null))).toBe(false)
  })

  it("survives a line item whose job record is gone", () => {
    expect(lineBelongsToObligation(monthObligation, { jobId: "a", job: null })).toBe(false)
  })
})
