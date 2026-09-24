import { describe, it, expect } from "vitest"
import {
  flatBillingGroups,
  groupOverlapsPeriod,
  intervalForPeriod,
  midMonthPriceChange,
  type FlatInterval,
} from "@/lib/flat-rate-groups"

const day = (m: number, d: number) => new Date(Date.UTC(2026, m - 1, d, 12, 0, 0))
const SEP = [day(9, 1), day(9, 30)] as const
const AUG = [day(8, 1), day(8, 31)] as const
const OCT = [day(10, 1), day(10, 31)] as const

const interval = (id: string, over: Partial<FlatInterval> = {}): FlatInterval => ({
  id,
  startDate: day(1, 8),
  endDate: null,
  cadenceAnchor: day(1, 8),
  pauseFrom: null,
  pauseTo: null,
  frequency: "WEEKLY",
  daysOfWeek: "[4]",
  monthlyPattern: null,
  customDates: null,
  defaultClientRate: 1000,
  ...over,
})

// "Change going forward" to $1,200 from Sep 15: the old row ends Sep 14 and the
// new one starts Sep 15, carrying the original series' anchor.
const before = interval("old", { endDate: day(9, 14) })
const after = interval("new", { startDate: day(9, 15), cadenceAnchor: day(1, 8), defaultClientRate: 1200 })

describe("a price change made going forward is one monthly service", () => {
  it("joins the new interval to the old one", () => {
    const groups = flatBillingGroups([after, before])
    expect(groups.get("new")).toBe("old")
    expect(groups.get("old")).toBe("old")
  })

  it("joins an interval split before the cadence anchor was recorded", () => {
    const legacy = interval("new", { startDate: day(9, 15), cadenceAnchor: null, defaultClientRate: 1200 })
    expect(flatBillingGroups([before, legacy]).get("new")).toBe("old")
  })

  it("chains several changes into one service", () => {
    const third = interval("third", { startDate: day(11, 1), cadenceAnchor: day(1, 8), defaultClientRate: 1300 })
    const middle = { ...after, endDate: day(10, 31) }
    const groups = flatBillingGroups([before, middle, third])
    expect(groups.get("third")).toBe("old")
  })

  it("still joins a pause and its resumption", () => {
    const paused = interval("paused", { endDate: day(8, 31), pauseFrom: day(9, 1), pauseTo: day(9, 20) })
    const resumed = interval("resumed", { startDate: day(9, 21) })
    expect(flatBillingGroups([paused, resumed]).get("resumed")).toBe("paused")
  })
})

describe("separate services at one location stay separate", () => {
  it("does not join a service running alongside", () => {
    // A weekly clean and a monthly deep clean, both flat rate.
    const deepClean = interval("deep", { startDate: day(3, 2), cadenceAnchor: day(3, 2), frequency: "MONTHLY", daysOfWeek: null, defaultClientRate: 400 })
    expect(flatBillingGroups([interval("weekly"), deepClean]).get("deep")).toBe("deep")
  })

  it("does not join a new service that starts the day after another ended", () => {
    // Added fresh, so it anchors on its own first day, not the old series.
    const fresh = interval("fresh", { startDate: day(9, 15), cadenceAnchor: day(9, 15), defaultClientRate: 1200 })
    expect(flatBillingGroups([before, fresh]).get("fresh")).toBe("fresh")
  })

  it("does not join across a gap", () => {
    const later = interval("later", { startDate: day(9, 20), cadenceAnchor: day(1, 8) })
    expect(flatBillingGroups([before, later]).get("later")).toBe("later")
  })
})

describe("what the month is billed at", () => {
  const group = [before, after]

  it("bills the month of the change at the new price", () => {
    expect(intervalForPeriod(group, ...SEP).id).toBe("new")
  })

  it("keeps earlier months at the old price", () => {
    // Taking the newest interval of the whole group would bill August at $1,200.
    expect(intervalForPeriod(group, ...AUG).id).toBe("old")
  })

  it("bills later months at the new price", () => {
    expect(intervalForPeriod(group, ...OCT).id).toBe("new")
  })

  it("bills a month spent paused on the paused terms", () => {
    const paused = interval("paused", { endDate: day(8, 31), pauseFrom: day(9, 1), pauseTo: day(10, 31) })
    const resumed = interval("resumed", { startDate: day(11, 1) })
    expect(groupOverlapsPeriod([paused, resumed], ...SEP)).toBe(true)
    expect(intervalForPeriod([paused, resumed], ...SEP).id).toBe("paused")
  })

  it("treats a change on the 1st as a new month, not a mid-month change", () => {
    const endAug = interval("old", { endDate: day(8, 31) })
    const fromSep = interval("new", { startDate: day(9, 1), defaultClientRate: 1200 })
    expect(intervalForPeriod([endAug, fromSep], ...SEP).id).toBe("new")
    expect(midMonthPriceChange([endAug, fromSep], ...SEP)).toBeNull()
  })
})

describe("the reviewer is told", () => {
  it("describes a mid-month price change", () => {
    expect(midMonthPriceChange([before, after], ...SEP)).toEqual({ from: 1000, to: 1200, effective: day(9, 15) })
  })

  it("says nothing when the price did not change", () => {
    const sameRate = { ...after, defaultClientRate: 1000 }
    expect(midMonthPriceChange([before, sameRate], ...SEP)).toBeNull()
  })

  it("says nothing in the months either side", () => {
    expect(midMonthPriceChange([before, after], ...AUG)).toBeNull()
    expect(midMonthPriceChange([before, after], ...OCT)).toBeNull()
  })
})
