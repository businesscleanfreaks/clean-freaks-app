/**
 * Which expected cleans a month actually went without.
 *
 * Proration credits a flat-rate client for visits they were owed and did not
 * get. Deciding which those are meant comparing the dates the schedule expected
 * against the dates cleans actually happened · by EXACT DATE:
 *
 *     missingDates = expectedDates.filter(d => !actualDateKeys.has(key(d)))
 *
 * So a clean moved from Tuesday to Wednesday, still done, still in the month,
 * still on the same schedule, left Tuesday unmatched and credited the client
 * for a visit they received. Worse, the Wednesday clean matched nothing, so a
 * month with four expected and four delivered could report two missed.
 *
 * A clean that happened covers a visit that was owed. Which owed visit it
 * covers is a detail, and the nearest one is the honest reading of a
 * reschedule. So actual cleans are PAIRED to expected dates, nearest first,
 * and only the expected dates left with no clean against them are missed.
 *
 * The dates are kept rather than just counted, because the pause policy is
 * decided per date: a visit missed inside a paused week is treated differently
 * from one simply not done.
 *
 * Pure: no Prisma, no clock.
 */

const dayMs = 24 * 60 * 60 * 1000

/**
 * The expected dates no clean can be matched to.
 *
 * Pairs each actual clean with the closest unpaired expected date, closest
 * pairs first, so a rescheduled visit settles against the visit it replaced.
 * Returned in the order the expected dates were given.
 */
export function unmatchedExpectedDates(
  expected: readonly Date[],
  actual: readonly Date[],
): Date[] {
  if (expected.length === 0) return []
  if (actual.length === 0) return [...expected]

  interface Pair {
    expectedIndex: number
    actualIndex: number
    distance: number
  }

  const pairs: Pair[] = []
  for (let e = 0; e < expected.length; e++) {
    for (let a = 0; a < actual.length; a++) {
      pairs.push({
        expectedIndex: e,
        actualIndex: a,
        distance: Math.abs(expected[e].getTime() - actual[a].getTime()) / dayMs,
      })
    }
  }

  // Closest first. Ties settle by position, so the result does not depend on
  // the order the two lists happened to arrive in.
  pairs.sort(
    (x, y) =>
      x.distance - y.distance ||
      x.expectedIndex - y.expectedIndex ||
      x.actualIndex - y.actualIndex,
  )

  const expectedTaken = new Set<number>()
  const actualTaken = new Set<number>()
  for (const pair of pairs) {
    if (expectedTaken.has(pair.expectedIndex) || actualTaken.has(pair.actualIndex)) continue
    expectedTaken.add(pair.expectedIndex)
    actualTaken.add(pair.actualIndex)
  }

  return expected.filter((_, index) => !expectedTaken.has(index))
}
