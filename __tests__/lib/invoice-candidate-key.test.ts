import { describe, it, expect } from "vitest"
import { invoiceCandidateKey, periodRange } from "@/lib/invoice-candidate-key"

describe("invoiceCandidateKey", () => {
  it("is stable regardless of the order the jobs came back in", () => {
    expect(invoiceCandidateKey("2026-08", ["loc-b", "loc-a"]))
      .toBe(invoiceCandidateKey("2026-08", ["loc-a", "loc-b"]))
  })

  it("collapses duplicates · many cleans at one location is still one location", () => {
    expect(invoiceCandidateKey("2026-08", ["loc-a", "loc-a", "loc-a"])).toBe("2026-08|loc-a")
  })

  it("separates the same client's locations, which are invoiced separately", () => {
    expect(invoiceCandidateKey("2026-08", ["office-1"]))
      .not.toBe(invoiceCandidateKey("2026-08", ["office-2"]))
  })

  it("separates a combined invoice from a single-location one", () => {
    expect(invoiceCandidateKey("2026-08", ["a", "b"])).not.toBe(invoiceCandidateKey("2026-08", ["a"]))
  })

  it("separates the same location across periods", () => {
    expect(invoiceCandidateKey("2026-08", ["a"])).not.toBe(invoiceCandidateKey("2026-09", ["a"]))
  })

  it("returns null when there is nothing to key on, so the caller skips the check", () => {
    expect(invoiceCandidateKey("2026-08", [])).toBeNull()
    expect(invoiceCandidateKey("august", ["a"])).toBeNull()
    expect(invoiceCandidateKey("", ["a"])).toBeNull()
  })
})

describe("periodRange", () => {
  it("covers the whole month, including the last instant of the last day", () => {
    const r = periodRange("2026-08")!
    expect(r.start.getFullYear()).toBe(2026)
    expect(r.start.getMonth()).toBe(7)
    expect(r.start.getDate()).toBe(1)
    expect(r.end.getMonth()).toBe(7)
    expect(r.end.getDate()).toBe(31)
    expect(r.end.getHours()).toBe(23)
  })

  it("handles February and a leap year", () => {
    expect(periodRange("2026-02")!.end.getDate()).toBe(28)
    expect(periodRange("2028-02")!.end.getDate()).toBe(29)
  })

  it("rejects anything that is not a real YYYY-MM", () => {
    expect(periodRange("2026-13")).toBeNull()
    expect(periodRange("2026-00")).toBeNull()
    expect(periodRange("2026-8")).toBeNull()
    expect(periodRange("nope")).toBeNull()
  })
})
