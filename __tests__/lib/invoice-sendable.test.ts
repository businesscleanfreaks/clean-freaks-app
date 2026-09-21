import { describe, it, expect } from "vitest"
import {
  invoiceSendRefusal,
  isSendableStatus,
  SENDABLE_STATUSES,
} from "@/lib/invoice-sendable"

describe("which invoices may be emailed", () => {
  it("sends a draft", () => {
    expect(invoiceSendRefusal({ status: "DRAFT" })).toBeNull()
  })

  it("sends an overdue invoice", () => {
    expect(invoiceSendRefusal({ status: "OVERDUE" })).toBeNull()
  })

  it("names the sendable statuses in one place", () => {
    expect([...SENDABLE_STATUSES]).toEqual(["DRAFT", "OVERDUE"])
    expect(isSendableStatus("DRAFT")).toBe(true)
    expect(isSendableStatus("VOID")).toBe(false)
  })
})

describe("a void invoice", () => {
  it("is refused", () => {
    // The reported defect: the workspace creates a VOID preview, finalizes it
    // to DRAFT, then sends · and the finalize response was never checked. A
    // failed finalize emailed a void invoice and stamped it SENT, while its
    // cleans stayed billable and were invoiced all over again.
    const refusal = invoiceSendRefusal({ status: "VOID" })
    expect(refusal?.code).toBe("INVOICE_VOID")
  })

  it("cannot be forced through with a confirmation", () => {
    // Void is a decision someone made, not a state to push past. SENT and PAID
    // are different · see below.
    const refusal = invoiceSendRefusal({ status: "VOID", confirmResend: true })
    expect(refusal?.code).toBe("INVOICE_VOID")
    expect(refusal?.confirmable).toBe(false)
  })

  it("says what to do instead", () => {
    expect(invoiceSendRefusal({ status: "VOID" })?.message).toContain("review workspace")
  })
})

describe("an invoice that has already gone", () => {
  it("is refused by default", () => {
    const refusal = invoiceSendRefusal({ status: "SENT" })
    expect(refusal?.code).toBe("INVOICE_ALREADY_SENT")
  })

  it("goes again when the sender means it", () => {
    // Resending is a real thing to want · a client who lost the email. So it
    // is allowed on purpose rather than forbidden.
    expect(invoiceSendRefusal({ status: "SENT", confirmResend: true })).toBeNull()
  })

  it("treats a paid invoice the same way", () => {
    expect(invoiceSendRefusal({ status: "PAID" })?.confirmable).toBe(true)
    expect(invoiceSendRefusal({ status: "PAID", confirmResend: true })).toBeNull()
  })

  it("says it is paid, not merely sent", () => {
    expect(invoiceSendRefusal({ status: "PAID" })?.message).toContain("paid")
  })
})

describe("anything else", () => {
  it("is refused rather than assumed sendable", () => {
    expect(invoiceSendRefusal({ status: "SOMETHING_NEW" })?.code).toBe("INVOICE_NOT_SENDABLE")
    expect(invoiceSendRefusal({ status: null })?.code).toBe("INVOICE_NOT_SENDABLE")
  })

  it("is not confirmable, because nobody knows what it means", () => {
    expect(invoiceSendRefusal({ status: "SOMETHING_NEW", confirmResend: true })?.confirmable).toBe(false)
  })
})
