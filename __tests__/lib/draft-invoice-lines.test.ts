import { describe, it, expect } from "vitest"
import {
  cleaningLineDescription,
  draftLineUpdates,
  type DraftLine,
  type EditedJob,
} from "@/lib/draft-invoice-lines"

const job: EditedJob = {
  clientRate: 100,
  date: new Date(Date.UTC(2026, 8, 2, 12, 0, 0)),
  clientName: "Bigco Offices",
  billsMonthly: false,
}

const cleaningLine: DraftLine = {
  id: "li-clean",
  addOnServiceId: null,
  amount: 100,
  description: "Cleaning - Bigco Offices - Sep 2, 2026",
}

const addOnLine: DraftLine = {
  id: "li-addon",
  addOnServiceId: "ao-1",
  amount: 25,
  description: "Carpet shampoo",
}

describe("a time-only edit", () => {
  const timeOnly = { rate: false, date: false }

  it("changes nothing at all", () => {
    // The reported defect: the refresh fired on startTime and window changes
    // and rewrote every line's amount to the job's client rate.
    expect(draftLineUpdates([cleaningLine, addOnLine], job, timeOnly)).toEqual([])
  })

  it("changes nothing even when the invoice has several lines", () => {
    const lines = [cleaningLine, addOnLine, { ...addOnLine, id: "li-addon-2", addOnServiceId: "ao-2" }]
    expect(draftLineUpdates(lines, job, timeOnly)).toEqual([])
  })
})

describe("an add-on line", () => {
  it("is never repriced by a job edit", () => {
    // A $100 clean with a $25 add-on became $100 and $100, so a $125 invoice
    // became $200.
    const updates = draftLineUpdates([cleaningLine, addOnLine], job, { rate: true, date: false })
    expect(updates.map(u => u.id)).toEqual(["li-clean"])
  })

  it("keeps its own wording when the day changes", () => {
    const updates = draftLineUpdates([addOnLine], job, { rate: false, date: true })
    expect(updates).toEqual([])
  })

  it("is left alone even when it is the only line", () => {
    expect(draftLineUpdates([addOnLine], job, { rate: true, date: true })).toEqual([])
  })
})

describe("a rate change", () => {
  it("moves the cleaning line to the new rate", () => {
    const updates = draftLineUpdates([cleaningLine], { ...job, clientRate: 140 }, { rate: true, date: false })
    expect(updates).toEqual([{ id: "li-clean", amount: 140 }])
  })

  it("does not rewrite the description", () => {
    // Custom wording on a line survives a reprice.
    const updates = draftLineUpdates(
      [{ ...cleaningLine, description: "Deep clean, agreed with Dana" }],
      { ...job, clientRate: 140 },
      { rate: true, date: false },
    )
    expect(updates[0].description).toBeUndefined()
  })

  it("leaves the amount alone when the job has no rate to apply", () => {
    const updates = draftLineUpdates([cleaningLine], { ...job, clientRate: null }, { rate: true, date: false })
    expect(updates).toEqual([])
  })
})

describe("a date change", () => {
  it("moves the description and the service date", () => {
    const moved = { ...job, date: new Date(Date.UTC(2026, 8, 9, 12, 0, 0)) }
    const [update] = draftLineUpdates([cleaningLine], moved, { rate: false, date: true })
    expect(update.description).toBe("Cleaning - Bigco Offices - Sep 9, 2026")
    expect(update.serviceDate).toEqual(moved.date)
  })

  it("does not change the amount", () => {
    const moved = { ...job, date: new Date(Date.UTC(2026, 8, 9, 12, 0, 0)) }
    const [update] = draftLineUpdates([cleaningLine], moved, { rate: false, date: true })
    expect(update.amount).toBeUndefined()
  })

  it("carries the service date, which the old refresh never updated", () => {
    const moved = { ...job, date: new Date(Date.UTC(2026, 8, 9, 12, 0, 0)) }
    const [update] = draftLineUpdates([cleaningLine], moved, { rate: false, date: true })
    expect(update.serviceDate).not.toBeUndefined()
  })
})

describe("a rate and date change together", () => {
  it("moves both, on the cleaning line only", () => {
    const moved = { ...job, clientRate: 140, date: new Date(Date.UTC(2026, 8, 9, 12, 0, 0)) }
    const updates = draftLineUpdates([cleaningLine, addOnLine], moved, { rate: true, date: true })
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ id: "li-clean", amount: 140 })
    expect(updates[0].description).toContain("Sep 9")
  })
})

describe("the description", () => {
  it("reads the day in UTC, matching how job dates are stored", () => {
    // Job dates are stored at noon UTC so they cannot slide a day. Formatting
    // them in the server's local zone would put them back.
    expect(cleaningLineDescription(job)).toBe("Cleaning - Bigco Offices - Sep 2, 2026")
  })

  it("does not slide a month end into the next month", () => {
    const monthEnd = { ...job, date: new Date(Date.UTC(2026, 7, 31, 12, 0, 0)) }
    expect(cleaningLineDescription(monthEnd)).toContain("Aug 31, 2026")
  })
})

describe("edge cases", () => {
  it("returns nothing for no lines", () => {
    expect(draftLineUpdates([], job, { rate: true, date: true })).toEqual([])
  })

  it("updates every cleaning line when a job somehow has two", () => {
    const second = { ...cleaningLine, id: "li-clean-2" }
    const updates = draftLineUpdates([cleaningLine, second], { ...job, clientRate: 140 }, { rate: true, date: false })
    expect(updates.map(u => u.id)).toEqual(["li-clean", "li-clean-2"])
  })
})

describe("a flat-rate client's monthly line", () => {
  // The draft carries ONE "Monthly Cleaning - <location> - <month>" line for
  // the month, attached to the first clean of it. That gives it a jobId and no
  // addOnServiceId · indistinguishable from a per-clean cleaning line by shape
  // alone, which is why filtering add-ons was not enough on its own.
  const monthlyLine: DraftLine = {
    id: "li-monthly",
    addOnServiceId: null,
    amount: 4000,
    description: "Monthly Cleaning - Bigco HQ - September 2026",
  }
  const flatRateJob: EditedJob = { ...job, billsMonthly: true }

  it("is not repriced when one clean's rate changes", () => {
    // The month's price comes from the schedule, not from this clean. Rewriting
    // it put one clean's rate on the whole month.
    const updates = draftLineUpdates([monthlyLine], { ...flatRateJob, clientRate: 140 }, { rate: true, date: false })
    expect(updates).toEqual([])
  })

  it("keeps its wording when one clean moves day", () => {
    // "Monthly Cleaning - Bigco HQ - September 2026" became
    // "Cleaning - Bigco Offices - Sep 9, 2026": a month's line describing a day.
    const moved = { ...flatRateJob, date: new Date(Date.UTC(2026, 8, 9, 12, 0, 0)) }
    expect(draftLineUpdates([monthlyLine], moved, { rate: false, date: true })).toEqual([])
  })

  it("is left alone even alongside an add-on line", () => {
    const addOn: DraftLine = { id: "li-addon", addOnServiceId: "ao-1", amount: 25, description: "Carpet shampoo" }
    expect(draftLineUpdates([monthlyLine, addOn], flatRateJob, { rate: true, date: true })).toEqual([])
  })

  it("still moves a per-clean line for a per-clean client", () => {
    // The guard must not spread: per-clean billing still follows the clean.
    const updates = draftLineUpdates([cleaningLine], { ...job, clientRate: 140 }, { rate: true, date: false })
    expect(updates).toEqual([{ id: "li-clean", amount: 140 }])
  })
})
