import { describe, it, expect } from "vitest"
import {
  DEFAULT_FOOTER_TEMPLATES,
  DEFAULT_ONE_TIME_JOB_DEFAULTS,
  normalizeFooterTemplates,
  normalizeOneTimeJobDefaults,
  normalizeReminderTemplates,
  resolveInvoiceFooter,
  REMINDER_SLOTS,
} from "@/lib/billing-sections"

const REM_DEFAULTS = { s1: "first nudge", s2: "second nudge" }

describe("normalizeOneTimeJobDefaults", () => {
  it("returns the defaults for an empty or missing setting", () => {
    expect(normalizeOneTimeJobDefaults(null)).toEqual(DEFAULT_ONE_TIME_JOB_DEFAULTS)
    expect(normalizeOneTimeJobDefaults({})).toEqual(DEFAULT_ONE_TIME_JOB_DEFAULTS)
  })

  it("keeps valid saved values", () => {
    const saved = { residential: { when: "MANUAL", termDays: 30 } }
    expect(normalizeOneTimeJobDefaults(saved).residential).toEqual({ when: "MANUAL", termDays: 30 })
  })

  it("falls back per field when a stored value is not one we offer", () => {
    const junk = { commercial: { when: "WHENEVER", termDays: 999 } }
    expect(normalizeOneTimeJobDefaults(junk).commercial).toEqual(DEFAULT_ONE_TIME_JOB_DEFAULTS.commercial)
  })

  it("survives a hand-edited column holding the wrong type entirely", () => {
    expect(normalizeOneTimeJobDefaults("nonsense")).toEqual(DEFAULT_ONE_TIME_JOB_DEFAULTS)
    expect(normalizeOneTimeJobDefaults({ residential: 5 })).toEqual(DEFAULT_ONE_TIME_JOB_DEFAULTS)
  })

  it("always returns every kind, so the form never renders a hole", () => {
    expect(Object.keys(normalizeOneTimeJobDefaults({}))).toEqual([
      "residential", "commercial", "postConstruction",
    ])
  })
})

describe("normalizeFooterTemplates", () => {
  it("defaults every method that is not saved", () => {
    expect(normalizeFooterTemplates(null)).toEqual(DEFAULT_FOOTER_TEMPLATES)
  })

  it("keeps a saved footer, including a deliberately empty one", () => {
    const out = normalizeFooterTemplates({ ZELLE: "Pay me", PORTAL: "" })
    expect(out.ZELLE).toBe("Pay me")
    expect(out.PORTAL).toBe("")
    expect(out.CHECK).toBe(DEFAULT_FOOTER_TEMPLATES.CHECK)
  })
})

describe("resolveInvoiceFooter", () => {
  const templates = normalizeFooterTemplates({ ZELLE: "Zelle text", PORTAL: "" })

  it("prints the footer for how this client actually pays", () => {
    expect(resolveInvoiceFooter(templates, "ZELLE", "generic")).toBe("Zelle text")
  })

  it("matches the method case-insensitively · the two fields disagree on case", () => {
    expect(resolveInvoiceFooter(templates, "zelle", "generic")).toBe("Zelle text")
  })

  it("falls back to the generic note when the client has no method on file", () => {
    expect(resolveInvoiceFooter(templates, null, "generic")).toBe("generic")
    expect(resolveInvoiceFooter(templates, "", "generic")).toBe("generic")
  })

  it("never prints another method's payment instructions for an unknown method", () => {
    expect(resolveInvoiceFooter(templates, "CRYPTO", "generic")).toBe("generic")
  })

  it("falls back when the chosen method's footer is blank", () => {
    expect(resolveInvoiceFooter(templates, "PORTAL", "generic")).toBe("generic")
  })

  it("returns null when there is no footer and no fallback", () => {
    expect(resolveInvoiceFooter(templates, "PORTAL", null)).toBeNull()
  })
})

describe("normalizeReminderTemplates", () => {
  it("offers exactly two editable emails · 14+ days is a phone call, not an email", () => {
    expect(REMINDER_SLOTS.map(s => s.key)).toEqual(["s1", "s2"])
  })

  it("falls back to the shipped copy when nothing is saved", () => {
    expect(normalizeReminderTemplates(null, REM_DEFAULTS)).toEqual(REM_DEFAULTS)
  })

  it("keeps saved text", () => {
    expect(normalizeReminderTemplates({ s1: "mine" }, REM_DEFAULTS)).toEqual({ s1: "mine", s2: "second nudge" })
  })

  it("treats a blank template as unset · an empty reminder would send nothing", () => {
    expect(normalizeReminderTemplates({ s1: "   " }, REM_DEFAULTS).s1).toBe(REM_DEFAULTS.s1)
  })

  it("ignores a stored s3 · the call script is not editable here", () => {
    const out = normalizeReminderTemplates({ s3: "sneaky" }, REM_DEFAULTS) as Record<string, string>
    expect(out.s3).toBeUndefined()
  })
})
