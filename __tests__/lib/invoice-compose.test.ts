import { describe, it, expect } from "vitest"
import {
  addRecipient,
  applyWarningFix,
  composeCopy,
  isValidEmail,
  parseEmails,
  preflight,
} from "@/lib/invoice-compose"

describe("composeCopy", () => {
  it("labels a first send and a resend differently", () => {
    expect(composeCopy("send")).toEqual({ heading: "New invoice", sendLabel: "Send invoice" })
    expect(composeCopy("resend")).toEqual({ heading: "Edit & resend", sendLabel: "Resend invoice" })
  })
})

describe("recipients", () => {
  it("splits a pasted run of addresses on commas, semicolons and spaces", () => {
    expect(parseEmails("a@x.com, b@x.com; c@x.com d@x.com")).toEqual([
      "a@x.com", "b@x.com", "c@x.com", "d@x.com",
    ])
  })

  it("strips angle brackets copied out of a mail client", () => {
    expect(parseEmails("<jen@dordicklaw.com>")).toEqual(["jen@dordicklaw.com"])
  })

  it("rejects text that is not an address", () => {
    expect(isValidEmail("jen@dordicklaw.com")).toBe(true)
    expect(isValidEmail("jen@dordicklaw")).toBe(false)
    expect(isValidEmail("Jennifer")).toBe(false)
  })

  it("ignores a duplicate recipient regardless of case", () => {
    const list = addRecipient(["Jen@Dordick.com"], "jen@dordick.com")
    expect(list).toEqual(["Jen@Dordick.com"])
  })
})

const BODY = [
  "Hi Jennifer,",
  "",
  "Your invoice for August cleaning services is attached below.",
  "",
  "Thank you for your business!",
].join("\n")

describe("preflight", () => {
  it("passes an email that matches the invoice", () => {
    expect(preflight({ body: BODY, monthLabel: "August", contactFirstName: "Jennifer" })).toEqual([])
  })

  it("catches a stale month left over from last month's email", () => {
    const body = BODY.replace("August", "July")
    const [w] = preflight({ body, monthLabel: "August", contactFirstName: "Jennifer" })
    expect(w.kind).toBe("month")
    expect(w.from).toBe("July")
    expect(w.to).toBe("August")
    expect(w.text).toContain("this invoice is for August")
  })

  it("checks the subject as well as the body", () => {
    const w = preflight({ body: BODY, subject: "Invoice for July", monthLabel: "August" })
    expect(w.map(x => x.from)).toEqual(["July"])
  })

  it("does not flag lowercase 'may', which is an ordinary word", () => {
    const body = "You may pay by Zelle at any time."
    expect(preflight({ body, monthLabel: "August" })).toEqual([])
  })

  it("does not flag a month that appears inside another word", () => {
    expect(preflight({ body: "See the Julyish draft", monthLabel: "August" })).toEqual([])
  })

  it("catches another client's contact name left behind by copy-paste", () => {
    const body = BODY.replace("Jennifer", "Nazaneen")
    const [w] = preflight({
      body,
      monthLabel: "August",
      contactFirstName: "Jennifer",
      otherFirstNames: ["Nazaneen", "Marcia"],
    })
    expect(w.kind).toBe("name")
    expect(w.from).toBe("Nazaneen")
    expect(w.text).toContain("did you mean Jennifer")
  })

  it("never flags this client's own contact name", () => {
    const w = preflight({
      body: BODY,
      monthLabel: "August",
      contactFirstName: "Jennifer",
      otherFirstNames: ["Jennifer"],
    })
    expect(w).toEqual([])
  })

  it("skips very short names, which collide with ordinary words", () => {
    const w = preflight({ body: "Al of the cleans are done", monthLabel: "August", otherFirstNames: ["Al"] })
    expect(w).toEqual([])
  })

  it("stays quiet about anything the reviewer already dismissed", () => {
    const body = BODY.replace("August", "July").replace("Jennifer", "Nazaneen")
    const input = {
      body,
      monthLabel: "August",
      contactFirstName: "Jennifer",
      otherFirstNames: ["Nazaneen"],
    }
    expect(preflight(input)).toHaveLength(2)
    expect(preflight({ ...input, acknowledged: ["July", "Nazaneen"] })).toEqual([])
  })

  it("reports each stale month once, not once per mention", () => {
    const body = "July cleaning. Due in July. Thanks for July."
    expect(preflight({ body, monthLabel: "August" })).toHaveLength(1)
  })
})

describe("applyWarningFix", () => {
  it("replaces every mention of the stale month in the subject and body", () => {
    const email = { subject: "Invoice for July", body: "July cleaning services. Paid in July." }
    const [w] = preflight({ ...email, monthLabel: "August" })
    expect(applyWarningFix(w, email)).toEqual({
      subject: "Invoice for August",
      body: "August cleaning services. Paid in August.",
    })
  })

  it("leaves the email untouched for a name warning · only the reviewer knows what was meant", () => {
    const email = { subject: "Invoice", body: "Hi Nazaneen," }
    const [w] = preflight({ ...email, monthLabel: "August", otherFirstNames: ["Nazaneen"] })
    expect(applyWarningFix(w, email)).toEqual(email)
  })

  it("does not corrupt a word that merely contains the month", () => {
    const email = { subject: "", body: "July and Julys" }
    const [w] = preflight({ ...email, monthLabel: "August" })
    expect(applyWarningFix(w, email).body).toBe("August and Julys")
  })
})
