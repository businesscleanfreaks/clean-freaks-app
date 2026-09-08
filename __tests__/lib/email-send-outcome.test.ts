import { describe, it, expect } from "vitest"
import {
  classifySendResult,
  heldReason,
  isPlaceholderMessageId,
  marksInvoiceSent,
  realSendingEnabled,
  threadableMessageId,
} from "@/lib/email-send-outcome"

describe("classifySendResult", () => {
  it("counts a real provider id as delivered", () => {
    expect(classifySendResult({ success: true, messageId: "<CAF=abc123@mail.gmail.com>" })).toBe("DELIVERED")
  })

  it("counts a failure as failed", () => {
    expect(classifySendResult({ success: false, error: "SMTP timeout" })).toBe("FAILED")
  })

  it("counts sending-disabled as held even though it reports success", () => {
    // The exact shape `sendEmail()` returns when Settings has sending paused.
    // The route saw `success: true` and stamped the invoice SENT.
    expect(classifySendResult({
      success: true,
      messageId: "safety-test-mode-1757000000000",
      warning: "SENDING_DISABLED",
    })).toBe("HELD")
  })

  it("catches every placeholder id, warning or not", () => {
    // Three code paths produce these and the route stripped only one of them.
    for (const id of ["safety-test-mode-1", "test-mode-disabled-1", "simulated-1", "test-1"]) {
      expect(classifySendResult({ success: true, messageId: id })).toBe("HELD")
    }
  })

  it("does not mistake a real id that merely contains the word test", () => {
    expect(classifySendResult({ success: true, messageId: "<latest-run@mail.gmail.com>" })).toBe("DELIVERED")
  })
})

describe("marksInvoiceSent", () => {
  it("stamps SENT only on a real delivery", () => {
    expect(marksInvoiceSent("DELIVERED")).toBe(true)
    expect(marksInvoiceSent("HELD")).toBe(false)
    expect(marksInvoiceSent("FAILED")).toBe(false)
  })

  it("leaves a held invoice as a draft", () => {
    // The whole point: a paused send must not remove the invoice from the queue.
    const outcome = classifySendResult({ success: true, warning: "SENDING_DISABLED" })
    expect(marksInvoiceSent(outcome)).toBe(false)
  })
})

describe("threadableMessageId", () => {
  it("keeps a real id so a reminder threads onto it", () => {
    expect(threadableMessageId("<CAF=abc@mail.gmail.com>")).toBe("<CAF=abc@mail.gmail.com>")
  })

  it("drops every placeholder", () => {
    for (const id of ["safety-test-mode-1", "test-mode-disabled-1", "simulated-1"]) {
      expect(threadableMessageId(id)).toBeNull()
    }
  })

  it("drops nothing-at-all safely", () => {
    expect(threadableMessageId(null)).toBeNull()
    expect(threadableMessageId("   ")).toBeNull()
  })
})

describe("isPlaceholderMessageId", () => {
  it("is false for an empty id rather than true", () => {
    // An absent id is not evidence that a send was held.
    expect(isPlaceholderMessageId("")).toBe(false)
    expect(isPlaceholderMessageId(undefined)).toBe(false)
  })
})

describe("realSendingEnabled", () => {
  it("needs both switches on", () => {
    expect(realSendingEnabled({ allowRealClientEmails: true, enableSending: true })).toBe(true)
    expect(realSendingEnabled({ allowRealClientEmails: true, enableSending: false })).toBe(false)
    expect(realSendingEnabled({ allowRealClientEmails: false, enableSending: true })).toBe(false)
    expect(realSendingEnabled({})).toBe(false)
  })
})

describe("heldReason", () => {
  it("names the switch that is off", () => {
    expect(heldReason({ allowRealClientEmails: true, enableSending: false })).toContain("paused")
    expect(heldReason({ allowRealClientEmails: false, enableSending: true })).toContain("switched off")
  })

  it("still says something useful when both are on", () => {
    expect(heldReason({ allowRealClientEmails: true, enableSending: true })).toContain("still a draft")
  })
})
