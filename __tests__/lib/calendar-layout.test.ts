import { describe, expect, it } from "vitest"
import { buildTimelineLayout } from "@/components/calendar/calendar-view"
import type { JobWithFullRelations } from "@/types"

function job(id: string, start: string, end: string): JobWithFullRelations {
  return {
    id,
    startTime: null,
    startWindowBegin: start,
    startWindowEnd: end,
  } as JobWithFullRelations
}

describe("calendar collision layout", () => {
  it("shows two cards and a more chip when more than three lanes collide", () => {
    const layout = buildTimelineLayout(
      Array.from({ length: 8 }, (_, index) => job(`job-${index}`, "09:00", "11:00"))
    )

    expect(layout.positions).toHaveLength(2)
    expect(layout.positions.map(item => item.column)).toEqual([0, 1])
    expect(layout.overflow).toHaveLength(1)
    expect(layout.overflow[0].jobs).toHaveLength(6)
    expect(layout.overflow[0].column).toBe(2)
  })

  it("shows all cards when a collision fits in three lanes", () => {
    const layout = buildTimelineLayout([
      job("a", "09:00", "11:00"),
      job("b", "09:00", "11:00"),
      job("c", "09:00", "11:00"),
    ])

    expect(layout.positions).toHaveLength(3)
    expect(layout.positions.every(item => item.columnCount === 3)).toBe(true)
    expect(layout.overflow).toHaveLength(0)
  })

  it("keeps adjacent jobs at full width", () => {
    const layout = buildTimelineLayout([
      job("a", "09:00", "10:00"),
      job("b", "10:00", "11:00"),
    ])

    expect(layout.positions).toHaveLength(2)
    expect(layout.positions.every(item => item.columnCount === 1)).toBe(true)
    expect(layout.overflow).toHaveLength(0)
  })
})
