import { describe, expect, it } from "vitest"
import { JOB_CARD_TEXT, JOB_GRADIENTS, getCleanerColorInfo } from "@/lib/calendar-design-tokens"

const key = (name: string | null) => getCleanerColorInfo(name).colorKey

describe("calendar card colours, as the design assigns them", () => {
  it("gives each cleaner the design's hue", () => {
    expect(key("Maggie Quevedo")).toBe("amber")          // hue 30, coral
    expect(key("Ana Lina")).toBe("orange")               // hue 75, amber
    expect(key("Celeste Cleaning Co.")).toBe("emerald")  // hue 155
    expect(key("Ricardo (MCS Cleaning)")).toBe("teal")   // hue 200
    expect(key("Marcia")).toBe("indigo")                 // hue 255
    expect(key("Ricardo (Jessika Team)")).toBe("rose")   // hue 345, not the plain Ricardo's teal
  })

  it("never gives two active cleaners the same colour", () => {
    const live = ["Ana Lina", "Celeste Cleaning Co.", "Juan", "Maggie Quevedo", "Marcia", "Ricardo (MCS Cleaning)"]
    const colours = live.map(key)
    expect(new Set(colours).size).toBe(live.length)
  })

  it("uses the design's fills, with white text on every one", () => {
    expect(JOB_GRADIENTS.orange).toBe("#ecad4b")
    expect(JOB_GRADIENTS.amber).toBe("#e47261")
    expect(JOB_CARD_TEXT.client).toBe("#ffffff")
  })

  it("keeps unassigned work grey", () => {
    expect(key(null)).toBe("slate")
  })
})
