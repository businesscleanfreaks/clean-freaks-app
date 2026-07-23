import { describe, expect, it } from 'vitest'
import {
  calculateDayPauseCredit,
  calculateVisitPauseCredit,
} from '@/lib/pause-credit'

describe('pause credit calculations', () => {
  it('uses skipped visits as a share of expected monthly visits', () => {
    expect(calculateVisitPauseCredit(400, 2, 5)).toBe(160)
  })

  it('uses paused calendar days as a share of days in the month', () => {
    expect(calculateDayPauseCredit(400, 7, 31)).toBe(90.32)
  })

  it('caps a day-based credit at the monthly rate', () => {
    expect(calculateDayPauseCredit(400, 40, 31)).toBe(400)
  })
})
