import { describe, it, expect } from "vitest"
import { ordinal } from "@/components/cleaners/pay-schedule-modal"

describe("ordinal", () => {
  it("handles the ones that trip people up", () => {
    expect(ordinal(1)).toBe("1st")
    expect(ordinal(2)).toBe("2nd")
    expect(ordinal(3)).toBe("3rd")
    expect(ordinal(4)).toBe("4th")
  })

  it("uses th for the teens, not st/nd/rd", () => {
    expect(ordinal(11)).toBe("11th")
    expect(ordinal(12)).toBe("12th")
    expect(ordinal(13)).toBe("13th")
  })

  it("goes back to st/nd/rd after the teens", () => {
    expect(ordinal(21)).toBe("21st")
    expect(ordinal(22)).toBe("22nd")
    expect(ordinal(23)).toBe("23rd")
  })

  it("covers the whole pay-by range", () => {
    expect(ordinal(28)).toBe("28th")
    expect(ordinal(20)).toBe("20th")
  })
})
