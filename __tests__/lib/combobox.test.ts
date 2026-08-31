import { describe, it, expect } from "vitest"
import {
  CONTACT_ROLES,
  filterByPrefix,
  PAY_METHOD_OPTIONS,
  SERVICE_TYPES,
  shouldShowOptions,
} from "@/lib/combobox"

describe("filterByPrefix", () => {
  it("offers everything before you type", () => {
    expect(filterByPrefix(PAY_METHOD_OPTIONS, "")).toEqual(PAY_METHOD_OPTIONS)
  })

  it("matches on the start, not anywhere in the word", () => {
    expect(filterByPrefix(PAY_METHOD_OPTIONS, "Ch")).toEqual(["Check"])
    // "Carpet cleaning" contains "clean" but does not start with it... it does.
    expect(filterByPrefix(SERVICE_TYPES, "Window")).toEqual(["Window washing"])
  })

  it("does not match a substring in the middle", () => {
    // "washing" appears inside two options but starts neither.
    expect(filterByPrefix(SERVICE_TYPES, "washing")).toEqual([])
  })

  it("ignores case and surrounding spaces", () => {
    expect(filterByPrefix(CONTACT_ROLES, "  owner ")).toEqual(["Owner"])
  })

  it("returns nothing for a value that is not in the list", () => {
    expect(filterByPrefix(CONTACT_ROLES, "Janitor")).toEqual([])
  })

  it("can match several", () => {
    expect(filterByPrefix(["Sam", "Sammy", "Sara"], "Sam")).toEqual(["Sam", "Sammy"])
  })
})

describe("shouldShowOptions", () => {
  it("shows the list while something still matches", () => {
    expect(shouldShowOptions(PAY_METHOD_OPTIONS, "Z")).toBe(true)
  })

  it("closes once nothing matches · the typed text stands as custom", () => {
    expect(shouldShowOptions(PAY_METHOD_OPTIONS, "Venmo")).toBe(false)
  })

  it("shows everything on an empty query", () => {
    expect(shouldShowOptions(CONTACT_ROLES, "")).toBe(true)
  })
})
