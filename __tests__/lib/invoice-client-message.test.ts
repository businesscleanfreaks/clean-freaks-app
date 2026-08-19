import { describe, expect, it } from 'vitest'
import { buildClientMessage, firstNameOf, payMethodLabel, paysByZelle, resolvePayMethod } from '@/lib/invoice-client-message'

const base = { firstName: 'Georgia', month: 'June', payMethod: 'ZELLE', zelleEmail: 'admin@thecleanfreaks.co' }

describe('firstNameOf', () => {
  it('takes the first word of the contact name', () => {
    expect(firstNameOf('Georgia Lawrence', 'A&B')).toBe('Georgia')
    expect(firstNameOf('  Jennifer  Haselton ', 'X')).toBe('Jennifer')
  })

  it('falls back to the client name when there is no contact', () => {
    expect(firstNameOf(null, 'A&B Development')).toBe('A&B Development')
    expect(firstNameOf('   ', 'A&B Development')).toBe('A&B Development')
  })
})

describe('paysByZelle', () => {
  it('is true only for Zelle', () => {
    expect(paysByZelle('ZELLE')).toBe(true)
    expect(paysByZelle('ACH')).toBe(false)
    expect(paysByZelle(null)).toBe(false)
    expect(paysByZelle(undefined)).toBe(false)
  })
})

describe('buildClientMessage', () => {
  it('greets by first name and names the month', () => {
    const msg = buildClientMessage(base)
    expect(msg.startsWith('Hi Georgia,')).toBe(true)
    expect(msg).toContain('Your invoice for June cleaning services is attached below.')
    expect(msg.trimEnd().endsWith('The Clean Freaks')).toBe(true)
  })

  it('includes the Zelle paragraph, with the co-not-com warning, for Zelle clients', () => {
    const msg = buildClientMessage(base)
    expect(msg).toContain('Payment can be made via Zelle to admin@thecleanfreaks.co')
    expect(msg).toContain('ends in "co," not "com"')
  })

  it('OMITS the Zelle paragraph for every other pay method', () => {
    for (const payMethod of ['ACH', 'PORTAL', 'CHECK', null]) {
      const msg = buildClientMessage({ ...base, payMethod })
      expect(msg).not.toContain('Zelle')
      // The rest of the message still stands on its own.
      expect(msg).toContain('Your invoice for June cleaning services is attached below.')
      expect(msg).toContain('Thank you for your business!')
    }
  })

  it('uses the configured Zelle address rather than hardcoding one', () => {
    const msg = buildClientMessage({ ...base, zelleEmail: 'pay@example.co' })
    expect(msg).toContain('pay@example.co')
    expect(msg).not.toContain('admin@thecleanfreaks.co')
  })

  it('never uses an em dash in client-facing copy', () => {
    expect(buildClientMessage(base)).not.toMatch(/—/)
  })
})

// The DB carries the same answer in two shapes: the newer `payMethod` enum and
// the older free-text `preferredPaymentMethod`, which is where 16 of the real
// clients' "Zelle" still lives. A strict equality check hid the payment
// instructions from every one of them.
describe("resolvePayMethod", () => {
  it("prefers the newer enum field when both are set", () => {
    expect(resolvePayMethod("ACH", "Zelle")).toBe("ACH")
  })

  it("falls back to the legacy free-text field", () => {
    expect(resolvePayMethod(null, "Zelle")).toBe("Zelle")
    expect(resolvePayMethod(null, "Direct Deposit (Client-Controlled)")).toBe("Direct Deposit (Client-Controlled)")
  })

  it("treats TBD and blanks as unset, not as a method", () => {
    expect(resolvePayMethod(null, "TBD")).toBeNull()
    expect(resolvePayMethod(null, "tbd")).toBeNull()
    expect(resolvePayMethod(null, "   ")).toBeNull()
    expect(resolvePayMethod(null, null)).toBeNull()
  })
})

describe("paysByZelle across both field shapes", () => {
  it("matches however the method was stored", () => {
    for (const stored of ["ZELLE", "Zelle", "zelle"]) {
      expect(paysByZelle(stored)).toBe(true)
    }
  })

  it("does not match other methods", () => {
    for (const stored of ["ACH", "Check", "Direct Deposit (Client-Controlled)", "TBD", null]) {
      expect(paysByZelle(stored)).toBe(false)
    }
  })

  it("includes the Zelle paragraph for a legacy free-text Zelle client", () => {
    const msg = buildClientMessage({
      firstName: "Debbie",
      month: "June",
      payMethod: resolvePayMethod(null, "Zelle"),
      zelleEmail: "admin@thecleanfreaks.co",
    })
    expect(msg).toContain("Zelle to admin@thecleanfreaks.co")
  })
})

describe("payMethodLabel", () => {
  it("reads naturally for enum codes", () => {
    expect(payMethodLabel("ZELLE")).toBe("Zelle")
    expect(payMethodLabel("ACH")).toBe("ACH")
    expect(payMethodLabel("DIRECT_DEPOSIT")).toBe("direct deposit")
  })

  it("passes stored display text through untouched", () => {
    expect(payMethodLabel("Direct Deposit (Client-Controlled)")).toBe("Direct Deposit (Client-Controlled)")
  })
})
