import { describe, it, expect } from "vitest"
import {
  clampDay,
  DEFAULT_PAY_BY_DAY,
  hasInvoiceFor,
  isUnlocked,
  jobPayState,
  tallyAccountInvoices,
  tallyCleanerInvoices,
  dueLabel,
  zelleMemo,
  type CleanerAccount,
} from "@/lib/cleaner-payables"

const acct = (over: Partial<CleanerAccount> = {}): CleanerAccount => ({
  id: "L1",
  clientName: "Hillhurst",
  invoiceUnit: "PER_ACCOUNT",
  jobIds: ["j1", "j2", "j3"],
  invoicedJobIds: [],
  clientHasPaid: false,
  holdsUntilPayByDay: true,
  ...over,
})

describe("tallyAccountInvoices", () => {
  it("a commercial account owes one invoice however many cleans it had", () => {
    expect(tallyAccountInvoices(acct())).toEqual({ expected: 1, received: 0, complete: false })
  })

  it("marking a per-account account covers all its cleans at once", () => {
    const t = tallyAccountInvoices(acct({ invoicedJobIds: ["j1"] }))
    expect(t).toEqual({ expected: 1, received: 1, complete: true })
  })

  it("a residential account owes one invoice per clean", () => {
    const a = acct({ invoiceUnit: "PER_CLEAN", invoicedJobIds: ["j1", "j3"] })
    expect(tallyAccountInvoices(a)).toEqual({ expected: 3, received: 2, complete: false })
  })

  it("is complete once every clean is invoiced", () => {
    const a = acct({ invoiceUnit: "PER_CLEAN", invoicedJobIds: ["j1", "j2", "j3"] })
    expect(tallyAccountInvoices(a).complete).toBe(true)
  })

  it("an account with no unpaid work expects nothing and reads complete", () => {
    expect(tallyAccountInvoices(acct({ jobIds: [] }))).toEqual({ expected: 0, received: 0, complete: true })
  })

  it("ignores a receipt for a clean that is not on the account", () => {
    const a = acct({ invoiceUnit: "PER_CLEAN", invoicedJobIds: ["someone-elses-job"] })
    expect(tallyAccountInvoices(a).received).toBe(0)
  })
})

describe("tallyCleanerInvoices", () => {
  it("counts one per commercial account · Celeste's 7 accounts are 7 invoices", () => {
    const accounts = Array.from({ length: 7 }, (_, i) => acct({ id: `L${i}` }))
    expect(tallyCleanerInvoices(accounts, true)).toMatchObject({ expected: 7, received: 0 })
  })

  it("mixes per-account and per-clean accounts in one total", () => {
    const accounts = [
      acct({ id: "commercial", invoicedJobIds: ["j1"] }),
      acct({ id: "residential", invoiceUnit: "PER_CLEAN", jobIds: ["a", "b"], invoicedJobIds: ["a"] }),
    ]
    // 1 expected + 2 expected = 3; 1 received + 1 received = 2
    expect(tallyCleanerInvoices(accounts, true)).toMatchObject({ expected: 3, received: 2, complete: false })
  })

  it("marks a team that does not invoice as not applicable, never as missing", () => {
    const t = tallyCleanerInvoices([acct()], false)
    expect(t.notApplicable).toBe(true)
    expect(t.complete).toBe(true)
    expect(t.expected).toBe(0)
  })
})

describe("isUnlocked", () => {
  const period = "2026-07"

  it("never holds weekly or within-5-days work", () => {
    const a = acct({ holdsUntilPayByDay: false })
    expect(isUnlocked(a, 3, period, new Date("2026-07-04T12:00:00"))).toBe(true)
  })

  it("unlocks end-of-month work as soon as the client pays", () => {
    const a = acct({ clientHasPaid: true })
    expect(isUnlocked(a, 3, period, new Date("2026-07-15T12:00:00"))).toBe(true)
  })

  it("holds until the pay-by day in the month AFTER the work", () => {
    const a = acct()
    expect(isUnlocked(a, 3, period, new Date("2026-08-02T12:00:00"))).toBe(false)
    expect(isUnlocked(a, 3, period, new Date("2026-08-03T00:00:00"))).toBe(true)
  })

  it("pays on the day whether or not the client has paid · 'no matter what'", () => {
    const a = acct({ clientHasPaid: false })
    expect(isUnlocked(a, 3, period, new Date("2026-08-03T09:00:00"))).toBe(true)
  })

  it("respects a cleaner's own later day", () => {
    const a = acct()
    expect(isUnlocked(a, 7, period, new Date("2026-08-05T12:00:00"))).toBe(false)
    expect(isUnlocked(a, 7, period, new Date("2026-08-07T12:00:00"))).toBe(true)
  })

  it("rolls a December period into the next January", () => {
    const a = acct()
    expect(isUnlocked(a, 3, "2026-12", new Date("2027-01-02T12:00:00"))).toBe(false)
    expect(isUnlocked(a, 3, "2026-12", new Date("2027-01-03T12:00:00"))).toBe(true)
  })
})

describe("clampDay", () => {
  it("keeps a day that works in February", () => {
    expect(clampDay(31)).toBe(28)
    expect(clampDay(0)).toBe(1)
    expect(clampDay(-5)).toBe(1)
  })

  it("passes an ordinary day through", () => {
    expect(clampDay(7)).toBe(7)
  })

  it("falls back to the default for nonsense", () => {
    expect(clampDay(NaN)).toBe(DEFAULT_PAY_BY_DAY)
  })
})

describe("hasInvoiceFor", () => {
  it("covers every clean on a per-account account from one receipt", () => {
    const a = acct({ invoicedJobIds: ["j1"] })
    expect(hasInvoiceFor("j2", a)).toBe(true)
  })

  it("checks each clean separately on a per-clean account", () => {
    const a = acct({ invoiceUnit: "PER_CLEAN", invoicedJobIds: ["j1"] })
    expect(hasInvoiceFor("j1", a)).toBe(true)
    expect(hasInvoiceFor("j2", a)).toBe(false)
  })
})

describe("jobPayState", () => {
  const base = { jobId: "j1", paid: false, invoicesUs: true, payByDay: 3, period: "2026-07" }

  it("is paid once it is paid, whatever else is outstanding", () => {
    expect(jobPayState({ ...base, paid: true, account: acct(), now: new Date("2026-07-05") }))
      .toBe("paid")
  })

  it("needs the invoice before anything else", () => {
    expect(jobPayState({ ...base, account: acct({ clientHasPaid: true }), now: new Date("2026-08-05") }))
      .toBe("needs-invoice")
  })

  it("is locked while the invoice is in but the day has not come", () => {
    const a = acct({ invoicedJobIds: ["j1"] })
    expect(jobPayState({ ...base, account: a, now: new Date("2026-08-01") })).toBe("locked")
  })

  it("is ready once the invoice is in and it is unlocked", () => {
    const a = acct({ invoicedJobIds: ["j1"] })
    expect(jobPayState({ ...base, account: a, now: new Date("2026-08-03") })).toBe("ready")
  })

  it("never waits on an invoice from a team that does not send them", () => {
    const a = acct({ holdsUntilPayByDay: false })
    expect(jobPayState({ ...base, invoicesUs: false, account: a, now: new Date("2026-07-04") }))
      .toBe("ready")
  })

  it("still respects the lock for a team that does not invoice", () => {
    const a = acct()
    expect(jobPayState({ ...base, invoicesUs: false, account: a, now: new Date("2026-08-01") }))
      .toBe("locked")
  })
})

describe("dueLabel", () => {
  const period = "2026-07"

  it("shows the date while it is still ahead", () => {
    const d = dueLabel(period, 3, new Date("2026-08-01T09:00:00"))
    expect(d.label).toBe("Aug 3")
    expect(d.weight).toBe(600)
  })

  it("says due today on the day, in orange", () => {
    const d = dueLabel(period, 3, new Date("2026-08-03T09:00:00"))
    expect(d.label).toBe("due today")
    expect(d.color).toBe("#c2410c")
    expect(d.weight).toBe(800)
  })

  it("says overdue once it has slipped, in red", () => {
    const d = dueLabel(period, 3, new Date("2026-08-04T09:00:00"))
    expect(d.label).toBe("overdue")
    expect(d.color).toBe("#d92d20")
    expect(d.weight).toBe(800)
  })

  it("ignores the time of day · 11pm on the due date is still due today", () => {
    expect(dueLabel(period, 3, new Date("2026-08-03T23:59:00")).label).toBe("due today")
  })

  it("rolls a December period into January", () => {
    expect(dueLabel("2026-12", 5, new Date("2027-01-02T09:00:00")).label).toBe("Jan 5")
  })
})

describe("zelleMemo", () => {
  it("names the client and the month being paid for", () => {
    expect(zelleMemo("Hillhurst Building", "2026-07"))
      .toBe("The Clean Freaks Pay - Hillhurst Building - July")
  })

  it("uses the work's month, not today's", () => {
    expect(zelleMemo("Acme", "2026-01")).toContain("January")
  })
})
