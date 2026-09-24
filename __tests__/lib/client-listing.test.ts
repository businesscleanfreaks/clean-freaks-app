import { describe, it, expect } from "vitest"
import {
  clientListDisplay,
  cleanerGroupMeta,
  deriveClientStatus,
  listInitials,
  shortMoney,
  sortCleanerGroups,
  statusInTab,
  visitMoney,
  wholeMoney,
  type ClientListFacts,
} from "@/lib/client-listing"

const TODAY = new Date(Date.UTC(2026, 8, 23, 12, 0, 0))
const day = (m: number, d: number) => new Date(Date.UTC(2026, m - 1, d, 12, 0, 0))

const facts = (over: Partial<ClientListFacts> = {}): ClientListFacts => ({
  isActive: true,
  isTrial: false,
  pausedNow: false,
  hasRecurringSchedule: false,
  monthlyRecurring: 0,
  pausedMonthly: 0,
  payType: null,
  rate: null,
  scheduleText: "",
  lastVisit: null,
  nextVisit: null,
  visitRate: null,
  trailing90: 0,
  hasAnyVisits: false,
  ...over,
})

describe("a client's status comes from the work, not a stored field", () => {
  it("is recurring when it has a current schedule", () => {
    expect(deriveClientStatus(facts({ hasRecurringSchedule: true, monthlyRecurring: 1449 }), TODAY)).toBe("recurring")
  })

  it("is recurring even before the rate has been entered", () => {
    // The mockup keyed this on monthly revenue above zero, which works on a
    // spreadsheet and not on real records: a new schedule with no rate yet is
    // still a recurring client.
    expect(deriveClientStatus(facts({ hasRecurringSchedule: true, monthlyRecurring: 0 }), TODAY)).toBe("recurring")
  })

  it("is as-needed with an upcoming one-off visit", () => {
    expect(deriveClientStatus(facts({ hasAnyVisits: true, nextVisit: day(10, 3) }), TODAY)).toBe("asneeded")
  })

  it("is as-needed with a visit in the last 90 days", () => {
    expect(deriveClientStatus(facts({ hasAnyVisits: true, lastVisit: day(7, 1) }), TODAY)).toBe("asneeded")
  })

  it("goes inactive when the last visit was more than 90 days ago and nothing is booked", () => {
    expect(deriveClientStatus(facts({ hasAnyVisits: true, lastVisit: day(3, 3) }), TODAY)).toBe("inactive")
  })

  it("is inactive when nothing has ever been scheduled", () => {
    expect(deriveClientStatus(facts(), TODAY)).toBe("inactive")
  })
})

describe("the three human decisions win over the work", () => {
  it("an ended client is inactive however much work it has", () => {
    expect(deriveClientStatus(facts({ isActive: false, hasRecurringSchedule: true }), TODAY)).toBe("inactive")
  })

  it("a trial client is trial even with a schedule", () => {
    expect(deriveClientStatus(facts({ isTrial: true, hasRecurringSchedule: true }), TODAY)).toBe("trial")
  })

  it("a paused client is paused even though its resumed schedule is current", () => {
    // A finite pause ends one interval and starts a resumed one in the future,
    // so a current schedule exists during the pause. The pause has to win.
    expect(deriveClientStatus(facts({ pausedNow: true, hasRecurringSchedule: true }), TODAY)).toBe("paused")
  })
})

describe("which tab a client lands in", () => {
  it("keeps paused clients under Recurring, where they come back to", () => {
    expect(statusInTab("paused", "recurring")).toBe(true)
    expect(statusInTab("paused", "inactive")).toBe(false)
  })

  it("puts every status under All", () => {
    for (const s of ["recurring", "paused", "trial", "asneeded", "inactive"] as const) {
      expect(statusInTab(s, "all")).toBe(true)
    }
  })

  it("keeps the other statuses to their own tab", () => {
    expect(statusInTab("trial", "trial")).toBe(true)
    expect(statusInTab("trial", "recurring")).toBe(false)
    expect(statusInTab("asneeded", "asneeded")).toBe(true)
  })
})

describe("what each row says", () => {
  it("shows a per-clean client's month and its visit price", () => {
    const d = clientListDisplay(
      facts({ hasRecurringSchedule: true, monthlyRecurring: 1449.2, payType: "PER_CLEAN", rate: 167.5, scheduleText: "2x Weekly: Tue, Fri" }),
      TODAY,
    )
    expect(d.money).toBe("$1,449")
    expect(d.rateSub).toBe("$167.50/clean")
    expect(d.scheduleLine).toBe("2x Weekly: Tue, Fri")
  })

  it("shows a flat-rate client as flat monthly", () => {
    const d = clientListDisplay(facts({ hasRecurringSchedule: true, monthlyRecurring: 2050, payType: "FLAT_RATE", rate: 2050 }), TODAY)
    expect(d.money).toBe("$2,050")
    expect(d.rateSub).toBe("flat monthly")
  })

  it("greys out a paused client and says what it was worth", () => {
    const d = clientListDisplay(facts({ pausedNow: true, pausedMonthly: 1200, scheduleText: "Weekly: Thu" }), TODAY)
    expect(d.scheduleLine).toBe("Paused · was Weekly: Thu")
    expect(d.money).toBe("–")
    expect(d.moneyMuted).toBe(true)
    expect(d.rateSub).toBe("was $1,200/mo")
  })

  it("names the next visit for an as-needed client", () => {
    const d = clientListDisplay(facts({ hasAnyVisits: true, nextVisit: day(10, 3), visitRate: 250, trailing90: 1200 }), TODAY)
    expect(d.scheduleLine).toBe("As-needed · next Oct 3")
    expect(d.money).toBe("$250")
    expect(d.rateSub).toBe("last 90d $1.2k")
  })

  it("falls back to the last visit when nothing is booked", () => {
    const d = clientListDisplay(facts({ hasAnyVisits: true, lastVisit: day(8, 14), visitRate: 180 }), TODAY)
    expect(d.scheduleLine).toBe("As-needed · last Aug 14")
    expect(d.rateSub).toBe("per visit")
  })

  it("says a brand-new client has not been scheduled yet", () => {
    const d = clientListDisplay(facts(), TODAY)
    expect(d.scheduleLine).toBe("Inactive · not scheduled yet")
    expect(d.moneyMuted).toBe(true)
  })

  it("names the last visit for a lapsed client", () => {
    const d = clientListDisplay(facts({ hasAnyVisits: true, lastVisit: day(3, 3) }), TODAY)
    expect(d.scheduleLine).toBe("Inactive · last Mar 3")
  })

  it("reads visit dates as days, not instants", () => {
    // Stored at noon UTC; formatted in the server's zone they would slide.
    const d = clientListDisplay(facts({ hasAnyVisits: true, nextVisit: "2026-10-01T12:00:00.000Z" }), TODAY)
    expect(d.scheduleLine).toBe("As-needed · next Oct 1")
  })
})

describe("the cleaner groups", () => {
  it("describe client billing, not the cleaner's pay", () => {
    expect(cleanerGroupMeta(17, 23480)).toBe("17 clients · $23.5k/mo billed to clients")
    expect(cleanerGroupMeta(1, 840)).toBe("1 client · $840/mo billed to clients")
  })

  it("sort by what they bill, with Unassigned last", () => {
    const sorted = sortCleanerGroups([
      { name: "Unassigned", total: 99999 },
      { name: "Ana Lina", total: 4000 },
      { name: "Maggie Quevedo", total: 23000 },
    ])
    expect(sorted.map(g => g.name)).toEqual(["Maggie Quevedo", "Ana Lina", "Unassigned"])
  })
})

describe("money and initials", () => {
  it("rounds a month to whole dollars", () => {
    expect(wholeMoney(1449.37)).toBe("$1,449")
  })

  it("keeps a visit's cents only when it has them", () => {
    expect(visitMoney(167.5)).toBe("$167.50")
    expect(visitMoney(165)).toBe("$165")
  })

  it("shortens thousands", () => {
    expect(shortMoney(23480)).toBe("$23.5k")
    expect(shortMoney(5000)).toBe("$5k")
    expect(shortMoney(840)).toBe("$840")
  })

  it("takes two letters from the first two words", () => {
    expect(listInitials("A&B Development")).toBe("AD")
    expect(listInitials("1440 23rd Street Condominiums")).toBe("12")
    expect(listInitials("Visionnaire")).toBe("V")
  })
})
