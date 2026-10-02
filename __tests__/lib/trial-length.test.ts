import { describe, expect, it } from "vitest"
import {
  DEFAULT_TRIAL_LENGTH, canStepTrial, stepTrialLength, switchTrialUnit,
  trialEndDate, trialLengthLabel, trialRunsLabel, trialScheduleEnd,
} from "@/lib/trial-length"
import { calculateScheduleDates } from "@/lib/schedule-dates"

const day = (s: string) => new Date(`${s}T12:00:00`)

describe("how long a trial runs", () => {
  it("defaults to 1 month and ends on the same day of the month", () => {
    expect(DEFAULT_TRIAL_LENGTH).toEqual({ n: 1, unit: "months" })
    expect(trialRunsLabel(day("2026-06-11"), DEFAULT_TRIAL_LENGTH)).toBe("Trial runs Jun 11 – Jul 11")
    expect(trialRunsLabel(day("2026-06-15"), { n: 2, unit: "months" })).toBe("Trial runs Jun 15 – Aug 15")
  })

  it("counts weeks in whole weeks from the start", () => {
    expect(trialRunsLabel(day("2026-06-11"), { n: 4, unit: "weeks" })).toBe("Trial runs Jun 11 – Jul 9")
  })

  it("lands on the month's last day when the start day does not exist there", () => {
    expect(trialEndDate(day("2026-01-31"), { n: 1, unit: "months" }).getDate()).toBe(28)
  })

  it("steps between 1 and the unit's limit", () => {
    expect(stepTrialLength({ n: 1, unit: "weeks" }, -1)).toEqual({ n: 1, unit: "weeks" })
    expect(stepTrialLength({ n: 3, unit: "weeks" }, 1)).toEqual({ n: 4, unit: "weeks" })
    expect(stepTrialLength({ n: 6, unit: "months" }, 1)).toEqual({ n: 6, unit: "months" })
    expect(canStepTrial({ n: 1, unit: "months" }, -1)).toBe(false)
    expect(canStepTrial({ n: 1, unit: "months" }, 1)).toBe(true)
  })

  it("starts again at 4 weeks or 1 month when the unit changes", () => {
    expect(switchTrialUnit("weeks")).toEqual({ n: 4, unit: "weeks" })
    expect(switchTrialUnit("months")).toEqual({ n: 1, unit: "months" })
  })

  it("says the length the way the stepper shows it", () => {
    expect(trialLengthLabel({ n: 1, unit: "months" })).toBe("1 month")
    expect(trialLengthLabel({ n: 4, unit: "weeks" })).toBe("4 weeks")
  })
})

describe("the schedule a trial saves", () => {
  // A weekly Monday trial starting Mon Jun 1 2026.
  const cleans = (length: { n: number; unit: "weeks" | "months" }) =>
    calculateScheduleDates({
      frequency: "WEEKLY",
      daysOfWeek: "[1]",
      startDate: "2026-06-01",
      endDate: trialScheduleEnd(day("2026-06-01"), length),
      monthlyPattern: null,
      customDates: null,
      excludedDates: null,
    }).map(d => d.toISOString().slice(0, 10))

  it("books a 1-week trial on one weekday as a single clean", () => {
    expect(cleans({ n: 1, unit: "weeks" })).toEqual(["2026-06-01"])
  })

  it("books 4 cleans for a 4-week weekly trial, none on the end day", () => {
    expect(cleans({ n: 4, unit: "weeks" })).toEqual(["2026-06-01", "2026-06-08", "2026-06-15", "2026-06-22"])
  })
})
