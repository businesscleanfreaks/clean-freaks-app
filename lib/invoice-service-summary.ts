/**
 * The "Service summary" card in the invoice review workspace: one plain-English
 * line saying what this invoice is for.
 *
 * It replaces a raw key-value block that printed schedule enums straight from
 * the database ("EVERY_4_WEEKS") at the reviewer. Everything here is phrased
 * the way the handoff phrases it, and no enum is ever shown as-is.
 */

export const FREQUENCY_LABELS: Record<string, string> = {
  WEEKLY: "Weekly",
  BI_WEEKLY: "Every 2 weeks",
  EVERY_3_WEEKS: "Every 3 weeks",
  EVERY_4_WEEKS: "Every 4 weeks",
  EVERY_6_WEEKS: "Every 6 weeks",
  "2X_MONTHLY": "Twice a month",
  MONTHLY: "Monthly",
  CUSTOM: "Custom dates",
}

/**
 * A readable cadence.
 *
 * Anything already written for humans (it has a space or a lowercase letter)
 * passes straight through — some clients carry a hand-written summary like
 * "Mon, Thu". Unknown enums are sentence-cased rather than shown raw, so a
 * frequency nobody has mapped yet still reads as English.
 */
export function frequencyLabel(raw: string | null | undefined): string | null {
  const value = (raw || "").trim()
  if (!value) return null
  if (FREQUENCY_LABELS[value]) return FREQUENCY_LABELS[value]
  if (/[a-z ]/.test(value)) return value
  const words = value.replace(/_/g, " ").toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export interface ServiceSummaryInput {
  /** FLAT_RATE | PER_CLEAN | ONE_TIME */
  billingType: string
  /** Cleans actually billed on this invoice. */
  cleanCount: number
  /** Cleans that were scheduled this month but cancelled. */
  cancelledCount?: number
  /** Month being invoiced, e.g. "August". */
  monthLabel: string
  /** Schedule cadence, enum or free text. */
  scheduleSummary?: string | null
  /** Used to name a one-off job. */
  firstLineDescription?: string | null
}

export interface ServiceSummary {
  title: string
  sub: string
}

export function buildServiceSummary(input: ServiceSummaryInput): ServiceSummary {
  const { billingType, cleanCount, cancelledCount = 0, monthLabel, scheduleSummary, firstLineDescription } = input

  if (billingType === "FLAT_RATE") {
    return { title: "Flat monthly service", sub: "Same price every month" }
  }

  if (billingType === "ONE_TIME") {
    return {
      title: (firstLineDescription || "").trim() || "One-off clean",
      sub: "One-time job · not recurring",
    }
  }

  const cadence = frequencyLabel(scheduleSummary)
  const cleans = `${cleanCount} clean${cleanCount === 1 ? "" : "s"}`
  const scheduled = cleanCount + cancelledCount

  return {
    title: cadence ? `${cleans} · ${cadence}` : cleans,
    // Says where the number came from, so a total that looks light is
    // explained on the same line instead of sending the reviewer hunting.
    sub: `${cleanCount} of ${scheduled} scheduled cleans found in ${monthLabel}.`,
  }
}
