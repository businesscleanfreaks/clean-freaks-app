import { describe, it, expect } from "vitest"
import { AVATAR_PALETTE, avatarColor, initialsOf } from "@/lib/avatar-palette"

describe("avatarColor", () => {
  it("gives the same person the same colour every time", () => {
    expect(avatarColor("Maggie Quevedo")).toEqual(avatarColor("Maggie Quevedo"))
  })

  it("always returns a colour from the palette", () => {
    for (const name of ["Ana Lina", "Celeste Cleaning Co.", "Ricardo (Jessika team)", ""]) {
      expect(AVATAR_PALETTE).toContainEqual(avatarColor(name))
    }
  })

  it("spreads a real roster across more than one colour", () => {
    const roster = [
      "Maggie Quevedo", "Celeste Cleaning Co.", "Ana Lina", "Ricardo",
      "Ricardo (Jessika team)", "Marcia", "Bubbly Clean",
    ]
    const used = new Set(roster.map(n => avatarColor(n).bg))
    expect(used.size).toBeGreaterThan(2)
  })

  it("does not crash on an empty name", () => {
    expect(avatarColor("").bg).toBeTruthy()
  })
})

describe("initialsOf", () => {
  it("takes the first letter of the first two words", () => {
    expect(initialsOf("Maggie Quevedo")).toBe("MQ")
    expect(initialsOf("Celeste Cleaning Co.")).toBe("CC")
  })

  it("handles a single name", () => {
    expect(initialsOf("Marcia")).toBe("M")
  })

  it("ignores extra whitespace", () => {
    expect(initialsOf("  Ana   Lina  ")).toBe("AL")
  })

  it("returns nothing for an empty name rather than throwing", () => {
    expect(initialsOf("")).toBe("")
  })
})
