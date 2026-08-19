import { describe, it, expect } from "vitest"
import {
  greetedFirstName,
  moveRecipient,
  orderRecipients,
  renumber,
  tagFor,
  validateRecipients,
} from "@/lib/billing-recipients"

const r = (id: string, name: string, email: string | null, order: number | null) =>
  ({ id, name, email, billingRole: null, billingOrder: order })

describe("orderRecipients", () => {
  it("uses the stored order, which decides who gets greeted", () => {
    const list = [r("b", "Bob", "b@x.com", 1), r("a", "Ann", "a@x.com", 0)]
    expect(orderRecipients(list).map(x => x.id)).toEqual(["a", "b"])
  })

  it("puts recipients with no order behind, so a new one never steals the greeting", () => {
    const list = [r("new", "Aaron", "n@x.com", null), r("first", "Zoe", "z@x.com", 0)]
    expect(orderRecipients(list).map(x => x.id)).toEqual(["first", "new"])
  })

  it("breaks ties by name so the order is stable between renders", () => {
    const list = [r("b", "Bob", "b@x.com", null), r("a", "Ann", "a@x.com", null)]
    expect(orderRecipients(list).map(x => x.id)).toEqual(["a", "b"])
  })

  it("does not mutate the array it was given", () => {
    const list = [r("b", "Bob", "b@x.com", 1), r("a", "Ann", "a@x.com", 0)]
    orderRecipients(list)
    expect(list.map(x => x.id)).toEqual(["b", "a"])
  })
})

describe("tagFor / greetedFirstName", () => {
  it("addresses the first and copies the rest", () => {
    expect(tagFor(0)).toBe("TO")
    expect(tagFor(1)).toBe("CC")
    expect(tagFor(5)).toBe("CC")
  })

  it("greets the first recipient by first name", () => {
    const list = [r("b", "Bob Smith", "b@x.com", 1), r("a", "Ann Lee", "a@x.com", 0)]
    expect(greetedFirstName(list)).toBe("Ann")
  })

  it("returns null when there is nobody to greet", () => {
    expect(greetedFirstName([])).toBeNull()
    expect(greetedFirstName([r("a", "   ", "a@x.com", 0)])).toBeNull()
  })
})

describe("validateRecipients", () => {
  it("accepts a good list", () => {
    expect(validateRecipients([r("a", "Ann", "a@x.com", 0)])).toEqual([])
  })

  it("refuses an empty list · every client needs somewhere to send the invoice", () => {
    expect(validateRecipients([])).toEqual([
      { code: "NO_RECIPIENTS", message: "Every client needs at least one invoice recipient." },
    ])
  })

  it("names the person who has no email", () => {
    const [p] = validateRecipients([r("a", "Ann Lee", "", 0)])
    expect(p.code).toBe("MISSING_EMAIL")
    expect(p.message).toBe("Ann Lee has no email address.")
  })

  it("catches a malformed address", () => {
    expect(validateRecipients([r("a", "Ann", "ann@nowhere", 0)])[0].code).toBe("INVALID_EMAIL")
  })

  it("catches the same address listed twice, ignoring case", () => {
    const problems = validateRecipients([r("a", "Ann", "a@x.com", 0), r("b", "Bob", "A@X.com", 1)])
    expect(problems.map(p => p.code)).toEqual(["DUPLICATE_EMAIL"])
  })

  it("reports every problem at once, not just the first", () => {
    const problems = validateRecipients([r("a", "Ann", "", 0), r("b", "Bob", "nope", 1)])
    expect(problems.map(p => p.code)).toEqual(["MISSING_EMAIL", "INVALID_EMAIL"])
  })
})

describe("renumber / moveRecipient", () => {
  it("renumbers into a gapless order", () => {
    const list = [r("a", "Ann", "a@x.com", 5), r("b", "Bob", "b@x.com", 9)]
    expect(renumber(list).map(x => x.billingOrder)).toEqual([0, 1])
  })

  it("promotes a recipient, changing who is greeted", () => {
    const list = [r("a", "Ann", "a@x.com", 0), r("b", "Bob", "b@x.com", 1)]
    const moved = moveRecipient(list, "b", -1)
    expect(moved.map(x => x.id)).toEqual(["b", "a"])
    expect(greetedFirstName(moved)).toBe("Bob")
    expect(moved.map(x => x.billingOrder)).toEqual([0, 1])
  })

  it("does nothing at the ends of the list", () => {
    const list = [r("a", "Ann", "a@x.com", 0), r("b", "Bob", "b@x.com", 1)]
    expect(moveRecipient(list, "a", -1).map(x => x.id)).toEqual(["a", "b"])
    expect(moveRecipient(list, "b", 1).map(x => x.id)).toEqual(["a", "b"])
  })

  it("ignores an id that is not in the list", () => {
    const list = [r("a", "Ann", "a@x.com", 0)]
    expect(moveRecipient(list, "ghost", 1).map(x => x.id)).toEqual(["a"])
  })
})
