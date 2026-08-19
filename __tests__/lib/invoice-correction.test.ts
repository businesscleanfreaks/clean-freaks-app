import { describe, it, expect } from "vitest"
import { buildCorrectionRows, correctionToast } from "@/lib/invoice-correction"

const CLEANS = [
  { jobId: "j1", date: "2026-08-04", status: "COMPLETED", clientRate: 120 },
  { jobId: "j2", date: "2026-08-11", status: "CANCELLED", clientRate: 120 },
  { jobId: "j3", date: "2026-08-18", status: "SCHEDULED", clientRate: 120 },
]

describe("buildCorrectionRows", () => {
  it("lists only the cancelled cleans · there is nothing to correct about the rest", () => {
    const rows = buildCorrectionRows("2026-08", CLEANS)
    expect(rows.map(r => r.jobId)).toEqual(["j2"])
    expect(rows[0].dateLabel).toBe("Aug 11")
    expect(rows[0].billed).toBe(false)
    expect(rows[0].description).toBe("Cancelled · not billed")
    expect(rows[0].actionLabel).toBe("It happened")
    expect(rows[0].target).toBe("COMPLETED")
  })

  it("keeps a clean listed after it is restored, so the change can be undone", () => {
    const restored = CLEANS.map(c => (c.jobId === "j2" ? { ...c, status: "COMPLETED" } : c))
    const rows = buildCorrectionRows("2026-08", restored, ["j2"])
    expect(rows).toHaveLength(1)
    expect(rows[0].billed).toBe(true)
    expect(rows[0].description).toBe("Completed · billed · cleaner credited")
    expect(rows[0].effect).toBe("+$120.00")
    expect(rows[0].actionLabel).toBe("Undo")
    expect(rows[0].target).toBe("CANCELLED")
  })

  it("surfaces a late-cancel fee, which restoring the clean would drop", () => {
    const withFee = [{ jobId: "j9", date: "2026-08-06", status: "CANCELLED", clientRate: 150, cancellationFee: 75 }]
    const [row] = buildCorrectionRows("2026-08", withFee)
    expect(row.description).toBe("Cancelled · not billed · $75.00 cancellation fee")
    expect(row.effect).toBe("+$75.00")
    expect(row.droppedFee).toBe(75)
  })

  it("ignores cleans from other months", () => {
    const other = [{ jobId: "jX", date: "2026-07-11", status: "CANCELLED", clientRate: 120 }]
    expect(buildCorrectionRows("2026-08", other)).toEqual([])
  })

  it("skips cleans with no job to write back to", () => {
    expect(buildCorrectionRows("2026-08", [{ date: "2026-08-11", status: "CANCELLED" }])).toEqual([])
  })

  it("ignores an unparseable date rather than rendering a broken row", () => {
    expect(buildCorrectionRows("2026-08", [{ jobId: "j", date: "not-a-date", status: "CANCELLED" }])).toEqual([])
  })

  it("orders rows by day", () => {
    const many = [
      { jobId: "b", date: "2026-08-20", status: "CANCELLED", clientRate: 1 },
      { jobId: "a", date: "2026-08-03", status: "CANCELLED", clientRate: 1 },
    ]
    expect(buildCorrectionRows("2026-08", many).map(r => r.day)).toEqual([3, 20])
  })

  it("formats money with separators", () => {
    const big = [{ jobId: "j", date: "2026-08-05", status: "COMPLETED", clientRate: 1234.5 }]
    expect(buildCorrectionRows("2026-08", big, ["j"])[0].effect).toBe("+$1,234.50")
  })
})

describe("correctionToast", () => {
  it("says the calendar changed, because this is not a local edit", () => {
    expect(correctionToast("CANCELLED")).toBe("Marked cancelled · calendar updated")
    expect(correctionToast("COMPLETED", "Amy")).toBe("Marked completed · calendar updated · Amy credited")
  })

  it("mentions a dropped cancellation fee", () => {
    expect(correctionToast("COMPLETED", "Amy", 75))
      .toBe("Marked completed · calendar updated · Amy credited · cancellation fee dropped")
  })

  it("copes with no cleaner assigned", () => {
    expect(correctionToast("COMPLETED", null)).toBe("Marked completed · calendar updated")
  })
})
