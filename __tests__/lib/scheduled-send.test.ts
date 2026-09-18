import { describe, it, expect } from "vitest"
import {
  decideScheduledSend,
  isSendableStatus,
  staysQueued,
  SENDABLE_STATUSES,
  type ScheduledSendInput,
} from "@/lib/scheduled-send"

const due = (over: Partial<ScheduledSendInput> = {}): ScheduledSendInput => ({
  status: "DRAFT",
  hasPayload: true,
  realSendingOn: true,
  hasCredentials: true,
  scheduleMatches: true,
  ...over,
})

describe("which invoices a scheduled send may act on", () => {
  it("sends a draft whose time has come", () => {
    expect(decideScheduledSend(due()).action).toBe("send")
  })

  it("sends an overdue invoice", () => {
    expect(decideScheduledSend(due({ status: "OVERDUE" })).action).toBe("send")
  })

  it("never sends a voided invoice", () => {
    // The reported defect: the query was `notIn: ['SENT','PAID']`, and VOID is
    // neither · so an invoice that had been deliberately voided would still be
    // emailed to the client if a send had been scheduled before it was voided.
    const decision = decideScheduledSend(due({ status: "VOID" }))
    expect(decision.action).toBe("discard")
    expect(decision.reason).toContain("VOID")
  })

  it("never sends one that has already gone", () => {
    expect(decideScheduledSend(due({ status: "SENT" })).action).toBe("discard")
  })

  it("never sends one that is already paid", () => {
    expect(decideScheduledSend(due({ status: "PAID" })).action).toBe("discard")
  })

  it("treats an unknown status as not sendable", () => {
    // A status this module has not been told about is not a licence to email.
    expect(decideScheduledSend(due({ status: "SOMETHING_NEW" })).action).toBe("discard")
    expect(decideScheduledSend(due({ status: null })).action).toBe("discard")
  })

  it("names the sendable statuses in one place", () => {
    expect([...SENDABLE_STATUSES]).toEqual(["DRAFT", "OVERDUE"])
    expect(isSendableStatus("DRAFT")).toBe(true)
    expect(isSendableStatus("VOID")).toBe(false)
  })
})

describe("when sending is switched off", () => {
  it("holds rather than dropping the schedule", () => {
    // It has to go out once sending is switched back on. Discarding here would
    // silently cancel a send nobody cancelled.
    const decision = decideScheduledSend(due({ realSendingOn: false }))
    expect(decision.action).toBe("hold")
    expect(staysQueued(decision)).toBe(true)
  })

  it("holds when there are no credentials", () => {
    expect(decideScheduledSend(due({ hasCredentials: false })).action).toBe("hold")
  })

  it("still refuses a voided invoice, switched off or not", () => {
    // Order matters: a voided invoice must not sit in the queue waiting for
    // sending to be re-enabled so it can then go out.
    expect(decideScheduledSend(due({ status: "VOID", realSendingOn: false })).action)
      .toBe("discard")
  })
})

describe("when the work no longer matches the invoice", () => {
  it("holds instead of sending blind", () => {
    // A person is asked about this before a manual send. The clock ran no check
    // at all, so a scheduled invoice could go out billing for a clean that had
    // since been cancelled.
    const decision = decideScheduledSend(due({ scheduleMatches: false }))
    expect(decision.action).toBe("hold")
    expect(decision.reason).toBe("schedule-mismatch")
  })

  it("does not discard it · a person still needs to decide", () => {
    expect(decideScheduledSend(due({ scheduleMatches: false })).action).not.toBe("discard")
  })
})

describe("a schedule with nothing to send", () => {
  it("is dropped rather than retried forever", () => {
    const decision = decideScheduledSend(due({ hasPayload: false }))
    expect(decision.action).toBe("discard")
    expect(decision.reason).toBe("no-payload")
  })

  it("is dropped before anything else is considered", () => {
    expect(decideScheduledSend(due({ hasPayload: false, realSendingOn: false })).action)
      .toBe("discard")
  })
})

describe("the bias of the whole thing", () => {
  it("never sends when any single condition is unmet", () => {
    const conditions: Array<Partial<ScheduledSendInput>> = [
      { hasPayload: false },
      { status: "VOID" },
      { realSendingOn: false },
      { hasCredentials: false },
      { scheduleMatches: false },
    ]
    for (const condition of conditions) {
      expect(decideScheduledSend(due(condition)).action).not.toBe("send")
    }
  })
})
