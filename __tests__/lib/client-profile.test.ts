import { describe, it, expect } from "vitest"
import {
  accessSavePayload,
  arrivalInfo,
  billingStatus,
  clockLabel,
  copyForCleaner,
  descriptorLine,
  headerFigures,
  monthMoney,
  rateText,
  readAccess,
  scheduleHeadline,
  type MonthMoneySchedule,
} from "@/lib/client-profile"
import type { ClientListFacts } from "@/lib/client-listing"

const day = (m: number, d: number, y = 2026) => new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
const TODAY = day(9, 24)

describe("the schedule headline", () => {
  const s = (frequency: string, daysOfWeek: string | null = null, monthlyPattern: string | null = null) =>
    scheduleHeadline({ frequency, daysOfWeek, monthlyPattern, startDate: day(7, 9) })

  it("names whole days", () => {
    expect(s("WEEKLY", "[4]")).toBe("Weekly · Thursday")
    expect(s("BI_WEEKLY", "[1]")).toBe("Every 2 weeks · Monday")
    expect(s("WEEKLY", "[2,5]")).toBe("2x weekly · Tuesday & Friday")
    expect(s("WEEKLY", "[1,2,3,4,5]")).toBe("5x weekly · Monday–Friday")
    expect(s("WEEKLY", "[1,3,5]")).toBe("3x weekly · Monday, Wednesday, Friday")
  })

  it("calls every day of the week daily", () => {
    expect(s("WEEKLY", "[0,1,2,3,4,5,6]")).toBe("Daily")
  })

  it("names the start day when no days were saved", () => {
    // Jul 9 2026 is a Thursday.
    expect(s("EVERY_4_WEEKS", "[]")).toBe("Every 4 weeks · Thursday")
  })

  it("reads monthly patterns", () => {
    expect(s("2X_MONTHLY", null, '{"weekday":1,"weeks":[1,3]}')).toBe("Twice a month · 1st & 3rd Monday")
    expect(s("2X_MONTHLY", null, '{"type":"FIXED_DATES","dates":[7,21]}')).toBe("Twice a month · 7th & 21st")
    expect(s("MONTHLY")).toBe("Monthly · 9th")
  })
})

describe("arrival", () => {
  it("formats clock times", () => {
    expect(clockLabel("09:00")).toBe("9 AM")
    expect(clockLabel("13:30")).toBe("1:30 PM")
    expect(clockLabel("00:15")).toBe("12:15 AM")
    expect(clockLabel("9:00 AM")).toBe("9 AM")
  })

  it("tags a set time, a window, and anytime", () => {
    expect(arrivalInfo({ timeType: "SPECIFIC", startTime: "09:00" })).toMatchObject({ tag: "Set time", line: "Arrives at 9 AM" })
    expect(arrivalInfo({ timeType: "WINDOW", startWindowBegin: "08:00", startWindowEnd: "11:00" })).toMatchObject({ tag: "Window", line: "Anytime 8 AM – 11 AM" })
    expect(arrivalInfo({ timeType: "SPECIFIC" })).toMatchObject({ tag: "Flexible", line: "Anytime that day" })
  })
})

describe("rates", () => {
  it("says per month or per clean", () => {
    expect(rateText(2050, "FLAT_RATE")).toBe("$2,050/mo")
    expect(rateText(167.5, "PER_CLEAN")).toBe("$167.50/clean")
    expect(rateText(0, "PER_CLEAN")).toBe("–")
  })
})

describe("getting in", () => {
  it("keeps the free text and folds the old fields in, labelled", () => {
    const a = readAccess({ accessInfo: "Side door, code 4412", accessFields: { lockbox: "Key in box 12", notes: "Dog is friendly" } })
    expect(a.gettingIn).toBe("Side door, code 4412\nLockbox: Key in box 12")
    expect(a.notes).toBe("Dog is friendly")
  })

  it("is empty with nothing on file", () => {
    expect(readAccess({ accessInfo: null, accessFields: null })).toEqual({ gettingIn: "", notes: "" })
  })

  it("saves the folded text and drops the old fields", () => {
    expect(accessSavePayload({ gettingIn: " Side door\nLockbox: 12 ", notes: "" }))
      .toEqual({ accessInfo: "Side door\nLockbox: 12", accessFields: { notes: "" } })
  })

  it("copies where, how to get in, then notes", () => {
    expect(copyForCleaner("Main", "1 Main St", { gettingIn: "Code 4412", notes: "Alarm panel left" }))
      .toBe("Main · 1 Main St\nCode 4412\n\nAlarm panel left")
  })
})

const flat = (over: Partial<MonthMoneySchedule> = {}): MonthMoneySchedule => ({
  id: "s1",
  startDate: day(1, 5),
  endDate: null,
  cadenceAnchor: day(1, 5),
  pauseFrom: null,
  pauseTo: null,
  frequency: "WEEKLY",
  daysOfWeek: "[4]",
  monthlyPattern: null,
  customDates: null,
  defaultClientRate: 2050,
  defaultSubcontractorRate: 1400,
  clientPayType: "FLAT_RATE",
  subcontractorPayType: "FLAT_RATE",
  ...over,
})

describe("this month's money", () => {
  it("counts a flat service once, however many cleans", () => {
    const jobs = [3, 10, 17, 24].map(d => ({ date: day(9, d), status: "SCHEDULED", scheduleId: "s1", clientRate: 2050, subcontractorRate: 1400 }))
    expect(monthMoney([{ schedules: [flat()], jobs }], TODAY)).toEqual({ client: 2050, cleaners: 1400, margin: 650 })
  })

  it("counts a mid-month price change once, at the new price", () => {
    const old = flat({ endDate: day(9, 14) })
    const next = flat({ id: "s2", startDate: day(9, 15), defaultClientRate: 2200 })
    expect(monthMoney([{ schedules: [old, next], jobs: [] }], TODAY).client).toBe(2200)
  })

  it("ignores a flat service that ended before this month", () => {
    expect(monthMoney([{ schedules: [flat({ endDate: day(8, 31) })], jobs: [] }], TODAY).client).toBe(0)
  })

  it("adds per-clean work that was not cancelled, this month only", () => {
    const per = flat({ id: "p", clientPayType: "PER_CLEAN", subcontractorPayType: "PER_CLEAN" })
    const jobs = [
      { date: day(9, 3), status: "COMPLETED", scheduleId: "p", clientRate: 165, subcontractorRate: 100 },
      { date: day(9, 10), status: "CANCELLED", scheduleId: "p", clientRate: 165, subcontractorRate: 100 },
      { date: day(10, 1), status: "SCHEDULED", scheduleId: "p", clientRate: 165, subcontractorRate: 100 },
      { date: day(9, 12), status: "SCHEDULED", scheduleId: null, clientRate: 250, subcontractorRate: 120 },
    ]
    expect(monthMoney([{ schedules: [per], jobs }], TODAY)).toEqual({ client: 415, cleaners: 220, margin: 195 })
  })
})

const facts = (over: Partial<ClientListFacts> = {}): ClientListFacts => ({
  isActive: true, isTrial: false, pausedNow: false, hasRecurringSchedule: true, monthlyRecurring: 2050,
  pausedMonthly: 0, payType: "FLAT_RATE", rate: 2050, scheduleText: "1x Weekly: Thu", lastVisit: null,
  nextVisit: null, visitRate: null, trailing90: 0, hasAnyVisits: true, ...over,
})

describe("the header", () => {
  it("shows this month for a recurring client", () => {
    expect(headerFigures("recurring", facts(), { client: 2690, cleaners: 1510, margin: 1180 }))
      .toMatchObject({ label: "This month", value: "$2,690", sub: "$1,180 margin · cleaners $1,510" })
  })

  it("describes the client under its name", () => {
    expect(descriptorLine("recurring", facts(), 2, day(4, 1))).toBe("Monthly · 2 locations · Client since Apr 2026")
    expect(descriptorLine("inactive", facts({ hasAnyVisits: false }), 1, day(9, 24))).toBe("Not scheduled yet · 1 location · Added Sep 2026")
  })
})

describe("the billing card", () => {
  const inv = (status: string, over = {}) => ({
    id: status, invoiceNumber: "INV-1", status, totalAmount: 2050, dateCreated: day(9, 1), dateSent: day(9, 2), datePaid: null, ...over,
  })

  it("says what is owed before anything else", () => {
    expect(billingStatus("recurring", [inv("SENT")], "EMAIL")).toMatchObject({ value: "$2,050 due", sub: "INV-1 sent Sep 2" })
    expect(billingStatus("recurring", [inv("OVERDUE")], "EMAIL").value).toBe("$2,050 overdue")
  })

  it("is paid up only when nothing sent is unpaid", () => {
    expect(billingStatus("recurring", [inv("PAID", { datePaid: day(9, 10) })], "EMAIL"))
      .toMatchObject({ value: "Paid up", sub: "Last paid Sep 10" })
  })

  it("does not count drafts or voided invoices as owed, but says drafts are waiting", () => {
    expect(billingStatus("recurring", [inv("DRAFT"), inv("DRAFT"), inv("VOID")], "EMAIL"))
      .toMatchObject({ value: "Nothing sent yet", sub: "2 drafts waiting" })
    expect(billingStatus("recurring", [inv("VOID")], "EMAIL").value).toBe("No invoices yet")
  })
})
